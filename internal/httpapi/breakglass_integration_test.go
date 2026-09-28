package httpapi_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Break-glass (ADR-0024, docs/phase5-deploy.md §5 P4): no content without a
// session; with one, reads of exactly its scope and team, each audited with
// the session ID; owners notified at the start and with a summary at the
// end; access gone the moment it ends.

const bgReason = "Investigating a support request about wrong answers"

func startBreakGlass(t *testing.T, admin *session, team string, scopes ...string) apitypes.BreakGlassSessionDetail {
	t.Helper()
	var s apitypes.BreakGlassSessionDetail
	code, e := admin.call("POST", "/v1/admin/break-glass", map[string]any{"team": team, "reason": bgReason, "scopes": scopes}, &s, nil)
	mustCode(t, "start break-glass", code, e, 201, "")
	return s
}

// bgReads counts a session's read entries in the audit log, by kind.
func bgReads(t *testing.T, app *testApp, id string) map[string]int {
	t.Helper()
	rows, err := app.Pool.Query(context.Background(),
		`SELECT metadata->>'kind', count(*) FROM audit_log WHERE action = 'breakglass.read' AND metadata->>'sessionId' = $1 GROUP BY 1`, id)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			t.Fatal(err)
		}
		out[k] = n
	}
	return out
}

func lastNotification(t *testing.T, app *testApp, email, typ string) (title, body string) {
	t.Helper()
	err := app.Pool.QueryRow(context.Background(), `SELECT e.title, e.body FROM notifications n
		JOIN notification_events e ON e.id = n.event_id JOIN users u ON u.id = n.user_id
		WHERE u.email = $1 AND n.type = $2 ORDER BY n.created_at DESC LIMIT 1`, email, typ).Scan(&title, &body)
	if err != nil {
		t.Fatalf("%s notification for %s: %v", typ, email, err)
	}
	return title, body
}

