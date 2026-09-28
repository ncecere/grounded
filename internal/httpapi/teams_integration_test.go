package httpapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// session is one signed-in browser.
type session struct {
	t      *testing.T
	app    *testApp
	client *http.Client
	csrf   string
	me     apitypes.Me
}

func (a *testApp) signIn(account string) *session {
	a.t.Helper()
	jar, _ := cookiejar.New(nil)
	s := &session{t: a.t, app: a, client: &http.Client{Jar: jar}}
	if code, body := s.raw("POST", "/auth/dev", map[string]string{"account": account}, nil); code != 200 {
		a.t.Fatalf("sign in %s: %d %s", account, code, body)
	}
	s.refresh()
	return s
}

func (s *session) refresh() {
	s.t.Helper()
	var me apitypes.Me
	if code := s.get("/v1/me", &me); code != 200 {
		s.t.Fatalf("/v1/me = %d", code)
	}
	s.me, s.csrf = me, me.CsrfToken
}

func (s *session) raw(method, path string, body any, headers map[string]string) (int, []byte) {
	s.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, s.app.URL+path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		req.Header.Set("Origin", s.app.URL)
		req.Header.Set("X-CSRF-Token", s.csrf)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := s.client.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer res.Body.Close()
	out, _ := io.ReadAll(res.Body)
	return res.StatusCode, out
}

// call performs a request and decodes {"data": ...} into out on 2xx.
func (s *session) call(method, path string, body, out any, headers map[string]string) (int, string) {
	s.t.Helper()
	code, raw := s.raw(method, path, body, headers)
	if code >= 200 && code < 300 && out != nil {
		env := struct{ Data any }{Data: out}
		if err := json.Unmarshal(raw, &env); err != nil {
			s.t.Fatalf("decode %s %s: %v: %s", method, path, err, raw)
		}
	}
	return code, errorCode(raw)
}

func (s *session) get(path string, out any) int {
	s.t.Helper()
	code, _ := s.call("GET", path, nil, out, nil)
	return code
}

