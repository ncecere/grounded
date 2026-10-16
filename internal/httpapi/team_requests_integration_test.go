package httpapi_test

import (
	"context"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// In-app team requests (v0.6.0, E3).

type reqEnv struct {
	app                               *testApp
	admin, auditor, user, alex, casey *session
}

func newReqEnv(t *testing.T) *reqEnv {
	t.Helper()
	app := newTestApp(t, nil)
	return &reqEnv{app: app, admin: app.signIn("admin"), auditor: app.signIn("auditor"), user: app.signIn("user"), alex: app.signIn("alex"), casey: app.signIn("casey")}
}

func (e *reqEnv) settings(t *testing.T) apitypes.TeamRequestSettings {
	t.Helper()
	var st apitypes.TeamRequestSettings
	if code := e.admin.get("/v1/admin/settings/team-requests", &st); code != 200 {
		t.Fatalf("settings = %d", code)
	}
	return st
}

func (e *reqEnv) configure(t *testing.T, enabled bool, maxOpen int, group string) {
	t.Helper()
	st := e.settings(t)
	code, c := e.admin.call("PUT", "/v1/admin/settings/team-requests", map[string]any{"enabled": enabled, "maxOpen": maxOpen, "allowedGroup": group}, nil, ifMatch(st.Revision))
	mustCode(t, "configure team requests", code, c, 200, "")
}

func (e *reqEnv) ask(t *testing.T, s *session, name string) apitypes.TeamRequest {
	t.Helper()
	var r apitypes.TeamRequest
	code, c := s.call("POST", "/v1/team-requests", map[string]any{"name": name, "purpose": "Run " + name + " together.", "classification": "open"}, &r, nil)
	mustCode(t, "ask for "+name, code, c, 201, "")
	return r
}

func (e *reqEnv) mine(t *testing.T, s *session) apitypes.TeamRequestsOverview {
	t.Helper()
	var m apitypes.TeamRequestsOverview
	if code := s.get("/v1/team-requests", &m); code != 200 {
		t.Fatalf("mine = %d", code)
	}
	return m
}

func (e *reqEnv) adminRequest(t *testing.T, id string) (apitypes.AdminTeamRequest, int64) {
	t.Helper()
	var r apitypes.AdminTeamRequest
	if code := e.admin.get("/v1/admin/team-requests/"+id, &r); code != 200 {
		t.Fatalf("admin get %s = %d", id, code)
	}
	return r, r.Revision
}

func (e *reqEnv) notified(t *testing.T, s *session, typ string) int {
	t.Helper()
	return e.app.count(t, `SELECT count(*) FROM notifications WHERE type = $1 AND user_id = $2::uuid`, typ, s.me.User.Id.String())
}

func TestTeamRequestsAreOffByDefault(t *testing.T) {
	e := newReqEnv(t)
	st := e.settings(t)
	if st.Enabled || st.MaxOpen != 2 || st.AllowedGroup != "" {
		t.Fatalf("defaults = %+v", st)
	}
	e.user.refresh()
	if e.user.me.Capabilities.TeamRequests == nil || *e.user.me.Capabilities.TeamRequests {
		t.Errorf("the capability while off = %v", e.user.me.Capabilities.TeamRequests)
	}
	m := e.mine(t, e.user)
	if m.Enabled || m.CanAsk || m.Blocked != "off" || len(m.Items) != 0 {
		t.Errorf("mine while off = %+v", m)
	}
	// Off refuses new requests in the API too, and creates nothing.
	code, c := e.user.call("POST", "/v1/team-requests", map[string]any{"name": "Library", "purpose": "Books", "classification": "open"}, nil, nil)
	mustCode(t, "ask while off", code, c, 403, "team_requests_off")
	if n := e.app.count(t, `SELECT count(*) FROM team_requests`); n != 0 {
		t.Errorf("a refused request left %d rows", n)
	}
	// Who may see and change the switch: platform staff read it, only platform admins change it, nobody else sees it.
	if code := e.auditor.get("/v1/admin/settings/team-requests", &st); code != 200 {
		t.Errorf("auditor reading the settings = %d", code)
	}
	code, c = e.auditor.call("PUT", "/v1/admin/settings/team-requests", map[string]any{"enabled": true, "maxOpen": 2, "allowedGroup": ""}, nil, ifMatch(st.Revision))
	mustCode(t, "auditor changing the settings", code, c, 403, "forbidden")
	if code := e.user.get("/v1/admin/settings/team-requests", nil); code != 403 {
		t.Errorf("a plain user reading the settings = %d", code)
	}
	// The switch needs the current revision.
	code, c = e.admin.call("PUT", "/v1/admin/settings/team-requests", map[string]any{"enabled": true, "maxOpen": 2, "allowedGroup": ""}, nil, nil)
	mustCode(t, "no If-Match", code, c, 428, "")
	code, c = e.admin.call("PUT", "/v1/admin/settings/team-requests", map[string]any{"enabled": true, "maxOpen": 2, "allowedGroup": ""}, nil, ifMatch(st.Revision+7))
	mustCode(t, "stale If-Match", code, c, 412, "")
	for _, bad := range []map[string]any{
		{"enabled": true, "maxOpen": 0, "allowedGroup": ""}, {"enabled": true, "maxOpen": 21, "allowedGroup": ""},
		{"enabled": true, "maxOpen": 2, "allowedGroup": strings.Repeat("g", 300)},
	} {
		code, c = e.admin.call("PUT", "/v1/admin/settings/team-requests", bad, nil, ifMatch(st.Revision))
		if code != 400 {
			t.Errorf("settings %v = %d %s, want 400", bad, code, c)
		}
	}
	// Turning it on is audited, and the group is kept lower-cased.
	e.configure(t, true, 3, "  Library-Staff ")
	st = e.settings(t)
	if !st.Enabled || st.MaxOpen != 3 || st.AllowedGroup != "library-staff" {
		t.Errorf("saved = %+v", st)
	}
	if n := e.app.count(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.team_requests' AND after_state->>'allowedGroup' = 'library-staff'`); n != 1 {
		t.Errorf("settings audit entries = %d", n)
	}
	e.user.refresh()
	if e.user.me.Capabilities.TeamRequests == nil || !*e.user.me.Capabilities.TeamRequests {
		t.Error("the capability is not on after turning the feature on")
	}
}

func TestTeamRequestLimitsAndWithdrawing(t *testing.T) {
	e := newReqEnv(t)
	e.configure(t, true, 2, "")

	// Validation, then nothing is left behind.
	for name, body := range map[string]map[string]any{
		"empty name":    {"name": " ", "purpose": "x", "classification": "open"},
		"long name":     {"name": strings.Repeat("n", 81), "purpose": "x", "classification": "open"},
		"no purpose":    {"name": "A", "purpose": "", "classification": "open"},
		"long purpose":  {"name": "A", "purpose": strings.Repeat("p", 1001), "classification": "open"},
		"bad owner":     {"name": "A", "purpose": "x", "classification": "open", "ownerEmail": "not an email"},
		"bad level":     {"name": "A", "purpose": "x", "classification": "top_secret"},
		"missing level": {"name": "A", "purpose": "x", "classification": ""},
	} {
		if code, c := e.user.call("POST", "/v1/team-requests", body, nil, nil); code != 400 {
			t.Errorf("%s: %d %s, want 400", name, code, c)
		}
	}
	if n := e.app.count(t, `SELECT count(*) FROM team_requests`); n != 0 {
		t.Fatalf("refused requests left %d rows", n)
	}

	first, second := e.ask(t, e.user, "Library tech"), e.ask(t, e.user, "Reading room")
	if first.Status != "pending" || first.Classification != "open" || first.OwnerEmail != "" {
		t.Errorf("first = %+v", first)
	}
	m := e.mine(t, e.user)
	if !m.Enabled || m.CanAsk || m.Blocked != "limit" || m.OpenCount != 2 || m.MaxOpen != 2 || len(m.Items) != 2 || m.Items[0].Name != "Reading room" {
		t.Errorf("mine at the limit = %+v", m)
	}
	code, c := e.user.call("POST", "/v1/team-requests", map[string]any{"name": "Third", "purpose": "x", "classification": "open"}, nil, nil)
	mustCode(t, "over the limit", code, c, 409, "too_many_open_requests")
	// The limit is per person.
	e.ask(t, e.alex, "Alex's team")

	// The platform admins are told, once per request; the person who asked is not.
	admin := e.notified(t, e.admin, "team.request_new")
	if admin != 3 || e.notified(t, e.user, "team.request_new") != 0 {
		t.Errorf("new-request notifications: admin %d (want 3), requester %d", admin, e.notified(t, e.user, "team.request_new"))
	}

	// Only the person who asked can withdraw, and only while pending; others get the same 404 as for a request that is not there.
	code, c = e.alex.call("POST", "/v1/team-requests/"+first.Id.String()+"/withdraw", nil, nil, nil)
	mustCode(t, "someone else withdraws", code, c, 404, "request_not_found")
	code, c = e.user.call("POST", "/v1/team-requests/"+first.Id.String()+"/withdraw", nil, nil, nil)
	mustCode(t, "withdraw", code, c, 200, "")
	code, c = e.user.call("POST", "/v1/team-requests/"+first.Id.String()+"/withdraw", nil, nil, nil)
	mustCode(t, "withdraw twice", code, c, 404, "request_not_found")
	m = e.mine(t, e.user)
	if !m.CanAsk || m.OpenCount != 1 || m.Blocked != "" {
		t.Errorf("after withdrawing = %+v", m)
	}
	e.ask(t, e.user, "Third, now")
	if got, _ := e.adminRequest(t, first.Id.String()); got.Status != "withdrawn" {
		t.Errorf("withdrawn request = %+v", got)
	}

	// The review queue: pending first, oldest first; staff read it, a plain user does not.
	var queue []apitypes.AdminTeamRequest
	if code := e.auditor.get("/v1/admin/team-requests", &queue); code != 200 || len(queue) != 4 {
		t.Fatalf("queue = %d, %d items", code, len(queue))
	}
	if queue[0].Name != "Reading room" || queue[0].RequesterEmail != "user@localhost" || queue[len(queue)-1].Status != "withdrawn" {
		t.Errorf("queue order/fields = %+v ... %+v", queue[0], queue[len(queue)-1])
	}
	var pending []apitypes.AdminTeamRequest
	e.admin.get("/v1/admin/team-requests?status=pending", &pending)
	if len(pending) != 3 {
		t.Errorf("pending = %d, want 3", len(pending))
	}
	if code := e.user.get("/v1/admin/team-requests", nil); code != 403 {
		t.Errorf("a plain user reading the queue = %d", code)
	}
	if code, _ := e.admin.call("GET", "/v1/admin/team-requests?status=bogus", nil, nil, nil); code != 400 {
		t.Errorf("a bad status filter = %d", code)
	}
	_ = second
}

func TestTeamRequestWhoMayAskAndWhileOff(t *testing.T) {
	e := newReqEnv(t)
	e.configure(t, true, 5, "Library-Staff")

	// A required SSO group: no groups seen, or other groups, is refused; the group matches ignoring case.
	m := e.mine(t, e.user)
	if m.CanAsk || m.Blocked != "group" {
		t.Errorf("mine without the group = %+v", m)
	}
	code, c := e.user.call("POST", "/v1/team-requests", map[string]any{"name": "A", "purpose": "x", "classification": "open"}, nil, nil)
	mustCode(t, "no groups seen", code, c, 403, "not_allowed_to_request")
	uid := e.user.me.User.Id.String()
	if _, err := e.app.Pool.Exec(context.Background(), `INSERT INTO sso_user_groups (user_id, groups, claim_present) VALUES ($1::uuid, '{other}', true) ON CONFLICT (user_id) DO UPDATE SET groups = EXCLUDED.groups, claim_present = true`, uid); err != nil {
		t.Fatal(err)
	}
	code, c = e.user.call("POST", "/v1/team-requests", map[string]any{"name": "A", "purpose": "x", "classification": "open"}, nil, nil)
	mustCode(t, "other groups", code, c, 403, "not_allowed_to_request")
	if _, err := e.app.Pool.Exec(context.Background(), `UPDATE sso_user_groups SET groups = '{other,library-staff}' WHERE user_id = $1::uuid`, uid); err != nil {
		t.Fatal(err)
	}
	pending := e.ask(t, e.user, "Staff team")
	if m := e.mine(t, e.user); !m.CanAsk {
		t.Errorf("mine with the group = %+v", m)
	}

	// Off while a request is open: no new requests, but the queue still works and the person can withdraw; turning it off changes nothing else.
	e.configure(t, false, 5, "")
	code, c = e.user.call("POST", "/v1/team-requests", map[string]any{"name": "B", "purpose": "x", "classification": "open"}, nil, nil)
	mustCode(t, "ask after turning it off", code, c, 403, "team_requests_off")
	if m := e.mine(t, e.user); m.Enabled || m.CanAsk || m.Blocked != "off" || m.OpenCount != 1 || len(m.Items) != 1 {
		t.Errorf("mine while off with one open = %+v", m)
	}
	var queue []apitypes.AdminTeamRequest
	e.admin.get("/v1/admin/team-requests?status=pending", &queue)
	if len(queue) != 1 || queue[0].Id != pending.Id {
		t.Errorf("the open request left the queue when the feature went off: %+v", queue)
	}
	r, rev := e.adminRequest(t, pending.Id.String())
	code, c = e.admin.call("POST", "/v1/admin/team-requests/"+r.Id.String()+"/decline", map[string]any{"reason": "Not now"}, nil, ifMatch(rev))
	mustCode(t, "decide while off", code, c, 200, "")
}

func TestTeamRequestDecisions(t *testing.T) {
	e := newReqEnv(t)
	e.configure(t, true, 9, "")
	createTeam(t, e.admin, "taken", "casey@localhost")
	before := e.app.count(t, `SELECT count(*) FROM teams`)

	// Decline: the reason is required and reaches the person who asked.
	declined := e.ask(t, e.user, "Declined team")
	r, rev := e.adminRequest(t, declined.Id.String())
	path := "/v1/admin/team-requests/" + r.Id.String()
	code, c := e.admin.call("POST", path+"/decline", map[string]any{"reason": " "}, nil, ifMatch(rev))
	mustCode(t, "decline without a reason", code, c, 400, "invalid_reason")
	code, c = e.admin.call("POST", path+"/decline", map[string]any{"reason": "A team already covers this"}, nil, nil)
	mustCode(t, "decline without If-Match", code, c, 428, "")
	code, c = e.admin.call("POST", path+"/decline", map[string]any{"reason": "A team already covers this"}, nil, ifMatch(rev+5))
	mustCode(t, "decline with a stale revision", code, c, 412, "")
	code, c = e.auditor.call("POST", path+"/decline", map[string]any{"reason": "x"}, nil, ifMatch(rev))
	mustCode(t, "an auditor declines", code, c, 403, "forbidden")
	code, c = e.user.call("POST", path+"/decline", map[string]any{"reason": "x"}, nil, ifMatch(rev))
	mustCode(t, "the requester declines their own", code, c, 403, "")
	var done apitypes.AdminTeamRequest
	code, c = e.admin.call("POST", path+"/decline", map[string]any{"reason": "A team already covers this"}, &done, ifMatch(rev))
	mustCode(t, "decline", code, c, 200, "")
	if done.Status != "declined" || done.DecisionReason != "A team already covers this" || done.DecidedAt == nil || done.DeciderEmail != "admin@localhost" {
		t.Errorf("declined = %+v", done)
	}
	if m := e.mine(t, e.user); m.Items[0].DecisionReason != "A team already covers this" || m.Items[0].Status != "declined" || m.OpenCount != 0 {
		t.Errorf("the requester sees %+v", m.Items[0])
	}
	if e.notified(t, e.user, "team.request_decided") != 1 {
		t.Error("the requester was not told of the decision")
	}
	code, c = e.admin.call("POST", path+"/decline", map[string]any{"reason": "again"}, nil, ifMatch(done.Revision))
	mustCode(t, "decline twice", code, c, 409, "request_already_decided")
	code, c = e.admin.call("POST", path+"/approve", map[string]any{"slug": "declined-team"}, nil, ifMatch(done.Revision))
	mustCode(t, "approve a declined request", code, c, 409, "request_already_decided")

	// Approve fails whole: nothing is created and the request stays pending (a taken address, a bad one, an unknown template).
	pend := e.ask(t, e.user, "Library tech")
	r, rev = e.adminRequest(t, pend.Id.String())
	path = "/v1/admin/team-requests/" + r.Id.String()
	for name, tc := range map[string]struct {
		body map[string]any
		code int
		err  string
	}{
		"taken slug":       {map[string]any{"slug": "taken"}, 409, "slug_taken"},
		"bad slug":         {map[string]any{"slug": "Not A Slug"}, 400, ""},
		"unknown template": {map[string]any{"slug": "library-tech", "starterTemplateId": "no-such"}, 404, "template_not_found"},
		"unknown level":    {map[string]any{"slug": "library-tech", "maxClassification": "nope"}, 400, ""},
	} {
		code, c := e.admin.call("POST", path+"/approve", tc.body, nil, ifMatch(rev))
		if code != tc.code || (tc.err != "" && c != tc.err) {
			t.Errorf("%s: %d %s, want %d %s", name, code, c, tc.code, tc.err)
		}
	}
	if got, _ := e.adminRequest(t, pend.Id.String()); got.Status != "pending" || got.TeamSlug != "" {
		t.Errorf("a failed approval changed the request: %+v", got)
	}
	if n := e.app.count(t, `SELECT count(*) FROM teams`); n != before {
		t.Errorf("failed approvals left %d teams", n-before)
	}
	code, c = e.auditor.call("POST", path+"/approve", map[string]any{"slug": "library-tech"}, nil, ifMatch(rev))
	mustCode(t, "an auditor approves", code, c, 403, "forbidden")
	code, c = e.admin.call("POST", path+"/approve", map[string]any{"slug": "library-tech"}, nil, ifMatch(rev+5))
	mustCode(t, "approve with a stale revision", code, c, 412, "")
	code, c = e.admin.call("POST", path+"/approve", map[string]any{"slug": "library-tech"}, nil, nil)
	mustCode(t, "approve without If-Match", code, c, 428, "")

	// Approve: the team exists, the requester owns it, the reviewer's changes apply, a starter agent is made from the template.
	code, c = e.admin.call("POST", path+"/approve", map[string]any{
		"slug": "library-tech", "name": "Library Technology", "maxClassification": "sensitive", "starterTemplateId": "service-desk-faq",
	}, &done, ifMatch(rev))
	mustCode(t, "approve", code, c, 200, "")
	if done.Status != "approved" || done.TeamSlug != "library-tech" || done.TeamName != "Library Technology" {
		t.Errorf("approved = %+v", done)
	}
	e.user.refresh()
	owned := false
	for _, tm := range e.user.me.Teams {
		owned = owned || (tm.Slug == "library-tech" && tm.Role == "owner")
	}
	if !owned {
		t.Errorf("the requester is not the owner: %+v", e.user.me.Teams)
	}
	var team apitypes.TeamSummary
	e.admin.get("/v1/admin/teams/library-tech", &team)
	if team.Team.MaxClassification != "sensitive" || team.Team.Name != "Library Technology" || !strings.Contains(team.Team.Description, "Run Library tech together") {
		t.Errorf("team = %+v", team.Team)
	}
	if n := e.app.count(t, `SELECT count(*) FROM agents a JOIN teams t ON t.id = a.team_id WHERE t.slug = 'library-tech' AND a.name = 'Service desk FAQ'
		AND a.draft->>'instructions' LIKE 'You answer questions for people who need help%' AND a.draft->>'audience' = 'team'`); n != 1 {
		t.Errorf("starter agents = %d", n)
	}
	if e.notified(t, e.user, "team.request_decided") != 2 {
		t.Error("the requester was not told the request was approved")
	}
	// The new team's own audit log shows how it came to be.
	if n := e.app.count(t, `SELECT count(*) FROM audit_log a JOIN teams t ON t.id = a.team_id WHERE t.slug = 'library-tech' AND a.action IN ('team_request.approve', 'team.create')`); n != 2 {
		t.Errorf("the new team's audit log has %d of the 2 entries", n)
	}
	code, c = e.admin.call("POST", path+"/approve", map[string]any{"slug": "library-tech-2"}, nil, ifMatch(done.Revision))
	mustCode(t, "approve twice", code, c, 409, "request_already_decided")

	// Another owner: the team goes to the person named, and the requester is told but is not on it.
	var other apitypes.TeamRequest
	code, c = e.user.call("POST", "/v1/team-requests", map[string]any{"name": "For Casey", "purpose": "Casey will run it", "classification": "open", "ownerEmail": "Casey@Localhost"}, &other, nil)
	mustCode(t, "ask with an owner", code, c, 201, "")
	if other.OwnerEmail != "casey@localhost" {
		t.Errorf("owner email = %q", other.OwnerEmail)
	}
	r, rev = e.adminRequest(t, other.Id.String())
	code, c = e.admin.call("POST", "/v1/admin/team-requests/"+r.Id.String()+"/approve", map[string]any{"slug": "for-casey"}, nil, ifMatch(rev))
	mustCode(t, "approve for another owner", code, c, 200, "")
	e.user.refresh()
	e.casey.refresh()
	isMember := func(s *session, slug string) string {
		for _, tm := range s.me.Teams {
			if tm.Slug == slug {
				return string(tm.Role)
			}
		}
		return ""
	}
	if isMember(e.casey, "for-casey") != "owner" || isMember(e.user, "for-casey") != "" {
		t.Errorf("owners of for-casey: casey=%q requester=%q", isMember(e.casey, "for-casey"), isMember(e.user, "for-casey"))
	}
	if e.notified(t, e.user, "team.request_decided") != 3 {
		t.Error("the requester was not told")
	}
	// A named owner who has never signed in is invited, and the request still completes.
	code, c = e.user.call("POST", "/v1/team-requests", map[string]any{"name": "For a newcomer", "purpose": "x", "classification": "open", "ownerEmail": "newcomer@example.edu"}, &other, nil)
	mustCode(t, "ask for a newcomer", code, c, 201, "")
	r, rev = e.adminRequest(t, other.Id.String())
	code, c = e.admin.call("POST", "/v1/admin/team-requests/"+r.Id.String()+"/approve", map[string]any{"slug": "newcomer"}, nil, ifMatch(rev))
	mustCode(t, "approve for a newcomer", code, c, 200, "")
	if n := e.app.count(t, `SELECT count(*) FROM team_invites i JOIN teams t ON t.id = i.team_id WHERE t.slug = 'newcomer' AND i.email = 'newcomer@example.edu' AND i.role = 'owner'`); n != 1 {
		t.Errorf("owner invites = %d", n)
	}

	// Everything is audited.
	for _, action := range []string{"team_request.create", "team_request.decline", "team_request.approve"} {
		if n := e.app.count(t, `SELECT count(*) FROM audit_log WHERE action = $1`, action); n == 0 {
			t.Errorf("no %s audit entry", action)
		}
	}
}