func TestBreakGlassDocumentsAndConversations(t *testing.T) {
	env := newAgentEnv(t)
	admin, owner, member, tadmin, auditor := env.admin, env.owner, env.member, env.tadmin, env.auditor
	env.publishAgent(t, "Student Help", env.agentConfig(env.kb.Id.String()))
	code, evs, e := member.stream(env.chatPath("student-help"), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	var conv struct{ ConversationId string }
	evs.one(t, "conversation", &conv)
	cid := conv.ConversationId
	src := env.base + "/sources/" + env.upload.Id.String()
	var docs apitypes.DocumentPage
	owner.get(src+"/documents", &docs)
	doc := src + "/documents/" + docs.Items[0].Id.String()
	teamConvs := env.base + "/conversations"

	// Without a session nobody else reads content: not the platform admin,
	// the auditor, nor the team's own admin (transcripts are the user's).
	for _, p := range []string{env.base + "/sources", src, src + "/documents", doc, doc + "/passages", "/v1/conversations/" + cid} {
		if code, _ := admin.call("GET", p, nil, nil, nil); code != 404 {
			t.Errorf("admin without session GET %s = %d, want 404", p, code)
		}
	}
	for _, s := range []*session{admin, auditor, tadmin, owner, member} {
		if code, _ := s.call("GET", teamConvs, nil, nil, nil); code != 403 {
			t.Errorf("GET team conversations as %s = %d, want 403", s.me.User.Email, code)
		}
	}
	for _, s := range []*session{tadmin, owner, auditor} {
		if code, _ := s.call("GET", "/v1/conversations/"+cid, nil, nil, nil); code != 404 {
			t.Errorf("%s reads the transcript = %d", s.me.User.Email, code)
		}
	}

	// Settings default to one admin with a written reason.
	var set apitypes.BreakGlassSettings
	auditor.get("/v1/admin/settings/break-glass", &set)
	if set.ApprovalRequired || set.MaxDurationMinutes != 480 || set.ApprovalTimeoutMinutes != 60 || set.DefaultDurationMinutes != 60 || set.MinReasonLength != 20 {
		t.Fatalf("default settings = %+v", set)
	}

	// Starting needs a platform admin, a reason and a scope.
	start := map[string]any{"team": env.team, "reason": bgReason, "scopes": []string{"documents"}}
	for who, s := range map[string]*session{"auditor": auditor, "owner": owner} {
		if code, _ := s.call("POST", "/v1/admin/break-glass", start, nil, nil); code != 403 {
			t.Errorf("%s starts = %d", who, code)
		}
	}
	code, e = admin.call("POST", "/v1/admin/break-glass", map[string]any{"team": env.team, "reason": "Because", "scopes": []string{"documents"}}, nil, nil)
	mustCode(t, "short reason", code, e, 400, "invalid_reason")
	code, e = admin.call("POST", "/v1/admin/break-glass", map[string]any{"team": env.team, "reason": bgReason, "scopes": []string{}}, nil, nil)
	mustCode(t, "no scope", code, e, 400, "invalid_scope")
	code, e = admin.call("POST", "/v1/admin/break-glass", map[string]any{"team": env.team, "reason": bgReason, "scopes": []string{"documents"}, "durationMinutes": 600}, nil, nil)
	mustCode(t, "too long", code, e, 400, "invalid_duration")

	s1 := startBreakGlass(t, admin, env.team, "documents")
	if s1.Status != "active" || s1.ExpiresAt == nil || s1.StartedAt == nil || s1.ExpiresAt.Sub(*s1.StartedAt) != time.Hour || s1.RequestedBy.Email != "admin@localhost" {
		t.Fatalf("started = %+v", s1)
	}
	code, e = admin.call("POST", "/v1/admin/break-glass", start, nil, nil)
	mustCode(t, "second open session", code, e, 409, "break_glass_open")
	title, body := lastNotification(t, env.app, "user@localhost", "breakglass.started")
	if !strings.Contains(title, "documents") || !strings.Contains(body, bgReason) {
		t.Errorf("started notification = %q %q", title, body)
	}

	// The banner and the owners' notice.
	var mine []apitypes.BreakGlassSession
	if admin.get("/v1/me/break-glass", &mine); len(mine) != 1 || mine[0].Id != s1.Id {
		t.Errorf("admin's open sessions = %+v", mine)
	}
	if owner.get("/v1/me/break-glass", &mine); len(mine) != 0 {
		t.Errorf("owner's open sessions = %+v", mine)
	}
	var onTeam []apitypes.BreakGlassSession
	if code := owner.get(env.base+"/break-glass", &onTeam); code != 200 || len(onTeam) != 1 || onTeam[0].Reason != bgReason {
		t.Errorf("owner's notice = %d %+v", code, onTeam)
	}
	if code, _ := member.call("GET", env.base+"/break-glass", nil, nil, nil); code != 403 {
		t.Errorf("member sees the notice = %d", code)
	}

	// Documents scope: sources, documents and passages read; nothing else.
	for _, p := range []string{env.base + "/sources", src, src + "/documents", doc, doc + "/passages"} {
		if code, e := admin.call("GET", p, nil, nil, nil); code != 200 {
			t.Errorf("admin under session GET %s = %d %s", p, code, e)
		}
	}
	for _, c := range []struct{ method, path string }{
		{"PATCH", src}, {"DELETE", doc}, {"POST", src + "/sync"}, {"GET", env.base + "/kbs"}, {"GET", env.base + "/agents"},
		{"GET", env.base + "/api-keys"}, {"GET", "/v1/conversations/" + cid}, {"GET", teamConvs},
	} {
		if code, _ := admin.call(c.method, c.path, map[string]any{}, nil, nil); code < 400 {
			t.Errorf("admin under documents session %s %s = %d", c.method, c.path, code)
		}
	}
	reads := bgReads(t, env.app, s1.Id.String())
	if reads["source_list"] != 1 || reads["source"] != 1 || reads["document_list"] != 1 || reads["document"] != 1 || reads["passages"] != 1 {
		t.Errorf("audited reads = %v", reads)
	}
	// Audit entries name the kind and target, never content; the team sees them.
	var metas []string
	rows, _ := env.app.Pool.Query(context.Background(), `SELECT metadata::text FROM audit_log WHERE action = 'breakglass.read' AND team_id = (SELECT id FROM teams WHERE slug = $1)`, env.team)
	for rows.Next() {
		var m string
		_ = rows.Scan(&m)
		metas = append(metas, m)
	}
	rows.Close()
	if len(metas) != 5 || strings.Contains(strings.Join(metas, ""), "parking") || strings.Contains(strings.Join(metas, ""), "Students") {
		t.Errorf("read metadata = %v", metas)
	}
	var detail apitypes.BreakGlassSessionDetail
	auditor.get("/v1/admin/break-glass/"+s1.Id.String(), &detail)
	if len(detail.Reads) != 5 {
		t.Errorf("detail reads = %+v", detail.Reads)
	}
	var log apitypes.BreakGlassReadPage
	if code := auditor.get("/v1/admin/break-glass/"+s1.Id.String()+"/reads?limit=2", &log); code != 200 || len(log.Items) != 2 || log.NextCursor == nil || log.Items[0].Kind != "passages" {
		t.Fatalf("read log = %d %+v", code, log)
	}
	auditor.get("/v1/admin/break-glass/"+s1.Id.String()+"/reads?limit=10&cursor="+*log.NextCursor, &log)
	if len(log.Items) != 3 || log.Items[2].Kind != "source_list" {
		t.Errorf("read log page 2 = %+v", log.Items)
	}

	// Ending stops access at once; the owners get the summary.
	code, _ = owner.call("POST", "/v1/admin/break-glass/"+s1.Id.String()+"/end", nil, nil, nil)
	if code != 403 {
		t.Errorf("owner ends = %d", code)
	}
	var ended apitypes.BreakGlassSessionDetail
	code, e = admin.call("POST", "/v1/admin/break-glass/"+s1.Id.String()+"/end", nil, &ended, nil)
	mustCode(t, "end", code, e, 200, "")
	if ended.Status != "ended" || ended.EndedBy == nil || ended.EndedBy.Email != "admin@localhost" {
		t.Errorf("ended = %+v", ended)
	}
	for _, p := range []string{env.base + "/sources", doc, doc + "/passages"} {
		if code, _ := admin.call("GET", p, nil, nil, nil); code != 404 {
			t.Errorf("after end GET %s = %d", p, code)
		}
	}
	code, e = admin.call("POST", "/v1/admin/break-glass/"+s1.Id.String()+"/end", nil, nil, nil)
	mustCode(t, "end twice", code, e, 409, "break_glass_closed")
	title, body = lastNotification(t, env.app, "user@localhost", "breakglass.ended")
	if !strings.Contains(title, "ended") || !strings.Contains(body, "- Documents: 1 document (1 read)") || !strings.Contains(body, "- Data source list: viewed once") {
		t.Errorf("ended notification = %q %q", title, body)
	}
	if n := env.app.count(t, `SELECT count(*) FROM audit_log WHERE action IN ('breakglass.start', 'breakglass.end') AND target_id = $1`, s1.Id.String()); n != 2 {
		t.Errorf("start/end audited %d times", n)
	}

	breakGlassConversations(t, env, cid)
}

// breakGlassConversations: the conversations scope lists the team's
// conversations and opens transcripts, audited; the user's own actions
// stay theirs.
func breakGlassConversations(t *testing.T, env *agentEnv, cid string) {
	admin := env.admin
	s := startBreakGlass(t, admin, env.team, "conversations")
	var page apitypes.TeamConversationPage
	if code := admin.get(env.base+"/conversations", &page); code != 200 || len(page.Items) != 1 || page.Items[0].Id.String() != cid || page.Items[0].Questions != 1 || page.Items[0].Anonymous {
		t.Fatalf("team conversations = %d %+v", code, page)
	}
	raw, _ := json.Marshal(page)
	if strings.Contains(string(raw), "blair") {
		t.Errorf("the list names the user: %s", raw)
	}
	var tr apitypes.ConversationDetail
	if code := admin.get("/v1/conversations/"+cid, &tr); code != 200 || len(tr.Messages) != 2 || !strings.Contains(tr.Messages[0].Text, "parking permit") {
		t.Fatalf("transcript = %d %+v", code, tr)
	}
	for _, c := range []struct{ method, path string }{
		{"GET", "/v1/conversations/" + cid + "/export"}, {"PATCH", "/v1/conversations/" + cid}, {"DELETE", "/v1/conversations/" + cid},
		{"GET", env.base + "/sources"},
	} {
		if code, _ := admin.call(c.method, c.path, map[string]any{"title": "x"}, nil, nil); code < 400 {
			t.Errorf("under conversations session %s %s = %d", c.method, c.path, code)
		}
	}
	if reads := bgReads(t, env.app, s.Id.String()); reads["conversation_list"] != 1 || reads["conversation"] != 1 || len(reads) != 2 {
		t.Errorf("conversation reads = %v", reads)
	}
	// The transcript is named nowhere in the read log.
	var log apitypes.BreakGlassReadPage
	admin.get("/v1/admin/break-glass/"+s.Id.String()+"/reads", &log)
	for _, r := range log.Items {
		if r.TargetType == "conversation" && r.TargetLabel != "" {
			t.Errorf("conversation named in the read log: %+v", r)
		}
	}
	// The user still owns it; a revoke by another admin is recorded as such.
	if code := env.member.get("/v1/conversations/"+cid, &tr); code != 200 {
		t.Errorf("owner reads own transcript = %d", code)
	}
	code, e := admin.call("POST", "/v1/admin/break-glass/"+s.Id.String()+"/end", nil, nil, nil)
	mustCode(t, "end conversations session", code, e, 200, "")
	if code, _ := admin.call("GET", "/v1/conversations/"+cid, nil, nil, nil); code != 404 {
		t.Errorf("transcript after end = %d", code)
	}
	_, body := lastNotification(t, env.app, "user@localhost", "breakglass.ended")
	if !strings.Contains(body, "- Conversation transcripts: 1 conversation (1 read)") {
		t.Errorf("summary = %q", body)
	}
}

// promote makes a signed-in user a platform admin (a second admin).
func promote(t *testing.T, admin, s *session) {
	t.Helper()
	var ud apitypes.UserDetail
	admin.get("/v1/admin/users/"+s.me.User.Id.String(), &ud)
	code, e := admin.call("PATCH", "/v1/admin/users/"+s.me.User.Id.String(), map[string]string{"platformRole": "platform_admin"}, nil, ifMatch(ud.User.Revision))
	mustCode(t, "promote", code, e, 200, "")
	s.refresh()
}

func TestBreakGlassApprovalExpiryAndSettings(t *testing.T) {
	env := newRAGEnv(t)
	app, admin, owner := env.app, env.admin, env.owner
	second, auditor := app.signIn("alex"), app.signIn("auditor")
	promote(t, admin, second)
	sources := "/v1/teams/" + env.team + "/sources"
	bg := func(id apitypes.BreakGlassSessionDetail, action string) string {
		return "/v1/admin/break-glass/" + id.Id.String() + "/" + action
	}

	// The setting: admins change it with If-Match; auditors read it.
	var set apitypes.BreakGlassSettings
	admin.get("/v1/admin/settings/break-glass", &set)
	on := map[string]any{"approvalRequired": true, "maxDurationMinutes": 120, "approvalTimeoutMinutes": 30}
	code, e := admin.call("PUT", "/v1/admin/settings/break-glass", on, nil, nil)
	mustCode(t, "no If-Match", code, e, 428, "")
	code, e = admin.call("PUT", "/v1/admin/settings/break-glass", on, nil, ifMatch(set.Revision+1))
	mustCode(t, "stale", code, e, 412, "")
	code, e = auditor.call("PUT", "/v1/admin/settings/break-glass", on, nil, ifMatch(set.Revision))
	mustCode(t, "auditor changes", code, e, 403, "forbidden")
	code, e = admin.call("PUT", "/v1/admin/settings/break-glass", map[string]any{"approvalRequired": true, "maxDurationMinutes": 5, "approvalTimeoutMinutes": 30}, nil, ifMatch(set.Revision))
	mustCode(t, "max too short", code, e, 400, "invalid_max_duration")
	code, e = admin.call("PUT", "/v1/admin/settings/break-glass", on, &set, ifMatch(set.Revision))
	mustCode(t, "require approval", code, e, 200, "")
	if !set.ApprovalRequired || set.MaxDurationMinutes != 120 || set.UpdatedBy == nil {
		t.Fatalf("settings = %+v", set)
	}

	// A request waits for a different admin; it grants nothing meanwhile.
	p := startBreakGlass(t, admin, env.team, "documents")
	if p.Status != "pending" || p.ApprovalDeadline == nil || p.StartedAt != nil {
		t.Fatalf("requested = %+v", p)
	}
	if title, _ := lastNotification(t, app, "alex@localhost", "breakglass.requested"); !strings.Contains(title, "approval needed") {
		t.Errorf("approval request = %q", title)
	}
	if n := app.count(t, `SELECT count(*) FROM notifications WHERE type = 'breakglass.started'`); n != 0 {
		t.Errorf("owners notified before approval: %d", n)
	}
	if code, _ := admin.call("GET", sources, nil, nil, nil); code != 404 {
		t.Errorf("pending session reads = %d", code)
	}
	code, e = admin.call("POST", bg(p, "approve"), nil, nil, nil)
	mustCode(t, "self-approval", code, e, 403, "forbidden")
	code, e = auditor.call("POST", bg(p, "approve"), nil, nil, nil)
	mustCode(t, "auditor approves", code, e, 403, "forbidden")
	var s apitypes.BreakGlassSessionDetail
	code, e = second.call("POST", bg(p, "approve"), nil, &s, nil)
	mustCode(t, "approve", code, e, 200, "")
	if s.Status != "active" || s.DecidedBy == nil || s.DecidedBy.Email != "alex@localhost" || s.ExpiresAt.Sub(*s.StartedAt) != time.Hour {
		t.Fatalf("approved = %+v", s)
	}
	code, e = second.call("POST", bg(p, "approve"), nil, nil, nil)
	mustCode(t, "approve twice", code, e, 409, "break_glass_not_pending")
	if _, body := lastNotification(t, app, "user@localhost", "breakglass.started"); !strings.Contains(body, "Approved by: Alex Dev") {
		t.Errorf("started body = %q", body)
	}
	if title, _ := lastNotification(t, app, "admin@localhost", "breakglass.decided"); !strings.Contains(title, "approved") {
		t.Errorf("decided = %q", title)
	}
	if code, _ := admin.call("GET", sources, nil, nil, nil); code != 200 {
		t.Errorf("approved session reads = %d", code)
	}
	// The approver has no access of their own.
	if code, _ := second.call("GET", sources, nil, nil, nil); code != 404 {
		t.Errorf("approver reads = %d", code)
	}
	// Another admin can revoke it.
	code, e = second.call("POST", bg(p, "end"), nil, &s, nil)
	mustCode(t, "revoke", code, e, 200, "")
	if s.Status != "ended" || s.EndedBy.Email != "alex@localhost" {
		t.Errorf("revoked = %+v", s)
	}
	if title, _ := lastNotification(t, app, "user@localhost", "breakglass.ended"); !strings.Contains(title, "was revoked") {
		t.Errorf("revoked title = %q", title)
	}
	if code, _ := admin.call("GET", sources, nil, nil, nil); code != 404 {
		t.Errorf("revoked session reads = %d", code)
	}

	// Denial needs a reason; withdrawing is the requester's.
	d := startBreakGlass(t, admin, env.team, "documents")
	code, e = second.call("POST", bg(d, "deny"), map[string]string{"reason": " "}, nil, nil)
	mustCode(t, "deny without reason", code, e, 400, "invalid_reason")
	code, e = second.call("POST", bg(d, "end"), nil, nil, nil)
	mustCode(t, "withdraw someone else's", code, e, 409, "break_glass_not_yours")
	code, e = second.call("POST", bg(d, "deny"), map[string]string{"reason": "Ask the team first"}, &s, nil)
	mustCode(t, "deny", code, e, 200, "")
	if s.Status != "denied" || s.DecisionNote != "Ask the team first" {
		t.Errorf("denied = %+v", s)
	}
	if _, body := lastNotification(t, app, "admin@localhost", "breakglass.decided"); !strings.Contains(body, "Ask the team first") {
		t.Errorf("denied body = %q", body)
	}
	c := startBreakGlass(t, admin, env.team, "documents")
	code, e = admin.call("POST", bg(c, "end"), nil, &s, nil)
	mustCode(t, "withdraw", code, e, 200, "")
	if s.Status != "cancelled" {
		t.Errorf("withdrawn = %+v", s)
	}

	// A request nobody approves lapses.
	l := startBreakGlass(t, admin, env.team, "documents")
	ctx := context.Background()
	if _, err := app.Pool.Exec(ctx, `UPDATE break_glass_sessions SET approval_deadline = now() - interval '1 second' WHERE id = $1`, l.Id); err != nil {
		t.Fatal(err)
	}
	code, e = second.call("POST", bg(l, "approve"), nil, nil, nil)
	mustCode(t, "approve lapsed", code, e, 409, "break_glass_not_pending")
	if n, err := app.Svc.BreakGlass.Sweep(ctx); err != nil || n != 1 {
		t.Fatalf("sweep = %d %v", n, err)
	}
	var got apitypes.BreakGlassSessionDetail
	admin.get("/v1/admin/break-glass/"+l.Id.String(), &got)
	if got.Status != "request_expired" {
		t.Errorf("lapsed = %+v", got)
	}

	// Without approval, a session starts at once and expires on time: reads
	// stop at the end even before the sweep records it.
	admin.get("/v1/admin/settings/break-glass", &set)
	code, e = admin.call("PUT", "/v1/admin/settings/break-glass", map[string]any{"approvalRequired": false, "maxDurationMinutes": 120, "approvalTimeoutMinutes": 30}, &set, ifMatch(set.Revision))
	mustCode(t, "approval off", code, e, 200, "")
	x := startBreakGlass(t, admin, env.team, "documents")
	if x.Status != "active" {
		t.Fatalf("started = %+v", x)
	}
	if code, _ := admin.call("GET", sources, nil, nil, nil); code != 200 {
		t.Errorf("active reads = %d", code)
	}
	if _, err := app.Pool.Exec(ctx, `UPDATE break_glass_sessions SET expires_at = now() - interval '1 second' WHERE id = $1`, x.Id); err != nil {
		t.Fatal(err)
	}
	if code, _ := admin.call("GET", sources, nil, nil, nil); code != 404 {
		t.Errorf("expired session reads = %d", code)
	}
	if n, err := app.Svc.BreakGlass.Sweep(ctx); err != nil || n != 1 {
		t.Fatalf("sweep = %d %v", n, err)
	}
	var mine []apitypes.BreakGlassSession
	if admin.get("/v1/me/break-glass", &mine); len(mine) != 0 {
		t.Errorf("expired session still open: %+v", mine)
	}
	if title, body := lastNotification(t, app, "user@localhost", "breakglass.ended"); !strings.Contains(title, "expired") || !strings.Contains(body, "- Data source list: viewed once") {
		t.Errorf("expired summary = %q %q", title, body)
	}
	for action, want := range map[string]int{
		"breakglass.start": 5, "breakglass.approve": 1, "breakglass.deny": 1, "breakglass.cancel": 1, "breakglass.end": 1,
		"breakglass.request_expire": 1, "breakglass.expire": 1, "platform.break_glass_settings_update": 2,
	} {
		if n := app.count(t, `SELECT count(*) FROM audit_log WHERE action = $1`, action); n != want {
			t.Errorf("%s audited %d times, want %d", action, n, want)
		}
	}
	// Owners and admins of the team see break-glass in their audit log.
	var teamLog apitypes.AuditPage
	owner.get("/v1/teams/"+env.team+"/audit?action=breakglass.&limit=200", &teamLog)
	if len(teamLog.Items) == 0 {
		t.Error("break-glass is missing from the team's audit log")
	}
	// The admin list: open and closed.
	var open apitypes.BreakGlassSessionPage
	if admin.get("/v1/admin/break-glass?state=open", &open); len(open.Items) != 0 {
		t.Errorf("open sessions = %+v", open.Items)
	}
	var all apitypes.BreakGlassSessionPage
	if auditor.get("/v1/admin/break-glass?team="+env.team+"&limit=3", &all); len(all.Items) != 3 || all.NextCursor == nil {
		t.Errorf("sessions page = %+v", all)
	}
}
