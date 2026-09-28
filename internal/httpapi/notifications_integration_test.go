package httpapi_test

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/notify"
	"github.com/ncecere/grounded/internal/testutil"
)

// mailConfig sends notification email to an in-process SMTP sink.
func mailConfig(sink *testutil.SMTPSink) func(*config.Config) {
	return func(c *config.Config) {
		c.Instance.Name = "Campus RAG"
		c.SMTP = config.SMTP{Host: sink.Host(), Port: sink.Port(), TLS: config.SMTPNoTLS, From: "Campus RAG <rag@example.edu>"}
	}
}

func inbox(t *testing.T, s *session, query url.Values) apitypes.NotificationPage {
	t.Helper()
	var page apitypes.NotificationPage
	path := "/v1/notifications"
	if len(query) > 0 {
		path += "?" + query.Encode()
	}
	if code := s.get(path, &page); code != 200 {
		t.Fatalf("GET %s = %d", path, code)
	}
	return page
}

// titles lists the page's titles of one type ("" = all).
func titles(p apitypes.NotificationPage, typ string) []string {
	var out []string
	for _, n := range p.Items {
		if typ == "" || string(n.Type) == typ {
			out = append(out, n.Title)
		}
	}
	return out
}

// mailTo waits for an email to addr whose subject contains subject.
func mailTo(t *testing.T, sink *testutil.SMTPSink, addr, subject string) testutil.Parsed {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		for _, m := range sink.Messages() {
			if len(m.To) == 1 && m.To[0] == addr {
				if p := m.Parse(t); strings.Contains(p.Header.Get("Subject"), subject) {
					return p
				}
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("no email to %s with subject %q", addr, subject)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func (a *testApp) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := a.Pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func (a *testApp) emailsTo(t *testing.T, addr string) int {
	return a.count(t, `SELECT count(*) FROM notification_emails WHERE to_address = $1`, addr)
}

func TestNotificationInvitesSettingsAndInbox(t *testing.T) {
	sink := testutil.NewSMTPSink(t)
	app := newTestAppWith(t, mailConfig(sink), true)
	admin, owner := app.signIn("admin"), app.signIn("user")
	createTeam(t, admin, "registrar", "user@localhost")
	owner.refresh()

	// The first owner was added (by a platform admin): in the app and by email.
	page := inbox(t, owner, nil)
	if page.UnreadCount != 1 || len(page.Items) != 1 || page.Items[0].Title != "You were added to REGISTRAR" ||
		page.Items[0].Type != "team.membership" || page.Items[0].Link != "/teams/registrar" || page.Items[0].Read {
		t.Fatalf("owner inbox = %+v", page)
	}
	mailTo(t, sink, "user@localhost", "You were added to REGISTRAR")

	// An invite to someone who has never signed in: email now, in-app after
	// their first sign-in.
	var res apitypes.MemberAddResult
	code, e := owner.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "casey@localhost", "role": "editor"}, &res, nil)
	mustCode(t, "invite casey", code, e, 201, "")
	if res.Status != "invited" {
		t.Fatalf("casey = %+v", res)
	}
	mail := mailTo(t, sink, "casey@localhost", "[Campus RAG] You're invited to join REGISTRAR")
	if !strings.Contains(mail.Text, "Sign in with casey@localhost to join") || !strings.Contains(mail.Text, "Open in Campus RAG: "+app.URL+"/") ||
		!strings.Contains(mail.Text, "Manage notification settings: "+app.URL+"/settings/notifications") || !strings.Contains(mail.Text, "can't be turned off") {
		t.Errorf("invite text:\n%s", mail.Text)
	}
	if !strings.Contains(mail.HTML, `<html lang="en">`) || !strings.Contains(mail.HTML, `href="`+app.URL+`/settings/notifications"`) {
		t.Errorf("invite html:\n%s", mail.HTML)
	}
	if n := app.count(t, `SELECT count(*) FROM notifications WHERE user_id IS NULL AND email = 'casey@localhost' AND type = 'team.invited'`); n != 1 {
		t.Fatalf("pending invite items = %d", n)
	}
	// The daily scan: an invite expiring within 3 days is notified once.
	scan := notify.New(app.Pool, nil, false, testutil.Logger())
	for range 2 {
		if n, err := scan.NotifyExpiringInvites(context.Background(), time.Now().Add(28*24*time.Hour)); err != nil || n != 1 {
			t.Fatalf("expiry scan = %d %v", n, err)
		}
	}
	if n := app.count(t, `SELECT count(*) FROM notifications WHERE email = 'casey@localhost' AND type = 'team.invite_expiring'`); n != 1 {
		t.Fatalf("expiring items = %d", n)
	}
	casey := app.signIn("casey")
	page = inbox(t, casey, nil)
	if got := titles(page, ""); page.UnreadCount != 2 || len(got) != 2 || !strings.HasPrefix(got[0], "Your invite to REGISTRAR expires on") ||
		got[1] != "You're invited to join REGISTRAR" {
		t.Fatalf("casey inbox = %+v", page)
	}

	notificationSettings(t, app, owner)
}

// notificationSettings: settings are honoured, mandatory types stay on, and
// the inbox reads, pages and filters.
func notificationSettings(t *testing.T, app *testApp, owner *session) {
	alex := app.signIn("alex")
	var st apitypes.NotificationSettings
	// Admin-only events (new domain requests, break-glass approvals, profile migrations) are not listed for others.
	adminOnly := 0
	for _, d := range notify.Catalog() {
		if d.PlatformAdmins {
			adminOnly++
		}
	}
	if code := alex.get("/v1/me/notification-settings", &st); code != 200 || !st.EmailEnabled || adminOnly != 4 || len(st.Items) != len(notify.Catalog())-adminOnly {
		t.Fatalf("settings = %d %+v", code, st)
	}
	mandatory := map[apitypes.NotificationType]bool{"team.invited": true, "source.classification_lowered": true, "agent.disabled_by_platform": true,
		"breakglass.started": true, "breakglass.ended": true, "team.budget_warning": true, "team.budget_exhausted": true}
	for _, it := range st.Items {
		if !it.InApp || !it.Email || it.Mandatory != mandatory[it.Type] {
			t.Errorf("default setting %+v", it)
		}
	}
	put := func(items ...map[string]any) (int, string) {
		return alex.call("PUT", "/v1/me/notification-settings", map[string]any{"items": items}, &st, nil)
	}
	code, e := put(map[string]any{"type": "agent.disabled_by_platform", "inApp": true, "email": false})
	mustCode(t, "mandatory off", code, e, 400, "notification_mandatory")
	code, e = put(map[string]any{"type": "nope", "inApp": true, "email": true})
	mustCode(t, "unknown type", code, e, 400, "")
	code, e = put(map[string]any{"type": "team.membership", "inApp": false, "email": false})
	mustCode(t, "membership off", code, e, 200, "")

	var added apitypes.MemberAddResult
	code, e = owner.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "alex@localhost", "role": "member"}, &added, nil)
	mustCode(t, "add alex", code, e, 201, "")
	if p := inbox(t, alex, nil); len(p.Items) != 0 || app.emailsTo(t, "alex@localhost") != 0 {
		t.Fatalf("alex was notified with everything off: %+v", p)
	}
	// In the app only: three role changes, no email.
	code, e = put(map[string]any{"type": "team.membership", "inApp": true, "email": false})
	mustCode(t, "membership in-app", code, e, 200, "")
	rev := added.Member.Revision
	for _, role := range []string{"editor", "admin", "editor"} {
		var m apitypes.Member
		code, e := owner.call("PATCH", "/v1/teams/registrar/members/"+alex.me.User.Id.String(), map[string]string{"role": role}, &m, ifMatch(rev))
		mustCode(t, "role "+role, code, e, 200, "")
		rev = m.Revision
	}
	if app.emailsTo(t, "alex@localhost") != 0 {
		t.Error("email sent with email off")
	}
	inboxPaging(t, alex, owner)
}

