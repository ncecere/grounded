package httpapi_test

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"sort"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// groupsEnv is an app with development sign-in (the admin and the team
// owner) and a test OIDC provider (people with groups).
type groupsEnv struct {
	t     *testing.T
	app   *testApp
	idp   *testutil.OIDCProvider
	admin *session
	owner *session
}

func newGroupsEnv(t *testing.T) *groupsEnv {
	p := testutil.NewOIDCProvider(t)
	app := newTestApp(t, func(c *config.Config) {
		c.OIDC.Issuer, c.OIDC.ClientID, c.OIDC.ClientSecret = p.URL, p.ClientID, p.ClientSecret
	})
	e := &groupsEnv{t: t, app: app, idp: p, admin: app.signIn("admin"), owner: app.signIn("user")}
	createTeam(t, e.admin, "registrar", "user@localhost")
	return e
}

// signIn signs a person in through OIDC. groups is the claim's value; nil
// leaves the claim out.
func (e *groupsEnv) signIn(name string, groups any) *session {
	e.t.Helper()
	claims := map[string]any{"sub": name, "email": name + "@example.edu", "email_verified": true, "name": name}
	if groups != nil {
		claims["groups"] = groups
	}
	e.idp.SetClaims(claims)
	jar, _ := cookiejar.New(nil)
	s := &session{t: e.t, app: e.app, client: &http.Client{Jar: jar}}
	res, err := s.client.Get(e.app.URL + "/auth/login")
	if err != nil {
		e.t.Fatal(err)
	}
	res.Body.Close()
	s.refresh()
	return s
}

func (e *groupsEnv) rule(group, team, role string) apitypes.GroupRule {
	e.t.Helper()
	var r apitypes.GroupRule
	code, msg := e.admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": group, "team": team, "role": role}, &r, nil)
	mustCode(e.t, "create rule "+group, code, msg, 201, "")
	return r
}

// members is "email:role[:group]" for each member of a team, sorted.
func (e *groupsEnv) members(team string) string {
	e.t.Helper()
	var ms []apitypes.Member
	if code := e.owner.get("/v1/teams/"+team+"/members", &ms); code != 200 {
		// The owner may not be a member (the library team): read as admin.
		e.admin.get("/v1/teams/"+team+"/members", &ms)
	}
	out := make([]string, 0, len(ms))
	for _, m := range ms {
		s := m.User.Email + ":" + string(m.Role)
		if m.ManagedBy != nil {
			g := "(deleted rule)"
			if m.ManagedBy.Group != nil {
				g = *m.ManagedBy.Group
			}
			s += ":" + g
		}
		out = append(out, s)
	}
	sort.Strings(out)
	return strings.Join(out, " ")
}

func (e *groupsEnv) expectMembers(what, team, want string) {
	e.t.Helper()
	if got := e.members(team); got != want {
		e.t.Fatalf("%s: members of %s =\n  %s\nwant\n  %s", what, team, got, want)
	}
}

