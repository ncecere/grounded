package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// scimClient speaks SCIM with a bearer token and no cookies, as an identity provider does.
type scimClient struct {
	t     *testing.T
	url   string
	token string
}

func (c scimClient) do(method, path string, body any) (int, map[string]any) {
	c.t.Helper()
	var rdr io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		rdr = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, c.url+"/scim/v2"+path, rdr)
	req.Header.Set("Content-Type", "application/scim+json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	if res.StatusCode != http.StatusNoContent && res.Header.Get("Content-Type") != "application/scim+json" {
		c.t.Fatalf("%s %s: content type %q", method, path, res.Header.Get("Content-Type"))
	}
	return res.StatusCode, out
}

func (c scimClient) must(method, path string, body any, want int) map[string]any {
	c.t.Helper()
	code, out := c.do(method, path, body)
	if code != want {
		c.t.Fatalf("%s %s = %d %v, want %d", method, path, code, out, want)
	}
	return out
}

func scimUser(userName, externalID, given, family string) map[string]any {
	return map[string]any{
		"schemas": []string{"urn:ietf:params:scim:schemas:core:2.0:User"}, "userName": userName, "externalId": externalID,
		"name": map[string]any{"givenName": given, "familyName": family}, "emails": []any{map[string]any{"value": userName, "type": "work", "primary": true}},
		"active": true,
	}
}

func patchOps(ops ...map[string]any) map[string]any {
	return map[string]any{"schemas": []string{"urn:ietf:params:scim:api:messages:2.0:PatchOp"}, "Operations": ops}
}

func (a *testApp) userID(s *session) string {
	a.t.Helper()
	var me apitypes.Me
	if code := s.get("/v1/me", &me); code != 200 {
		a.t.Fatalf("me = %d", code)
	}
	return me.User.Id.String()
}

