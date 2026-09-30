package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// OAuth sign-in for MCP clients: the checks of each endpoint (docs/mcp.md,
// "Signing in with OAuth", security).

func TestOAuthAuthorizeErrors(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	setOAuth(t, env.admin, true, true)
	c := registerClient(t, base)
	p := newPKCE()

	// Before the client and its redirect URI are known to be good: a page, never a redirect.
	for name, over := range map[string]map[string]string{
		"unknown client":          {"client_id": "gcl_nobody"},
		"no client":               {"client_id": ""},
		"unregistered redirect":   {"redirect_uri": "https://evil.example.com/callback"},
		"other loopback path":     {"redirect_uri": "http://127.0.0.1:4567/elsewhere"},
		"no redirect":             {"redirect_uri": ""},
		"http non-loopback":       {"redirect_uri": "http://assistant.example.com/callback"},
		"metadata URL not https":  {"client_id": "http://assistant.example.com/client.json"},
		"metadata URL root":       {"client_id": "https://assistant.example.com/"},
		"metadata URL with query": {"client_id": "https://assistant.example.com/c.json?x=1"},
	} {
		res := authorize(t, base, env.member, c.query(p, over))
		if res.StatusCode != 400 || res.Header.Get("Location") != "" || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") {
			t.Errorf("%s: %d Location=%q", name, res.StatusCode, res.Header.Get("Location"))
		}
	}
	// A repeated parameter is refused as a page too.
	code, hdr, _ := getStatus(t, base+"/oauth/authorize?"+c.query(p, nil).Encode()+"&redirect_uri=https%3A%2F%2Fevil.example.com%2Fcb")
	if code != 400 || hdr.Get("Location") != "" {
		t.Errorf("repeated redirect_uri = %d %q", code, hdr.Get("Location"))
	}

	// After: back to the client with the error, its state and the issuer.
	for name, tc := range map[string]struct {
		over map[string]string
		code string
	}{
		"no PKCE":        {map[string]string{"code_challenge": "", "code_challenge_method": ""}, "invalid_request"},
		"plain PKCE":     {map[string]string{"code_challenge": p.verifier, "code_challenge_method": "plain"}, "invalid_request"},
		"implicit":       {map[string]string{"response_type": "token"}, "unsupported_response_type"},
		"no resource":    {map[string]string{"resource": ""}, "invalid_target"},
		"other resource": {map[string]string{"resource": "https://other.example.com/mcp"}, "invalid_target"},
		"root resource":  {map[string]string{"resource": base}, "invalid_target"},
	} {
		res := authorize(t, base, env.member, c.query(p, tc.over))
		loc, _ := url.Parse(res.Header.Get("Location"))
		q := loc.Query()
		if res.StatusCode != 302 || loc.Host != "127.0.0.1:4567" || q.Get("error") != tc.code || q.Get("state") != "st-1" || q.Get("iss") != base || q.Get("code") != "" {
			t.Errorf("%s: %d %s", name, res.StatusCode, loc)
		}
	}
	// Deny sends access_denied.
	back := consent(t, env.member, c.query(p, nil), "deny")
	if back.Query().Get("error") != "access_denied" || back.Query().Get("iss") != base || back.Query().Get("code") != "" {
		t.Errorf("deny = %s", back)
	}
	// The consent page refuses what the endpoint would (400, shown; never a redirect).
	code, e := env.member.call("GET", "/v1/oauth/consent?"+c.query(p, map[string]string{"redirect_uri": "https://evil.example.com/cb"}).Encode(), nil, nil, nil)
	mustCode(t, "consent with a bad redirect", code, e, 400, "oauth_invalid_request")
	code, e = env.member.call("POST", "/v1/oauth/consent", map[string]any{"query": c.query(p, map[string]string{"resource": ""}).Encode(), "decision": "allow"}, nil, nil)
	mustCode(t, "allow without resource", code, e, 400, "oauth_invalid_target")
	if n := env.scalar(t, `SELECT count(*) FROM oauth_grants`); n != 0 {
		t.Errorf("grants after refusals = %d", n)
	}
}