func inboxPaging(t *testing.T, alex, owner *session) {
	first := inbox(t, alex, url.Values{"limit": {"2"}})
	if first.UnreadCount != 3 || len(first.Items) != 2 || first.NextCursor == nil ||
		first.Items[0].Title != "Your role in REGISTRAR is now Editor" || first.Items[1].Title != "Your role in REGISTRAR is now Admin" {
		t.Fatalf("page 1 = %+v", first)
	}
	second := inbox(t, alex, url.Values{"limit": {"2"}, "cursor": {*first.NextCursor}})
	if len(second.Items) != 1 || second.NextCursor != nil || second.Items[0].Body != "Your role in REGISTRAR changed from Member to Editor." {
		t.Fatalf("page 2 = %+v", second)
	}
	id := first.Items[0].Id.String()
	var n apitypes.Notification
	code, e := alex.call("PATCH", "/v1/notifications/"+id, map[string]bool{"read": true}, &n, nil)
	mustCode(t, "mark read", code, e, 200, "")
	if !n.Read || n.ReadAt == nil {
		t.Fatalf("read = %+v", n)
	}
	if p := inbox(t, alex, url.Values{"unread": {"true"}}); p.UnreadCount != 2 || len(p.Items) != 2 {
		t.Fatalf("unread = %+v", p)
	}
	code, e = alex.call("PATCH", "/v1/notifications/"+id, map[string]bool{"read": false}, &n, nil)
	mustCode(t, "mark unread", code, e, 200, "")
	if n.Read || inbox(t, alex, nil).UnreadCount != 3 {
		t.Fatalf("unread again = %+v", n)
	}
	// Someone else's notification doesn't exist for you.
	code, e = owner.call("PATCH", "/v1/notifications/"+id, map[string]bool{"read": true}, nil, nil)
	mustCode(t, "other user's notification", code, e, 404, "notification_not_found")
	if p := inbox(t, alex, url.Values{"type": {"web.sync_failed"}}); len(p.Items) != 0 || p.UnreadCount != 3 {
		t.Fatalf("type filter = %+v", p)
	}
	code, _ = alex.call("GET", "/v1/notifications?type=bogus", nil, nil, nil)
	mustCode(t, "bogus type", code, "", 400, "")
	var res apitypes.NotificationReadAllResult
	// F-13: a type marks only that type; no type marks everything.
	code, e = alex.call("POST", "/v1/notifications/read-all", map[string]any{"type": "web.sync_failed"}, &res, nil)
	mustCode(t, "read one type", code, e, 200, "")
	if res.Updated != 0 || inbox(t, alex, nil).UnreadCount != 3 {
		t.Fatalf("read one type = %+v", res)
	}
	code, e = alex.call("POST", "/v1/notifications/read-all", nil, &res, nil)
	mustCode(t, "read all", code, e, 200, "")
	if res.Updated != 3 || inbox(t, alex, nil).UnreadCount != 0 {
		t.Fatalf("read all = %+v", res)
	}
}