// SCIM end to end (docs/specs/scim/DESIGN.md): a token reaches /scim/v2 and nothing else; users are created, linked by
// their identifier (never by email), updated, suspended and unlinked; groups drive the SSO rules; a pending user is linked
// at their first sign-in; the last admin is never suspended; everything is audited.
func TestSCIMProvisioning(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	alex := app.signIn("alex")
	blair := app.signIn("blair")
	owner := app.signIn("user")
	createTeam(t, admin, "registrar", "user@localhost")

	// A token, made by a signed-in platform admin; auditors see it, never its secret.
	var created apitypes.ScimTokenCreated
	code, e := admin.call("POST", "/v1/admin/scim/tokens", map[string]any{"name": "Okta"}, &created, nil)
	mustCode(t, "create token", code, e, 201, "")
	var status apitypes.ScimStatus
	if code := app.signIn("auditor").get("/v1/admin/scim", &status); code != 200 || !status.Available || len(status.Tokens) != 1 || status.MatchClaim != "sub" {
		t.Fatalf("auditor status %d %+v", code, status)
	}
	idp := scimClient{t: t, url: app.URL, token: created.Secret}

	// Only the token: nothing, a wrong token or a signed-in session is refused.
	for _, c := range []scimClient{{t: t, url: app.URL}, {t: t, url: app.URL, token: "scim_wrong"}, {t: t, url: app.URL, token: "gk_live_x"}} {
		c.must("GET", "/Users", nil, 401)
	}
	if code, _ := admin.raw("GET", "/scim/v2/Users", nil, nil); code != 401 {
		t.Fatalf("a session reached SCIM: %d", code)
	}
	// …and the token reaches nothing but /scim/v2.
	if code, _ := (&session{t: t, app: app, client: &http.Client{}}).raw("GET", "/v1/me", nil, map[string]string{"Authorization": "Bearer " + created.Secret}); code != 401 {
		t.Fatalf("a SCIM token reached /v1: %d", code)
	}
	if spc := idp.must("GET", "/ServiceProviderConfig", nil, 200); spc["patch"].(map[string]any)["supported"] != true {
		t.Fatalf("service provider config %v", spc)
	}

	// Create a person before their first sign-in; the same externalId again is a uniqueness error; externalId is required.
	casey := idp.must("POST", "/Users", scimUser("casey@example.edu", "casey", "Casey", "Lee"), 201)
	caseyID := casey["id"].(string)
	if casey["displayName"] != "Casey Lee" || casey["active"] != true {
		t.Fatalf("created %v", casey)
	}
	if out := idp.must("POST", "/Users", scimUser("other@example.edu", "casey", "O", "T"), 409); out["scimType"] != "uniqueness" {
		t.Fatalf("duplicate externalId %v", out)
	}
	noExt := scimUser("x@example.edu", "", "X", "Y")
	idp.must("POST", "/Users", noExt, 400)
	if list := idp.must("GET", `/Users?filter=userName+eq+"casey@example.edu"`, nil, 200); list["totalResults"] != float64(1) {
		t.Fatalf("filter %v", list)
	}
	idp.must("GET", `/Users?filter=title+eq+"x"`, nil, 400)

	// Someone who already signed in is linked by their identifier, not duplicated; an email alone never links.
	linked := idp.must("POST", "/Users", scimUser("alex@localhost", "alex", "Alex", "Dev"), 201)
	if linked["id"] != app.userID(alex) {
		t.Fatalf("alex was not linked: %v", linked["id"])
	}
	byEmail := idp.must("POST", "/Users", scimUser("blair@localhost", "someone-else", "Not", "Blair"), 201)
	if byEmail["id"] == app.userID(blair) {
		t.Fatal("a user was linked by email")
	}

	// Groups feed the SSO rules: membership follows at once, both ways.
	code, e = admin.call("POST", "/v1/admin/group-mapping/rules", map[string]any{"group": "registrar-staff", "team": "registrar", "role": "member"}, nil, nil)
	mustCode(t, "rule", code, e, 201, "")
	group := idp.must("POST", "/Groups", map[string]any{"displayName": "registrar-staff", "externalId": "g-1", "members": []any{map[string]any{"value": linked["id"]}}}, 201)
	inTeam := func() bool {
		var members []apitypes.Member
		if code := owner.get("/v1/teams/registrar/members", &members); code != 200 {
			t.Fatalf("members = %d", code)
		}
		for _, m := range members {
			if m.User.Id.String() == linked["id"] {
				return true
			}
		}
		return false
	}
	if !inTeam() {
		t.Fatal("the group did not add alex to the team")
	}
	idp.must("PATCH", "/Groups/"+group["id"].(string), patchOps(map[string]any{"op": "Remove", "path": `members[value eq "` + linked["id"].(string) + `"]`}), 200)
	if inTeam() {
		t.Fatal("leaving the group did not remove alex from the team")
	}
	idp.must("POST", "/Groups", map[string]any{"displayName": "Strangers", "members": []any{map[string]any{"value": app.userID(owner)}}}, 400)
	if g := idp.must("GET", "/Groups/"+group["id"].(string)+"?excludedAttributes=members", nil, 200); g["members"] != nil {
		t.Fatalf("members were not excluded: %v", g)
	}

	// The first sign-in links the pending user (matched by sub = externalId).
	caseySession := app.signIn("casey")
	if app.userID(caseySession) != caseyID {
		t.Fatal("casey's sign-in did not take the SCIM user")
	}

	// Entra's PATCH shape suspends (sessions end); a pathless replace reactivates; PUT replaces names.
	if out := idp.must("PATCH", "/Users/"+caseyID, patchOps(map[string]any{"op": "Replace", "path": "active", "value": "False"}), 200); out["active"] != false {
		t.Fatalf("suspend %v", out)
	}
	if code, _ := caseySession.raw("GET", "/v1/me", nil, nil); code != 401 {
		t.Fatalf("a suspended user's session = %d", code)
	}
	idp.must("PATCH", "/Users/"+caseyID, patchOps(map[string]any{"op": "replace", "value": map[string]any{"active": true, "name.givenName": "Case"}}), 200)
	put := scimUser("casey@example.edu", "casey", "Casey", "Lee-Smith")
	if out := idp.must("PUT", "/Users/"+caseyID, put, 200); out["displayName"] != "Casey Lee-Smith" {
		t.Fatalf("put %v", out)
	}
	put["externalId"] = "changed"
	if out := idp.must("PUT", "/Users/"+caseyID, put, 400); out["scimType"] != "mutability" {
		t.Fatalf("externalId changed: %v", out)
	}

	// The last active platform admin is never suspended, and the refusal is audited.
	adminUser := idp.must("POST", "/Users", scimUser("admin@localhost", "admin", "Dev", "Admin"), 201)
	idp.must("PATCH", "/Users/"+adminUser["id"].(string), patchOps(map[string]any{"op": "replace", "path": "active", "value": false}), 409)
	if code := admin.get("/v1/me", nil); code != 200 {
		t.Fatalf("the admin was suspended: %d", code)
	}

	// DELETE suspends and unlinks; the person is not deleted.
	idp.must("DELETE", "/Users/"+caseyID, nil, 204)
	idp.must("GET", "/Users/"+caseyID, nil, 404)
	var st string
	if err := app.Pool.QueryRow(t.Context(), "SELECT status FROM users WHERE id = $1", caseyID).Scan(&st); err != nil || st != "suspended" {
		t.Fatalf("deleted user status %q %v", st, err)
	}

	// Audited, with the token; then a revoked token stops at once.
	for _, action := range []string{"scim.user_create", "scim.user_link", "scim.user_suspend", "scim.user_reactivate", "scim.user_update",
		"scim.user_unlink", "scim.group_create", "scim.group_update", "scim.suspend_denied", "auth.scim_link", "platform.scim_token_create"} {
		var n int
		if err := app.Pool.QueryRow(t.Context(), "SELECT count(*) FROM audit_log WHERE action = $1", action).Scan(&n); err != nil || n == 0 {
			t.Errorf("no %s audit entry", action)
		}
	}
	var via int
	_ = app.Pool.QueryRow(t.Context(), "SELECT count(*) FROM audit_log WHERE action LIKE 'scim.%' AND (metadata->>'scimTokenId' IS NULL OR actor_kind <> 'system')").Scan(&via)
	if via != 0 {
		t.Errorf("%d SCIM audit entries without the token or not as the system", via)
	}
	code, e = admin.call("DELETE", "/v1/admin/scim/tokens/"+created.Token.Id.String(), nil, nil, nil)
	mustCode(t, "revoke", code, e, 200, "")
	idp.must("GET", "/Users", nil, 401)
}