func (e *groupsEnv) preview(body map[string]any) []string {
	e.t.Helper()
	var p apitypes.GroupRulePreview
	code, msg := e.admin.call("POST", "/v1/admin/group-mapping/preview", body, &p, nil)
	mustCode(e.t, "preview", code, msg, 200, "")
	out := []string{}
	for _, c := range p.Changes {
		s := c.User.Email + " " + string(c.Kind)
		if c.To != nil {
			s += " " + string(*c.To)
		}
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

func memberID(t *testing.T, s *session, team, email string) (string, int64) {
	t.Helper()
	var ms []apitypes.Member
	s.get("/v1/teams/"+team+"/members", &ms)
	for _, m := range ms {
		if m.User.Email == email {
			return m.User.Id.String(), m.Revision
		}
	}
	t.Fatalf("%s is not a member of %s", email, team)
	return "", 0
}

func TestGroupMappingAtSignIn(t *testing.T) {
	e := newGroupsEnv(t)
	// Groups are recorded before any rule exists, for the dry run.
	e.signIn("pat", []string{"Registrar-Staff"})
	e.expectMembers("no rule yet", "registrar", "user@localhost:owner")
	if got := e.preview(map[string]any{"group": "registrar-staff", "team": "registrar", "role": "editor"}); strings.Join(got, ",") != "pat@example.edu add editor" {
		t.Fatalf("dry run = %q", got)
	}
	e.rule("registrar-staff", "registrar", "editor")
	e.expectMembers("saving applies it to people seen", "registrar", "pat@example.edu:editor:registrar-staff user@localhost:owner")

	// A single string is one group.
	e.signIn("quinn", "REGISTRAR-STAFF")
	e.expectMembers("quinn signs in", "registrar", "pat@example.edu:editor:registrar-staff quinn@example.edu:editor:registrar-staff user@localhost:owner")

	// The highest role wins; then lowered back when the higher group goes.
	admins := e.rule("registrar-admins", "registrar", "admin")
	e.signIn("pat", []string{"registrar-staff", "registrar-admins"})
	e.expectMembers("raised", "registrar", "pat@example.edu:admin:registrar-admins quinn@example.edu:editor:registrar-staff user@localhost:owner")
	e.signIn("pat", []string{"registrar-staff"})
	e.expectMembers("lowered", "registrar", "pat@example.edu:editor:registrar-staff quinn@example.edu:editor:registrar-staff user@localhost:owner")

	// A member added by hand is never changed, even to a higher role.
	e.signIn("riley", nil)
	code, msg := e.owner.call("POST", "/v1/teams/registrar/members", map[string]any{"email": "riley@example.edu", "role": "member"}, nil, nil)
	mustCode(t, "add riley by hand", code, msg, 201, "")
	e.signIn("riley", []string{"registrar-admins"})
	if got := e.preview(map[string]any{"ruleId": admins.Id, "group": "registrar-admins", "role": "owner"}); !contains(got, "riley@example.edu manual owner") {
		t.Fatalf("dry run should list riley as hand-added: %q", got)
	}
	e.signIn("riley", nil)
	e.expectMembers("hand-added riley kept", "registrar",
		"pat@example.edu:editor:registrar-staff quinn@example.edu:editor:registrar-staff riley@example.edu:member user@localhost:owner")

	// Owners can't change or remove a managed member by hand, and the member can't leave.
	patID, patRev := memberID(t, e.owner, "registrar", "pat@example.edu")
	code, msg = e.owner.call("DELETE", "/v1/teams/registrar/members/"+patID, nil, nil, nil)
	mustCode(t, "remove a managed member", code, msg, 409, "sso_managed")
	code, msg = e.owner.call("PATCH", "/v1/teams/registrar/members/"+patID, map[string]any{"role": "admin"}, nil, ifMatch(patRev))
	mustCode(t, "change a managed member's role", code, msg, 409, "sso_managed")
	pat := e.signIn("pat", []string{"registrar-staff"})
	code, msg = pat.call("DELETE", "/v1/teams/registrar/members/"+patID, nil, nil, nil)
	mustCode(t, "a managed member leaves", code, msg, 409, "sso_managed")

	// Leaving the group (no claim at all counts as no groups) removes the membership the rule made.
	e.signIn("pat", nil)
	e.expectMembers("pat left the group", "registrar", "quinn@example.edu:editor:registrar-staff riley@example.edu:member user@localhost:owner")

	// Every change is audited with the system as the actor and the rule in the metadata.
	var n int
	err := e.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log
		WHERE actor_kind = 'system' AND metadata->>'via' = 'sso_group_rule'
		  AND action IN ('team.member_add', 'team.member_role_change', 'team.member_remove')`).Scan(&n)
	if err != nil || n != 5 { // pat add, quinn add, pat raise, pat lower, pat remove
		t.Fatalf("audited rule changes = %d (%v), want 5", n, err)
	}
	// The log's Group mapping filter finds them and the rules' changes, each named with its team.
	var page apitypes.AuditPage
	if code := e.admin.get("/v1/admin/audit?action=group_mapping.", &page); code != 200 || len(page.Items) != 7 {
		t.Fatalf("group mapping filter = %d, %d entries, want 7 (2 rules, 5 memberships)", code, len(page.Items))
	}
	for _, it := range page.Items {
		if (it.Metadata["via"] != "sso_group_rule" && !strings.HasPrefix(it.Action, "platform.sso_rule_")) || it.TeamSlug == nil || *it.TeamSlug != "registrar" || it.TeamName == nil {
			t.Errorf("group mapping entry = %s %v team %v", it.Action, it.Metadata, it.TeamSlug)
		}
	}
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

func TestGroupRuleChangesApplyAtOnce(t *testing.T) {
	e := newGroupsEnv(t)
	staff := e.rule("registrar-staff", "registrar", "editor")
	e.signIn("pat", []string{"registrar-staff"})
	e.signIn("quinn", []string{"registrar-staff", "registrar-helpers"})
	helpers := e.rule("registrar-helpers", "registrar", "member")

	// Lowering the rule lowers its members at once.
	var updated apitypes.GroupRule
	code, msg := e.admin.call("PATCH", "/v1/admin/group-mapping/rules/"+staff.Id.String(), map[string]any{"role": "member"}, &updated, ifMatch(staff.Revision))
	mustCode(t, "lower the rule", code, msg, 200, "")
	e.expectMembers("rule lowered", "registrar", "pat@example.edu:member:registrar-staff quinn@example.edu:member:registrar-staff user@localhost:owner")
	code, msg = e.admin.call("PATCH", "/v1/admin/group-mapping/rules/"+staff.Id.String(), map[string]any{"role": "admin"}, nil, ifMatch(staff.Revision))
	mustCode(t, "stale rule revision", code, msg, 412, "revision_conflict")

	// Deleting it: pat is removed; quinn keeps a membership through the other rule.
	if got := e.preview(map[string]any{"ruleId": staff.Id, "delete": true}); strings.Join(got, ",") != "pat@example.edu remove" {
		t.Fatalf("dry run of delete = %q", got)
	}
	code, msg = e.admin.call("DELETE", "/v1/admin/group-mapping/rules/"+staff.Id.String(), nil, nil, nil)
	mustCode(t, "delete the rule", code, msg, 200, "")
	e.expectMembers("rule deleted", "registrar", "quinn@example.edu:member:registrar-helpers user@localhost:owner")

	// Rules are listed per team, with how many memberships each grants.
	var rules []apitypes.GroupRule
	if code := e.admin.get("/v1/admin/group-mapping/rules?team=registrar", &rules); code != 200 || len(rules) != 1 ||
		rules[0].Id != helpers.Id || rules[0].MemberCount != 1 || rules[0].Team.Slug != "registrar" {
		t.Fatalf("rules = %d %+v", code, rules)
	}
	code, msg = e.admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": "Registrar-Helpers", "team": "registrar", "role": "owner"}, nil, nil)
	mustCode(t, "duplicate rule", code, msg, 409, "rule_exists")
	code, msg = e.admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": " ", "team": "registrar", "role": "owner"}, nil, nil)
	mustCode(t, "blank group", code, msg, 400, "invalid_group")

	var st apitypes.GroupMappingStatus
	if code := e.admin.get("/v1/admin/group-mapping", &st); code != 200 || st.GroupsClaim != "groups" || !st.OidcEnabled ||
		st.RuleCount != 1 || st.PeopleWithClaim != 2 || len(st.Groups) != 2 || st.Groups[0].Name != "registrar-staff" {
		t.Fatalf("status = %d %+v", code, st)
	}
	var n int
	err := e.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log
		WHERE action IN ('platform.sso_rule_create', 'platform.sso_rule_update', 'platform.sso_rule_delete')`).Scan(&n)
	if err != nil || n != 4 {
		t.Fatalf("audited rule changes = %d (%v), want 4", n, err)
	}
}

func TestGroupMappingKeepsTheLastOwner(t *testing.T) {
	e := newGroupsEnv(t)
	// A team whose only owner comes from a rule.
	createTeam(t, e.admin, "library", "nobody-yet@example.edu")
	e.rule("library-owners", "library", "owner")
	e.signIn("sam", []string{"library-owners"})
	e.expectMembers("sam added", "library", "sam@example.edu:owner:library-owners")

	e.signIn("sam", []string{})
	e.expectMembers("the last owner is kept", "library", "sam@example.edu:owner:library-owners")
	var kept int
	if err := e.app.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_log WHERE action = 'team.sso_last_owner_kept'`).Scan(&kept); err != nil || kept != 1 {
		t.Fatalf("last-owner audit = %d %v", kept, err)
	}

	// With another owner (assigned by a platform admin), the next sign-in removes sam.
	e.signIn("pat", nil)
	code, msg := e.admin.call("POST", "/v1/admin/teams/library/owners", map[string]any{"email": "pat@example.edu"}, nil, nil)
	mustCode(t, "assign owner", code, msg, 200, "")
	e.signIn("sam", []string{})
	e.expectMembers("sam removed", "library", "pat@example.edu:owner")
}

func TestGroupRulesNeedAnActiveTeamAndAdmin(t *testing.T) {
	e := newGroupsEnv(t)
	auditor := e.app.signIn("auditor")
	code, msg := auditor.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": "g", "team": "registrar", "role": "member"}, nil, nil)
	mustCode(t, "auditor creates a rule", code, msg, 403, "forbidden")
	code, msg = auditor.call("POST", "/v1/admin/group-mapping/preview", map[string]any{"group": "g", "team": "registrar", "role": "member"}, nil, nil)
	mustCode(t, "auditor previews", code, msg, 200, "")
	code, msg = e.admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": "g", "team": "nope", "role": "member"}, nil, nil)
	mustCode(t, "unknown team", code, msg, 404, "team_not_found")
	var team apitypes.TeamSummary
	e.admin.get("/v1/admin/teams/registrar", &team)
	code, msg = e.admin.call("PATCH", "/v1/admin/teams/registrar", map[string]any{"status": "archived"}, nil, ifMatch(team.Team.Revision))
	mustCode(t, "archive", code, msg, 200, "")
	code, msg = e.admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": "g", "team": "registrar", "role": "member"}, nil, nil)
	mustCode(t, "rule for an archived team", code, msg, 409, "team_archived")
}

// DEV_AUTH_GROUPS gives development personas groups, for trying the mapping
// without an identity provider.
func TestDevPersonaGroups(t *testing.T) {
	app := newTestApp(t, func(c *config.Config) { c.DevAuthGroups = map[string][]string{"alex": {"Registrar-Staff"}} })
	admin := app.signIn("admin")
	createTeam(t, admin, "registrar", "admin@localhost")
	code, msg := admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": "registrar-staff", "team": "registrar", "role": "editor"}, nil, nil)
	mustCode(t, "create rule", code, msg, 201, "")
	alex := app.signIn("alex")
	if len(alex.me.Teams) != 1 || alex.me.Teams[0].Slug != "registrar" || alex.me.Teams[0].Role != "editor" {
		t.Fatalf("alex's teams = %+v", alex.me.Teams)
	}
}