func TestOAuthTokenChecks(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	setOAuth(t, env.admin, true, true)
	c := registerClient(t, base)
	other := registerClient(t, base)
	newCode := func() (string, pkce) {
		p := newPKCE()
		return consent(t, env.member, c.query(p, nil), "allow").Query().Get("code"), p
	}
	form := func(code string, p pkce, over map[string]string) url.Values {
		f := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {p.verifier}, "redirect_uri": {"http://127.0.0.1:4567/callback"}}
		for k, v := range over {
			f.Set(k, v)
		}
		return f
	}
	cases := []struct {
		name string
		over map[string]string
		want string
	}{
		{"other redirect", map[string]string{"redirect_uri": "http://127.0.0.1:9999/callback"}, "invalid_grant"},
		{"other client", map[string]string{"client_id": other.id}, "invalid_grant"},
		{"other resource", map[string]string{"resource": "https://other.example.com/mcp"}, "invalid_target"},
		{"no verifier", map[string]string{"code_verifier": ""}, "invalid_grant"},
	}
	for _, tc := range cases {
		code, p := newCode()
		status, out, _ := c.token(form(code, p, tc.over))
		wantOAuthError(t, tc.name, status, out, 400, tc.want)
		// Whatever failed, the code is used up.
		status, out, _ = c.token(form(code, p, nil))
		wantOAuthError(t, tc.name+", then the right request", status, out, 400, "invalid_grant")
	}
	// An expired code.
	code, p := newCode()
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE oauth_codes SET expires_at = now() - interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	status, out, _ := c.token(form(code, p, nil))
	wantOAuthError(t, "expired code", status, out, 400, "invalid_grant")
	// Other grant types and a missing client.
	status, out, _ = c.token(url.Values{"grant_type": {"client_credentials"}})
	wantOAuthError(t, "client_credentials", status, out, 400, "unsupported_grant_type")
	res, err := http.PostForm(base+"/oauth/token", url.Values{"grant_type": {"authorization_code"}, "code": {"gac_x"}})
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	_ = res.Body.Close()
	wantOAuthError(t, "no client_id", res.StatusCode, out, 401, "invalid_client")
	// JSON isn't a token request.
	status, out = postJSON(t, base+"/oauth/token", map[string]any{"grant_type": "authorization_code"})
	wantOAuthError(t, "json body", status, out, 400, "invalid_request")

	// Registration refuses what it doesn't support, and is rate-limited.
	for name, body := range map[string]map[string]any{
		"secret client":      {"redirect_uris": []string{oauthRedirect}, "token_endpoint_auth_method": "client_secret_basic"},
		"non-loopback http":  {"redirect_uris": []string{"http://evil.example.com/cb"}},
		"private-use scheme": {"redirect_uris": []string{"myapp://callback"}},
		"no redirect":        {"client_name": "x"},
		"client credentials": {"redirect_uris": []string{oauthRedirect}, "grant_types": []string{"client_credentials"}},
	} {
		if status, out := postJSON(t, base+"/oauth/register", body); status != 400 || out["error"] == nil {
			t.Errorf("register %s = %d %v", name, status, out)
		}
	}
	limited := false
	for range 12 {
		if status, _ := postJSON(t, base+"/oauth/register", map[string]any{"redirect_uris": []string{oauthRedirect}}); status == 429 {
			limited = true
			break
		}
	}
	if !limited {
		t.Error("registration is not rate-limited")
	}
}