func ifMatch(rev int64) map[string]string {
	return map[string]string{"If-Match": `"` + itoa(rev) + `"`}
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func mustCode(t *testing.T, what string, gotCode int, gotErr string, wantCode int, wantErr string) {
	t.Helper()
	if gotCode != wantCode || (wantErr != "" && gotErr != wantErr) {
		t.Fatalf("%s: got %d %q, want %d %q", what, gotCode, gotErr, wantCode, wantErr)
	}
}

func createTeam(t *testing.T, admin *session, slug, owner string) apitypes.TeamCreated {
	t.Helper()
	var out apitypes.TeamCreated
	code, e := admin.call("POST", "/v1/admin/teams", map[string]any{
		"slug": slug, "name": strings.ToUpper(slug), "maxClassification": "sensitive", "ownerEmail": owner,
	}, &out, nil)
	mustCode(t, "create team", code, e, 201, "")
	return out
}

func TestTeamLifecycleAndMembership(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	owner := app.signIn("user")

	created := createTeam(t, admin, "registrar", "user@localhost")
	if created.Owner.Status != "added" || created.Team.OwnerCount != 1 {
		t.Fatalf("owner not added: %+v", created)
	}
	owner.refresh()
	if len(owner.me.Teams) != 1 || owner.me.Teams[0].Role != "owner" || owner.me.Teams[0].Slug != "registrar" {
		t.Fatalf("owner memberships = %+v", owner.me.Teams)
	}

	// Invite someone who has never signed in; they join on first sign-in.
	var added apitypes.MemberAddResult
	code, e := owner.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "Alex@Localhost", "role": "editor"}, &added, nil)
	mustCode(t, "invite alex", code, e, 201, "")
	if added.Status != "invited" || added.Invite == nil || added.Invite.Email != "alex@localhost" {
		t.Fatalf("expected invite, got %+v", added)
	}
	var invites []apitypes.Invite
	if owner.get("/v1/teams/registrar/invites", &invites); len(invites) != 1 {
		t.Fatalf("invites = %+v", invites)
	}
	alex := app.signIn("alex")
	if len(alex.me.Teams) != 1 || alex.me.Teams[0].Role != "editor" {
		t.Fatalf("invite not accepted at sign-in: %+v", alex.me.Teams)
	}
	if owner.get("/v1/teams/registrar/invites", &invites); len(invites) != 0 {
		t.Fatalf("accepted invite still open: %+v", invites)
	}

	// Add an existing user directly; adding again conflicts.
	app.signIn("blair")
	code, e = owner.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "blair@localhost", "role": "member"}, &added, nil)
	mustCode(t, "add blair", code, e, 201, "")
	if added.Status != "added" {
		t.Fatalf("blair status = %s", added.Status)
	}
	code, e = owner.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "blair@localhost", "role": "member"}, nil, nil)
	mustCode(t, "add blair again", code, e, 409, "already_member")

	// Editors cannot manage members.
	code, e = alex.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "casey@localhost", "role": "member"}, nil, nil)
	mustCode(t, "editor adds member", code, e, 403, "forbidden")

	// Role change needs If-Match; stale revisions are rejected.
	var members []apitypes.Member
	owner.get("/v1/teams/registrar/members", &members)
	var blair apitypes.Member
	for _, m := range members {
		if m.User.Email == "blair@localhost" {
			blair = m
		}
	}
	path := "/v1/teams/registrar/members/" + blair.User.Id.String()
	code, e = owner.call("PATCH", path, map[string]string{"role": "admin"}, nil, nil)
	mustCode(t, "patch without If-Match", code, e, 428, "revision_required")
	code, e = owner.call("PATCH", path, map[string]string{"role": "admin"}, nil, ifMatch(blair.Revision+5))
	mustCode(t, "stale patch", code, e, 412, "revision_conflict")
	var updated apitypes.Member
	code, e = owner.call("PATCH", path, map[string]string{"role": "admin"}, &updated, ifMatch(blair.Revision))
	mustCode(t, "promote blair", code, e, 200, "")
	if updated.Role != "admin" || updated.Revision != blair.Revision+1 {
		t.Fatalf("updated = %+v", updated)
	}

	// Team admins cannot touch owners or create them.
	blairS := app.signIn("blair")
	ownerID := owner.me.User.Id.String()
	code, e = blairS.call("DELETE", "/v1/teams/registrar/members/"+ownerID, nil, nil, nil)
	mustCode(t, "admin removes owner", code, e, 403, "forbidden")
	code, e = blairS.call("POST", "/v1/teams/registrar/members", map[string]string{"email": "casey@localhost", "role": "owner"}, nil, nil)
	mustCode(t, "admin invites owner", code, e, 403, "forbidden")

	// The last owner can neither leave nor be demoted.
	code, e = owner.call("DELETE", "/v1/teams/registrar/members/"+ownerID, nil, nil, nil)
	mustCode(t, "last owner leaves", code, e, 409, "last_owner")

	// Non-members cannot see the team at all; platform auditors can.
	casey := app.signIn("casey")
	code, e = casey.call("GET", "/v1/teams/registrar", nil, nil, nil)
	mustCode(t, "non-member reads team", code, e, 404, "team_not_found")
	auditor := app.signIn("auditor")
	var view apitypes.TeamView
	if code := auditor.get("/v1/teams/registrar", &view); code != 200 || view.Role != nil {
		t.Fatalf("auditor view = %d %+v", code, view)
	}

	// Members can leave.
	code, e = alex.call("DELETE", "/v1/teams/registrar/members/"+alex.me.User.Id.String(), nil, nil, nil)
	mustCode(t, "editor leaves", code, e, 200, "")

	// Team audit: editors and above, members cannot.
	var page apitypes.AuditPage
	if code := owner.get("/v1/teams/registrar/audit", &page); code != 200 {
		t.Fatalf("team audit = %d", code)
	}
	var actions []string
	for _, it := range page.Items {
		actions = append(actions, it.Action)
	}
	for _, want := range []string{"team.create", "team.owner_assign", "team.invite_create", "team.invite_accept", "team.member_add", "team.member_role_change", "team.member_leave"} {
		if !strings.Contains(strings.Join(actions, ","), want) {
			t.Errorf("team audit missing %s (have %v)", want, actions)
		}
	}

	// One entry by ID (a linked entry): the team's own only.
	first := page.Items[len(page.Items)-1]
	var entry apitypes.AuditEntry
	if code := owner.get(fmt.Sprintf("/v1/teams/registrar/audit/%d", first.Id), &entry); code != 200 || entry.Id != first.Id || entry.Action != first.Action {
		t.Fatalf("audit entry = %d %+v, want %+v", code, entry, first)
	}
	code, e = owner.call("GET", fmt.Sprintf("/v1/teams/registrar/audit/%d", first.Id+1_000_000), nil, nil, nil)
	mustCode(t, "missing audit entry", code, e, 404, "not_found")
	code, e = owner.call("GET", "/v1/teams/registrar/audit/abc", nil, nil, nil)
	mustCode(t, "bad audit entry id", code, e, 400, "invalid_id")
}