func TestNotificationTeamEvents(t *testing.T) {
	sink := testutil.NewSMTPSink(t)
	env := newAgentEnvWith(t, mailConfig(sink)) // user owner, alex editor, blair member, casey admin
	owner, alex, blair, casey := env.owner, env.editor, env.member, env.tadmin
	has := func(s *session, typ, title string) bool {
		for _, got := range titles(inbox(t, s, url.Values{"type": {typ}}), typ) {
			if got == title {
				return true
			}
		}
		return false
	}
	expect := func(typ, title string, want map[*session]bool) {
		t.Helper()
		for s, w := range want {
			if got := has(s, typ, title); got != w {
				t.Errorf("%s %q for %s: got %v, want %v", typ, title, s.me.User.Email, got, w)
			}
		}
	}

	// Domain request decided: the requester.
	var dr apitypes.DomainRequest
	code, e := alex.call("POST", env.base+"/domain-requests", map[string]any{"pattern": "docs.example.edu", "reason": "The handbook lives there."}, &dr, nil)
	mustCode(t, "domain request", code, e, 201, "")
	newReq := inbox(t, env.admin, url.Values{"type": {"web.domain_request_new"}}).Items
	if len(newReq) != 1 || newReq[0].Read {
		t.Fatalf("admin's new-request notification = %+v", newReq)
	}
	code, e = env.admin.call("POST", "/v1/admin/domain-requests/"+dr.Id.String()+"/review", map[string]any{"decision": "approve", "note": "Fine."}, nil, nil)
	mustCode(t, "approve", code, e, 200, "")
	// Deciding the request deals with the admins' "New domain request".
	if n := inbox(t, env.admin, url.Values{"type": {"web.domain_request_new"}}).Items; len(n) != 1 || !n[0].Read {
		t.Errorf("after the decision, the new-request notification = %+v", n)
	}
	expect("web.domain_request", "Domain request approved: docs.example.edu", map[*session]bool{alex: true, owner: false})
	if p := mailTo(t, sink, "alex@localhost", "Domain request approved"); !strings.Contains(p.Text, "Note from the reviewer: Fine.") {
		t.Errorf("decision email:\n%s", p.Text)
	}

	// Classification lowered: every owner, including the one who did it
	// (mandatory); not admins.
	var src apitypes.DataSource
	code, e = owner.call("POST", env.base+"/sources", map[string]any{"name": "Records", "classification": "sensitive"}, &src, nil)
	mustCode(t, "source", code, e, 201, "")
	code, e = owner.call("PATCH", env.base+"/sources/"+src.Id.String(), map[string]any{"classification": "open", "reason": "Reviewed: all public."}, &src, ifMatch(src.Revision))
	mustCode(t, "lower", code, e, 200, "")
	expect("source.classification_lowered", "Classification lowered: Records (REGISTRAR)", map[*session]bool{owner: true, casey: false, alex: false})
	mailTo(t, sink, "user@localhost", "Classification lowered: Records")

	// Agent disabled by the platform: admins and owners (mandatory).
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	code, e = env.admin.call("POST", "/v1/admin/agents/"+ag.Id.String()+"/status", map[string]any{"status": "disabled_by_platform", "reason": "Under review"}, nil, nil)
	mustCode(t, "kill switch", code, e, 200, "")
	title := "Agent disabled by a platform admin: Helper (REGISTRAR)"
	expect("agent.disabled_by_platform", title, map[*session]bool{owner: true, casey: true, alex: false, blair: false})
	mailTo(t, sink, "casey@localhost", "Agent disabled by a platform admin")

	// Daily limit reached: admins and owners, once a day.
	setTeamLimits(t, env.admin, env.team, map[string]any{"queries_per_day": 1})
	env.retrieve(t, owner, env.base, env.kb.Id, "parking")
	for range 2 {
		code, _ = owner.call("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", map[string]any{"query": "parking"}, nil, nil)
		mustCode(t, "over the daily limit", code, "", 429, "")
	}
	title = "REGISTRAR reached its daily limit of queries per day"
	expect("team.daily_limit", title, map[*session]bool{owner: true, casey: true, alex: false})
	if n := env.app.count(t, `SELECT count(*) FROM notification_events WHERE type = 'team.daily_limit'`); n != 1 {
		t.Errorf("daily limit events = %d", n)
	}
	syncFailed(t, env, sink, expect)
}