// With another matching claim, the claim (not the subject) links a pending user; once the identity provider pushes groups,
// a SCIM-linked user's sign-in uses their SCIM groups, not the groups claim.
func TestSCIMMatchClaimAndGroupSource(t *testing.T) {
	app := newTestApp(t, func(c *config.Config) {
		c.OIDC.SCIMMatchClaim = "name" // the development login has no oid claim; any string claim exercises the path
		c.DevAuthGroups = map[string][]string{"casey": {"claim-group"}}
	})
	admin := app.signIn("admin")
	owner := app.signIn("user")
	createTeam(t, admin, "registrar", "user@localhost")
	createTeam(t, admin, "advising", "user@localhost")
	for _, r := range []map[string]any{{"group": "claim-group", "team": "advising", "role": "member"}, {"group": "scim-group", "team": "registrar", "role": "member"}} {
		code, e := admin.call("POST", "/v1/admin/group-mapping/rules", r, nil, nil)
		mustCode(t, "rule", code, e, 201, "")
	}
	var created apitypes.ScimTokenCreated
	code, e := admin.call("POST", "/v1/admin/scim/tokens", map[string]any{"name": "Entra ID"}, &created, nil)
	mustCode(t, "token", code, e, 201, "")
	idp := scimClient{t: t, url: app.URL, token: created.Secret}

	// The development persona casey signs in with the name "Casey Dev".
	casey := idp.must("POST", "/Users", scimUser("casey@example.edu", "Casey Dev", "Casey", "Dev"), 201)
	idp.must("POST", "/Groups", map[string]any{"displayName": "scim-group", "members": []any{map[string]any{"value": casey["id"]}}}, 201)
	s := app.signIn("casey")
	if app.userID(s) != casey["id"] {
		t.Fatal("the name claim did not link the pending user")
	}
	teams := map[string]bool{}
	var me apitypes.Me
	s.get("/v1/me", &me)
	for _, m := range me.Teams {
		teams[m.Slug] = true
	}
	if !teams["registrar"] || teams["advising"] {
		t.Fatalf("teams after sign-in = %v: want the SCIM group's team, not the claim's", teams)
	}
	_ = owner
}