func TestTeamCreationRules(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	user := app.signIn("user")
	auditor := app.signIn("auditor")

	body := map[string]any{"slug": "ok-team", "name": "OK", "maxClassification": "open", "ownerEmail": "new@example.edu"}
	code, e := user.call("POST", "/v1/admin/teams", body, nil, nil)
	mustCode(t, "user creates team", code, e, 403, "forbidden")
	code, e = auditor.call("POST", "/v1/admin/teams", body, nil, nil)
	mustCode(t, "auditor creates team", code, e, 403, "forbidden")

	for _, tc := range []struct{ slug, class, code string }{
		{"id", "open", "invalid_slug"},
		{"Bad_Slug", "open", "invalid_slug"},
		{"-x", "open", "invalid_slug"},
		{"123e4567-e89b-12d3-a456-426614174000", "open", "invalid_slug"},
		{"good", "top_secret", "unknown_classification"},
	} {
		b := map[string]any{"slug": tc.slug, "name": "X", "maxClassification": tc.class, "ownerEmail": "x@example.edu"}
		code, e := admin.call("POST", "/v1/admin/teams", b, nil, nil)
		mustCode(t, "create "+tc.slug, code, e, 400, tc.code)
	}

	created := createTeam(t, admin, "ok-team", "new@example.edu")
	if created.Owner.Status != "invited" || created.Owner.Invite.Role != "owner" {
		t.Fatalf("unknown owner should be invited: %+v", created.Owner)
	}
	code, e = admin.call("POST", "/v1/admin/teams", body, nil, nil)
	mustCode(t, "duplicate slug", code, e, 409, "slug_taken")

	// Auditors can list; paging works.
	createTeam(t, admin, "b-team", "user@localhost")
	createTeam(t, admin, "c-team", "user@localhost")
	var page apitypes.TeamPage
	if code := auditor.get("/v1/admin/teams?limit=2", &page); code != 200 || len(page.Items) != 2 || page.NextCursor == nil {
		t.Fatalf("page 1 = %d %+v", code, page)
	}
	var page2 apitypes.TeamPage
	auditor.get("/v1/admin/teams?limit=2&cursor="+*page.NextCursor, &page2)
	if len(page2.Items) != 1 || page2.NextCursor != nil || page2.Items[0].Team.Slug != "ok-team" {
		t.Fatalf("page 2 = %+v", page2)
	}

	// Archiving makes the team read-only.
	var sum apitypes.TeamSummary
	admin.get("/v1/admin/teams/b-team", &sum)
	code, e = admin.call("PATCH", "/v1/admin/teams/b-team", map[string]string{"status": "archived"}, &sum, ifMatch(sum.Team.Revision))
	mustCode(t, "archive", code, e, 200, "")
	if sum.Team.Status != "archived" || sum.Team.ArchivedAt == nil {
		t.Fatalf("archive result = %+v", sum.Team)
	}
	user.refresh()
	code, e = user.call("POST", "/v1/teams/b-team/members", map[string]string{"email": "z@example.edu", "role": "member"}, nil, nil)
	mustCode(t, "add to archived team", code, e, 409, "team_archived")
}