// syncFailed: a run that fails notifies the team's editors and above. With
// one crawl slot, B waits behind A; crawling is then blocked (0 pages a
// day), so B fails when A frees the slot.
func syncFailed(t *testing.T, env *agentEnv, sink *testutil.SMTPSink, expect func(string, string, map[*session]bool)) {
	sources := env.base + "/sources"
	setTeamLimits(t, env.admin, env.team, map[string]any{"concurrent_crawls": 1})
	env.site.setDelay(200 * time.Millisecond)
	a := env.createWeb(t, env.owner, sources, "A", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/")}})
	b := env.createWeb(t, env.owner, sources, "B", map[string]any{"mode": "scrape", "urls": []string{env.site.url("/about")}})
	if b.ActiveCrawl.WaitingReason == nil {
		t.Fatalf("B did not wait: %+v", b.ActiveCrawl)
	}
	setTeamLimits(t, env.admin, env.team, map[string]any{"crawl_pages_per_day": 0})
	waitCrawl(t, env.owner, sources+"/"+a.Id.String(), a.ActiveCrawl.Id)
	if run := waitCrawl(t, env.owner, sources+"/"+b.Id.String(), b.ActiveCrawl.Id); run.Status != "failed" {
		t.Fatalf("B = %+v", run)
	}
	expect("web.sync_failed", "Sync failed: B (REGISTRAR)", map[*session]bool{env.owner: true, env.editor: true, env.tadmin: true, env.member: false})
	p := mailTo(t, sink, "alex@localhost", "Sync failed: B")
	if !strings.Contains(p.Text, "crawled pages per day is 0") || !strings.Contains(p.Text, "/teams/registrar/sources/"+b.Id.String()) {
		t.Errorf("sync failed email:\n%s", p.Text)
	}
}

// A removed member's "You were added to ..." (and role change) items for
// that team are marked read: they would lead to a team they can't open.
// Their items about other teams stay unread.
func TestNotificationMembershipResolvedOnRemoval(t *testing.T) {
	app := newTestApp(t, nil)
	admin, owner, alex := app.signIn("admin"), app.signIn("user"), app.signIn("alex")
	createTeam(t, admin, "registrar", "user@localhost")
	createTeam(t, admin, "library", "user@localhost")
	owner.refresh()
	for _, team := range []string{"registrar", "library"} {
		code, e := owner.call("POST", "/v1/teams/"+team+"/members", map[string]string{"email": "alex@localhost", "role": "editor"}, nil, nil)
		mustCode(t, "add alex to "+team, code, e, 201, "")
	}
	var members []apitypes.Member
	owner.get("/v1/teams/registrar/members", &members)
	var rev int64
	for _, m := range members {
		if m.User.Id == alex.me.User.Id {
			rev = m.Revision
		}
	}
	path := "/v1/teams/registrar/members/" + alex.me.User.Id.String()
	code, e := owner.call("PATCH", path, map[string]string{"role": "member"}, nil, ifMatch(rev))
	mustCode(t, "demote alex", code, e, 200, "")
	if page := inbox(t, alex, nil); page.UnreadCount != 3 {
		t.Fatalf("alex's inbox before removal = %+v", page)
	}

	code, e = owner.call("DELETE", path, nil, nil, nil)
	mustCode(t, "remove alex", code, e, 200, "")
	page := inbox(t, alex, nil)
	if page.UnreadCount != 1 {
		t.Errorf("unread after removal = %d, want 1 (library)", page.UnreadCount)
	}
	for _, n := range page.Items {
		if wantRead := strings.Contains(n.Title, "REGISTRAR"); n.Read != wantRead {
			t.Errorf("%q read = %v, want %v", n.Title, n.Read, wantRead)
		}
	}
	// The owner's own items are untouched.
	if page := inbox(t, owner, nil); page.UnreadCount != 2 {
		t.Errorf("owner's unread = %d, want 2", page.UnreadCount)
	}
}
