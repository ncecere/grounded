package notify

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/testutil"
)

func TestCatalog(t *testing.T) {
	typeRE := regexp.MustCompile(`^[a-z][a-z0-9_.]{1,63}$`) // notification_events.type
	mandatory := map[Type]bool{}
	for _, d := range Catalog() {
		if !typeRE.MatchString(string(d.Type)) || d.Label == "" || d.Description == "" {
			t.Errorf("bad definition %+v", d)
		}
		if d.Mandatory {
			mandatory[d.Type] = true
		}
		if got, ok := Lookup(d.Type); !ok || got != d {
			t.Errorf("Lookup(%s) = %+v %v", d.Type, got, ok)
		}
	}
	// docs/phase4-publishing.md §8: these can't be turned off.
	// Break-glass start and end reach owners always (ADR-0024), and so do
	// monthly budget notices (docs/costs.md §4), and a platform admin's
	// Notify owners about failed documents (docs/v0.2.0.md §7).
	want := map[Type]bool{TeamInvited: true, ClassificationLowered: true, AgentDisabled: true, BreakGlassStarted: true, BreakGlassEnded: true,
		BudgetWarning: true, BudgetExhausted: true, DocumentsAttention: true}
	if len(mandatory) != len(want) {
		t.Errorf("mandatory = %v, want %v", mandatory, want)
	}
	for k := range want {
		if !mandatory[k] {
			t.Errorf("%s should be mandatory", k)
		}
	}
	if _, ok := Lookup("nope"); ok {
		t.Error("unknown type found")
	}
}