func TestAssignOwnerRecoversTeam(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	app.signIn("alex")
	createTeam(t, admin, "lab", "user@localhost")
	user := app.signIn("user")
	code, e := user.call("POST", "/v1/teams/lab/members", map[string]string{"email": "alex@localhost", "role": "member"}, nil, nil)
	mustCode(t, "add alex", code, e, 201, "")

	var res apitypes.MemberAddResult
	code, e = admin.call("POST", "/v1/admin/teams/lab/owners", map[string]string{"email": "alex@localhost"}, &res, nil)
	mustCode(t, "assign owner", code, e, 200, "")
	if res.Status != "added" || res.Member.Role != "owner" {
		t.Fatalf("assign owner = %+v", res)
	}
	// Now the original owner is no longer the last one and can leave.
	code, e = user.call("DELETE", "/v1/teams/lab/members/"+user.me.User.Id.String(), nil, nil, nil)
	mustCode(t, "former sole owner leaves", code, e, 200, "")
}

func TestPlatformUserAdministration(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	user := app.signIn("user")

	var detail apitypes.UserDetail
	admin.get("/v1/admin/users/"+admin.me.User.Id.String(), &detail)
	code, e := admin.call("PATCH", "/v1/admin/users/"+admin.me.User.Id.String(), map[string]string{"platformRole": "none"}, nil, ifMatch(detail.User.Revision))
	mustCode(t, "demote last admin", code, e, 409, "last_admin")
	code, e = admin.call("PATCH", "/v1/admin/users/"+admin.me.User.Id.String(), map[string]string{"status": "suspended"}, nil, ifMatch(detail.User.Revision))
	mustCode(t, "suspend last admin", code, e, 409, "last_admin")

	// Promote another admin; now demoting yourself is allowed.
	var ud apitypes.UserDetail
	admin.get("/v1/admin/users/"+user.me.User.Id.String(), &ud)
	var u apitypes.User
	code, e = admin.call("PATCH", "/v1/admin/users/"+user.me.User.Id.String(), map[string]string{"platformRole": "platform_admin"}, &u, ifMatch(ud.User.Revision))
	mustCode(t, "promote user", code, e, 200, "")
	code, e = admin.call("PATCH", "/v1/admin/users/"+admin.me.User.Id.String(), map[string]string{"platformRole": "none"}, nil, ifMatch(detail.User.Revision))
	mustCode(t, "demote self", code, e, 200, "")
	code, _ = admin.call("GET", "/v1/admin/users", nil, nil, nil)
	if code != 403 {
		t.Fatalf("demoted admin still reaches admin API: %d", code)
	}

	// Suspension ends the target's sessions immediately.
	newAdmin := user
	casey := app.signIn("casey")
	var cd apitypes.UserDetail
	newAdmin.get("/v1/admin/users/"+casey.me.User.Id.String(), &cd)
	code, e = newAdmin.call("PATCH", "/v1/admin/users/"+casey.me.User.Id.String(), map[string]string{"status": "suspended"}, nil, ifMatch(cd.User.Revision))
	mustCode(t, "suspend casey", code, e, 200, "")
	if code, _ := casey.call("GET", "/v1/me", nil, nil, nil); code != 401 {
		t.Fatalf("suspended user's session still valid: %d", code)
	}

	// Search and paging.
	var page apitypes.UserPage
	if code := newAdmin.get("/v1/admin/users?q=dev%20platform&limit=1", &page); code != 200 || len(page.Items) != 1 {
		t.Fatalf("search = %d %+v", code, page)
	}
	var all apitypes.UserPage
	newAdmin.get("/v1/admin/users?limit=1", &all)
	seen := 1
	for all.NextCursor != nil {
		cursor := *all.NextCursor
		all = apitypes.UserPage{}
		newAdmin.get("/v1/admin/users?limit=1&cursor="+cursor, &all)
		seen += len(all.Items)
	}
	if seen != 3 {
		t.Fatalf("paged through %d users, want 3", seen)
	}
	code, e = newAdmin.call("GET", "/v1/admin/users?cursor=garbage", nil, nil, nil)
	mustCode(t, "bad cursor", code, e, 400, "invalid_cursor")
}