func TestOAuthRevocationSuspensionAndSetting(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	setOAuth(t, env.admin, true, true)
	c := registerClient(t, base)
	works := func(what, access string, want bool) {
		t.Helper()
		cs, err := mcpToken(t, base, access)
		if err == nil {
			_, err = cs.ListTools(t.Context(), nil)
		}
		if got := err == nil; got != want {
			t.Errorf("%s: /mcp works = %v (%v), want %v", what, got, err, want)
		}
	}
	member := env.member.me.User.Id.String()

	// RFC 7009 with the refresh token revokes the grant.
	access, refresh := c.signInApp(env.member)
	works("new token", access, true)
	res, err := http.PostForm(base+"/oauth/revoke", url.Values{"token": {refresh}, "client_id": {c.id}})
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("revoke = %v %v", res, err)
	}
	works("after /oauth/revoke", access, false)

	// The person disconnects the app from their API keys page.
	access, _ = c.signInApp(env.member)
	var grants []apitypes.OAuthGrant
	if code := env.member.get("/v1/me/oauth-grants", &grants); code != 200 || len(grants) != 1 || grants[0].ClientName != "Test Assistant" ||
		grants[0].ClientHost != "assistant.example.com" || grants[0].LastUsedAt != nil {
		t.Fatalf("grants = %d %+v", code, grants)
	}
	works("before disconnect", access, true)
	if code := env.member.get("/v1/me/oauth-grants", &grants); code != 200 || grants[0].LastUsedAt == nil {
		t.Errorf("last used = %+v", grants)
	}
	// Someone else can't disconnect it through their own list.
	code, e := env.editor.call("DELETE", "/v1/me/oauth-grants/"+grants[0].Id.String(), nil, nil, nil)
	mustCode(t, "editor disconnects the member's app", code, e, 404, "grant_not_found")
	code, e = env.member.call("DELETE", "/v1/me/oauth-grants/"+grants[0].Id.String(), nil, nil, nil)
	mustCode(t, "disconnect", code, e, 200, "")
	works("after disconnect", access, false)

	// A platform admin sees and disconnects anyone's app; an auditor only sees.
	access, _ = c.signInApp(env.member)
	var listed []apitypes.OAuthGrant
	if code := env.auditor.get("/v1/admin/users/"+member+"/oauth-grants", &listed); code != 200 || len(listed) != 1 {
		t.Fatalf("auditor list = %d %+v", code, listed)
	}
	code, e = env.auditor.call("DELETE", "/v1/admin/users/"+member+"/oauth-grants/"+listed[0].Id.String(), nil, nil, nil)
	mustCode(t, "auditor disconnects", code, e, 403, "forbidden")
	code, e = env.admin.call("DELETE", "/v1/admin/users/"+member+"/oauth-grants/"+listed[0].Id.String(), nil, nil, nil)
	mustCode(t, "admin disconnects", code, e, 200, "")
	works("after the admin disconnects", access, false)
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'oauth.revoke'`); n != 3 {
		t.Errorf("oauth.revoke entries = %d, want 3", n)
	}

	// Suspension, the setting, the MCP switch and the audience.
	access, _ = c.signInApp(env.member)
	var u apitypes.UserDetail
	env.admin.get("/v1/admin/users/"+member, &u)
	code, e = env.admin.call("PATCH", "/v1/admin/users/"+member, map[string]any{"status": "suspended"}, nil, ifMatch(u.User.Revision))
	mustCode(t, "suspend", code, e, 200, "")
	works("suspended person", access, false)
	env.admin.get("/v1/admin/users/"+member, &u)
	code, e = env.admin.call("PATCH", "/v1/admin/users/"+member, map[string]any{"status": "active"}, nil, ifMatch(u.User.Revision))
	mustCode(t, "reactivate", code, e, 200, "")
	works("reactivated person", access, true)
	setOAuth(t, env.admin, true, false)
	res2, body := mcpRaw(t, base, "POST", access, listTools)
	wantRefusal(t, "setting off", res2, body, 401, -32001, "oauth_off")
	setOAuth(t, env.admin, false, true)
	res2, body = mcpRaw(t, base, "POST", access, listTools)
	wantRefusal(t, "MCP off", res2, body, 404, -32004, "mcp_off")
	setOAuth(t, env.admin, true, true)
	works("both on again", access, true)
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE oauth_tokens SET resource = 'https://other.example.com/mcp'`); err != nil {
		t.Fatal(err)
	}
	works("a token for another resource", access, false)
}

func TestOAuthMetadataDocumentClient(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	setOAuth(t, env.admin, true, true)
	var doc map[string]any
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(doc)
	}))
	t.Cleanup(srv.Close)
	env.app.Svc.OAuth.SetMetadataClient(srv.Client())
	id := srv.URL + "/oauth/client.json"
	doc = map[string]any{"client_id": id, "client_name": "Doc Assistant", "redirect_uris": []string{oauthRedirect},
		"logo_uri": "https://cdn.example.com/logo.png", "client_uri": "https://evil.example.com", "token_endpoint_auth_method": "none"}
	c := &oauthClient{t: t, base: base, id: id}
	p := newPKCE()
	var view apitypes.OAuthConsent
	host := strings.TrimPrefix(srv.URL, "https://")
	// The document's host vouches for the client, whatever client_uri says.
	if code := env.member.get("/v1/oauth/consent?"+c.query(p, nil).Encode(), &view); code != 200 || view.Client.Kind != "metadata" ||
		view.Client.Host != host || view.Client.Name != "Doc Assistant" || view.Client.LogoUrl == nil {
		t.Fatalf("consent view = %d %+v", code, view)
	}
	access, _ := c.signInApp(env.member)
	if _, err := mcpToken(t, base, access); err != nil {
		t.Fatalf("metadata client token: %v", err)
	}

	// A document whose client_id isn't its URL is refused (as a page).
	other := srv.URL + "/oauth/other.json"
	c2 := &oauthClient{t: t, base: base, id: other}
	res := authorize(t, base, env.member, c2.query(p, nil))
	if res.StatusCode != 400 || res.Header.Get("Location") != "" {
		t.Errorf("mismatched client_id = %d %q", res.StatusCode, res.Header.Get("Location"))
	}
}