func TestResolve(t *testing.T) {
	optional, _ := Lookup(SyncFailed)
	required, _ := Lookup(ClassificationLowered)
	off := &Channels{}
	emailOnly := &Channels{Email: true}
	cases := []struct {
		name  string
		def   Def
		saved *Channels
		want  Channels
	}{
		{"default is both", optional, nil, Channels{InApp: true, Email: true}},
		{"saved choice", optional, emailOnly, Channels{Email: true}},
		{"all off", optional, off, Channels{}},
		{"mandatory ignores saved", required, off, Channels{InApp: true, Email: true}},
		{"mandatory default", required, nil, Channels{InApp: true, Email: true}},
	}
	for _, c := range cases {
		if got := Resolve(c.def, c.saved); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestTeamRoles(t *testing.T) {
	for min, want := range map[string]string{
		"owner": "owner", "admin": "owner,admin", "editor": "owner,admin,editor", "member": "owner,admin,editor,member",
	} {
		if got := strings.Join(teamRoles(min), ","); got != want {
			t.Errorf("teamRoles(%s) = %s, want %s", min, got, want)
		}
	}
}

func TestRecipientsPerEvent(t *testing.T) {
	actor, owner, editor, suspended := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	team := []person{
		{ID: actor, Email: "actor@example.edu", Active: true, FromTeam: true},
		{ID: owner, Email: "owner@example.edu", Active: true, FromTeam: true},
		{ID: editor, Email: "editor@example.edu", Active: true, FromTeam: true},
		{ID: suspended, Email: "gone@example.edu", Active: false},
	}
	ids := func(rs []recipient) []string {
		var out []string
		for _, r := range rs {
			out = append(out, r.Email)
		}
		return out
	}
	// Optional team-wide event: the person who caused it is left out.
	sync, _ := Lookup(SyncFailed)
	if got := strings.Join(ids(selectRecipients(sync, actor, team, nil)), ","); got != "owner@example.edu,editor@example.edu" {
		t.Errorf("sync failed recipients = %s", got)
	}
	// Mandatory: everyone, including the actor; never suspended users.
	lowered, _ := Lookup(ClassificationLowered)
	if got := strings.Join(ids(selectRecipients(lowered, actor, team, nil)), ","); got != "actor@example.edu,owner@example.edu,editor@example.edu" {
		t.Errorf("classification lowered recipients = %s", got)
	}
	// A system event (no actor) reaches everyone; duplicates collapse.
	dup := append(append([]person{}, team...), person{ID: owner, Email: "owner@example.edu", Active: true})
	if got := len(selectRecipients(sync, uuid.Nil, dup, nil)); got != 3 {
		t.Errorf("system event recipients = %d, want 3", got)
	}
	// Invites: an address nobody uses yet is a recipient by email only.
	invited, _ := Lookup(TeamInvited)
	rs := selectRecipients(invited, actor, nil, []string{"new@example.edu", "new@example.edu", ""})
	if len(rs) != 1 || rs[0].UserID != uuid.Nil || rs[0].Email != "new@example.edu" {
		t.Errorf("invite recipients = %+v", rs)
	}
}

func TestEventConstructors(t *testing.T) {
	team := TeamRef{ID: uuid.New(), Slug: "registrar", Name: "Office of the Registrar"}
	src, crawl, inv, reqID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	now := time.Date(2026, 9, 26, 23, 0, 0, 0, time.UTC)
	cases := []struct {
		ev    Event
		link  string
		dedup string
	}{
		{InvitedEvent(team, "new@example.edu", "editor", now), "/", ""},
		{InviteExpiringEvent(team, inv, "new@example.edu", "member", now), "/", "invite_expiring:" + inv.String() + ":26 September 2026"},
		{MemberAddedEvent(team, uuid.New(), "admin"), "/teams/registrar", ""},
		{RoleChangedEvent(team, uuid.New(), "member", "owner"), "/teams/registrar", ""},
		{DomainRequestDecidedEvent(team, uuid.New(), reqID, "*.example.edu", "approve", "ok"), "/teams/registrar/sources?tab=crawl-domains&record=" + reqID.String(), ""},
		{SyncFailedEvent(team, src, "Catalog", crawl, "boom"), "/teams/registrar/sources/" + src.String(), "sync_failed:" + crawl.String()},
		{ClassificationLoweredEvent(team, src, "Catalog", "Sensitive", "Open", "now public"), "/teams/registrar/sources/" + src.String(), ""},
		{AgentDisabledEvent(team, src, "Helper", "abuse"), "/teams/registrar/agents/" + src.String(), ""},
		{AgentPublishedEvent(team, src, "Helper", "public", 3), "/teams/registrar/agents/" + src.String(), ""},
		{DailyLimitReachedEvent(team, "queries_per_day", "queries per day", 100, now), "/teams/registrar?tab=usage", "daily_limit:" + team.ID.String() + ":queries_per_day:2026-09-26"},
	}
	linkRE := regexp.MustCompile(`^/([^/\\]|$)`) // notification_events.link
	for _, c := range cases {
		if _, ok := Lookup(c.ev.Type); !ok || c.ev.Title == "" || c.ev.TeamID != team.ID {
			t.Errorf("%s: bad event %+v", c.ev.Type, c.ev)
		}
		if c.ev.Link != c.link || !linkRE.MatchString(c.ev.Link) || c.ev.DedupeKey != c.dedup {
			t.Errorf("%s: link %q dedupe %q, want %q %q", c.ev.Type, c.ev.Link, c.ev.DedupeKey, c.link, c.dedup)
		}
	}
	d := DomainRequestDecidedEvent(team, uuid.New(), uuid.New(), "*.example.edu", "deny", "Use the catalog instead.")
	if d.Title != "Domain request denied: *.example.edu" || !strings.Contains(d.Body, "Note from the reviewer: Use the catalog instead.") {
		t.Errorf("decided = %q / %q", d.Title, d.Body)
	}
	if p := AgentPublishedEvent(team, src, "Helper", "all_authenticated", 2); p.Title != "Helper is now available to all signed-in users" {
		t.Errorf("published title = %q", p.Title)
	}
}

func TestRender(t *testing.T) {
	site := Site{Instance: "Campus RAG", AppURL: "https://rag.example.edu"}
	r, err := Render(site, Content{
		Type: DomainRequestDecided, Title: "Domain request approved: <b>x</b>", Link: "/teams/registrar/domains",
		Body: "First paragraph.\n\nNote from the reviewer: <script>alert(1)</script>",
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Subject != "[Campus RAG] Domain request approved: <b>x</b>" {
		t.Errorf("subject = %q", r.Subject)
	}
	for _, want := range []string{
		"Domain request approved: <b>x</b>", "Open in Campus RAG: https://rag.example.edu/teams/registrar/domains",
		"Manage notification settings: https://rag.example.edu/settings/notifications", `"Domain request decided" notifications are on`,
	} {
		if !strings.Contains(r.Text, want) {
			t.Errorf("text lacks %q:\n%s", want, r.Text)
		}
	}
	for _, want := range []string{
		`<html lang="en">`, "<title>Domain request approved: &lt;b&gt;x&lt;/b&gt;</title>", "<p style=\"margin:0 0 16px;\">First paragraph.</p>",
		"&lt;script&gt;", `href="https://rag.example.edu/teams/registrar/domains"`, `href="https://rag.example.edu/settings/notifications"`,
		"Manage notification settings", "Campus RAG",
	} {
		if !strings.Contains(r.HTML, want) {
			t.Errorf("html lacks %q:\n%s", want, r.HTML)
		}
	}
	if strings.Contains(r.HTML, "<script>") || strings.Contains(r.HTML, "<b>x") {
		t.Error("html is not escaped")
	}
	// Mandatory events say so instead of pointing at a setting; no link, no button.
	m, _ := Render(site, Content{Type: ClassificationLowered, Title: "Lowered", Mandatory: true})
	if !strings.Contains(m.Text, "can't be turned off") || strings.Contains(m.Text, "Open in") || strings.Contains(m.HTML, "Open in") {
		t.Errorf("mandatory text = %s", m.Text)
	}
}

func TestMessageBytes(t *testing.T) {
	msg := Message{From: "Campus RAG <rag@example.edu>", To: "una@example.edu", Rendered: Rendered{
		Subject: "Überprüfung\r\nBcc: evil@example.com", Text: "Hello\nworld", HTML: "<p>Hello</p>",
	}}
	raw := string(msg.Bytes(time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)))
	head, _, _ := strings.Cut(raw, "\r\n\r\n")
	if strings.Contains(head, "\r\nBcc:") {
		t.Fatalf("header injection:\n%s", head)
	}
	for _, want := range []string{"From: Campus RAG <rag@example.edu>", "To: una@example.edu", "Subject: =?utf-8?q?", "MIME-Version: 1.0",
		"Auto-Submitted: auto-generated", "Message-ID: <", "@example.edu>", "multipart/alternative"} {
		if !strings.Contains(head, want) {
			t.Errorf("headers lack %q:\n%s", want, head)
		}
	}
}

func TestSMTPSenderDeliversToSink(t *testing.T) {
	sink := testutil.NewSMTPSink(t)
	s := &SMTPSender{Config: SMTPConfig{Host: sink.Host(), Port: sink.Port(), TLS: "none", Timeout: 5 * time.Second}}
	r, _ := Render(Site{Instance: "Campus RAG", AppURL: "http://127.0.0.1:8080"}, Content{Type: TeamInvited, Title: "You're invited to join Registrar", Body: "Welcome.", Link: "/", Mandatory: true})
	if err := s.Send(context.Background(), Message{From: "Campus RAG <rag@example.edu>", To: "new@example.edu", Rendered: r}); err != nil {
		t.Fatal(err)
	}
	got := sink.Wait(t, 1, 5*time.Second)
	if got[0].From != "rag@example.edu" || len(got[0].To) != 1 || got[0].To[0] != "new@example.edu" {
		t.Fatalf("envelope = %+v", got[0])
	}
	p := got[0].Parse(t)
	if p.Header.Get("Subject") != "[Campus RAG] You're invited to join Registrar" || !strings.Contains(p.Text, "Welcome.") || !strings.Contains(p.HTML, "<h1") {
		t.Fatalf("parsed = %+v", p)
	}
	// A temporary failure is an error, so the River job retries.
	sink.FailNext(1)
	if err := s.Send(context.Background(), Message{From: "rag@example.edu", To: "new@example.edu", Rendered: r}); err == nil {
		t.Fatal("451 not reported")
	}
	// STARTTLS is required in starttls mode.
	s.Config.TLS = "starttls"
	if err := s.Send(context.Background(), Message{From: "rag@example.edu", To: "new@example.edu", Rendered: r}); err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("starttls against a plain relay = %v", err)
	}
}

// A platform admin's Notify owners: counts, the source and a link to its
// documents filtered to Needs OCR or Failed; never a document's name.
func TestDocumentsAttentionEvent(t *testing.T) {
	team := TeamRef{ID: uuid.New(), Slug: "registrar", Name: "Registrar"}
	src := uuid.New()
	oldest := time.Date(2026, 8, 3, 10, 0, 0, 0, time.UTC)
	ev := DocumentsAttentionEvent(team, DocumentProblems{SourceID: src, SourceName: "Scans", Reason: "needs_ocr", Documents: 12, Oldest: oldest})
	if ev.Type != DocumentsAttention || ev.Title != "12 documents in Scans need attention (Registrar)" ||
		ev.Link != "/teams/registrar/sources/"+src.String()+"?status=needs_ocr&tab=documents" ||
		!strings.Contains(ev.Body, "12 documents in the data source Scans that have pages without text that need OCR, the oldest since 3 August 2026") {
		t.Fatalf("event = %+v", ev)
	}
	one := DocumentsAttentionEvent(team, DocumentProblems{SourceID: src, SourceName: "Scans", Reason: "damaged", Documents: 1, Oldest: oldest})
	if one.Title != "1 document in Scans needs attention (Registrar)" || !strings.HasSuffix(one.Link, "?status=failed&tab=documents") {
		t.Fatalf("one damaged = %+v", one)
	}
}

// AD-17: break-glass times in the platform's zone, and a switch back tells platform admins too.
func TestBreakGlassTimesAndSwitchBack(t *testing.T) {
	ny, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skip("no tz database")
	}
	b := BreakGlassInfo{Admin: "Morgan", Scopes: "conversations", ExpiresAt: time.Date(2026, 10, 4, 15, 21, 0, 0, time.UTC), Location: ny}
	ev := BreakGlassStartedEvent(TeamRef{Name: "Beta"}, b, "")
	if !strings.Contains(ev.Body, "until 4 October 2026, 11:21 (EDT).") || strings.Contains(ev.Body, "UTC") {
		t.Errorf("body = %q", ev.Body)
	}
	back := ProfileSwitchedEvent(nil, TeamRef{Name: "Beta"}, uuid.New(), "Beta KB", "New", "Old", time.Now(), true)
	if !strings.HasPrefix(back.Title, "Profile migration switched back: Beta KB") || !strings.Contains(back.DedupeKey, "switched_back") {
		t.Errorf("switch back = %+v", back)
	}
}