func TestClassificationLevels(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	user := app.signIn("user")

	var levels []apitypes.Classification
	if code := user.get("/v1/classifications", &levels); code != 200 || len(levels) != 3 || levels[2].Key != "restricted" {
		t.Fatalf("levels = %+v", levels)
	}
	code, e := admin.call("POST", "/v1/admin/classifications", map[string]any{
		"key": "internal_only", "name": "Internal", "rank": 5, "maxAudience": "public",
	}, nil, nil)
	mustCode(t, "sensitive level with public audience", code, e, 400, "classification_order")
	var created apitypes.Classification
	code, e = admin.call("POST", "/v1/admin/classifications", map[string]any{
		"key": "phi", "name": "PHI", "rank": 3, "maxAudience": "team",
	}, &created, nil)
	mustCode(t, "create phi", code, e, 201, "")
	code, e = admin.call("POST", "/v1/admin/classifications", map[string]any{
		"key": "phi2", "name": "PHI 2", "rank": 3, "maxAudience": "team",
	}, nil, nil)
	mustCode(t, "duplicate rank", code, e, 409, "rank_taken")

	code, e = admin.call("PATCH", "/v1/admin/classifications/restricted", map[string]string{"maxAudience": "public"}, nil, ifMatch(levels[2].Revision))
	mustCode(t, "widen restricted", code, e, 400, "classification_order")
	var upd apitypes.Classification
	code, e = admin.call("PATCH", "/v1/admin/classifications/restricted", map[string]string{"name": "Restricted (FERPA)"}, &upd, ifMatch(levels[2].Revision))
	mustCode(t, "rename restricted", code, e, 200, "")
	if upd.Name != "Restricted (FERPA)" || upd.Revision != levels[2].Revision+1 {
		t.Fatalf("updated = %+v", upd)
	}
	code, e = user.call("POST", "/v1/admin/classifications", map[string]any{"key": "x1", "name": "X", "rank": 9, "maxAudience": "team"}, nil, nil)
	mustCode(t, "non-admin creates level", code, e, 403, "forbidden")
}

// Two owners removing each other at the same moment must never leave the
// team without an owner: the team row lock serialises the owner count.
func TestConcurrentOwnerRemovalKeepsAnOwner(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	a, b := app.signIn("alex"), app.signIn("blair")
	for i := 0; i < 5; i++ {
		slug := "race-" + itoa(int64(i))
		createTeam(t, admin, slug, "alex@localhost")
		if code, e := admin.call("POST", "/v1/admin/teams/"+slug+"/owners", map[string]string{"email": "blair@localhost"}, nil, nil); code != 200 {
			t.Fatalf("second owner: %d %s", code, e)
		}
		codes := make(chan int, 2)
		go func() {
			c, _ := a.raw("DELETE", "/v1/teams/"+slug+"/members/"+b.me.User.Id.String(), nil, nil)
			codes <- c
		}()
		go func() {
			c, _ := b.raw("DELETE", "/v1/teams/"+slug+"/members/"+a.me.User.Id.String(), nil, nil)
			codes <- c
		}()
		c1, c2 := <-codes, <-codes
		// The loser is refused: 409 last_owner if it ran second while still a
		// member, or 404 if it had already been removed by the winner.
		lost := func(c int) bool { return c == 409 || c == 404 }
		if !((c1 == 200 && lost(c2)) || (lost(c1) && c2 == 200)) {
			t.Fatalf("round %d: codes %d and %d, want one 200 and one refusal", i, c1, c2)
		}
		var sum apitypes.TeamSummary
		admin.get("/v1/admin/teams/"+slug, &sum)
		if sum.OwnerCount != 1 {
			t.Fatalf("round %d: owner count %d", i, sum.OwnerCount)
		}
	}
}
