package httpapi_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/mcpserver"
)

// OAuth sign-in for MCP clients (experimental; docs/mcp.md "Signing in with
// OAuth"): off by default, only with the MCP server on, and the whole flow.

func getStatus(t *testing.T, u string) (int, http.Header, []byte) {
	t.Helper()
	res, err := (&http.Client{CheckRedirect: noFollow}).Get(u)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, res.Header, b
}

var oauthPaths = []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp",
	"/.well-known/oauth-authorization-server", "/oauth/authorize?client_id=x"}

func TestOAuthOffByDefaultAndOnlyWithMCP(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	var st apitypes.MCPSettings
	if code := env.admin.get("/v1/admin/settings/mcp", &st); code != 200 || st.OauthEnabled || st.Enabled {
		t.Fatalf("defaults = %d %+v", code, st)
	}
	check := func(what string, want int) {
		t.Helper()
		for _, p := range oauthPaths {
			if code, _, _ := getStatus(t, base+p); (want == 404) != (code == 404) {
				t.Errorf("%s: GET %s = %d", what, p, code)
			}
		}
		for _, p := range []string{"/oauth/token", "/oauth/revoke", "/oauth/register"} {
			res, err := http.PostForm(base+p, url.Values{})
			if err != nil {
				t.Fatal(err)
			}
			_ = res.Body.Close()
			if (want == 404) != (res.StatusCode == 404) {
				t.Errorf("%s: POST %s = %d", what, p, res.StatusCode)
			}
		}
		code, _ := env.member.call("GET", "/v1/oauth/consent?client_id=x", nil, nil, nil)
		if (want == 404) != (code == 404) {
			t.Errorf("%s: consent = %d", what, code)
		}
	}
	check("both off", 404)
	setOAuth(t, env.admin, true, false)
	check("MCP on, OAuth off", 404)
	// Without OAuth, /mcp names only the API key.
	res, body := mcpRaw(t, base, "POST", "", listTools)
	wantRefusal(t, "no key", res, body, 401, -32001, "invalid_api_key")
	if h := res.Header.Get("WWW-Authenticate"); strings.Contains(h, "resource_metadata") {
		t.Errorf("challenge without OAuth = %q", h)
	}
	setOAuth(t, env.admin, false, true)
	check("OAuth on, MCP off", 404)
	res, body = mcpRaw(t, base, "POST", "", listTools)
	wantRefusal(t, "mcp off", res, body, 404, -32004, "mcp_off")
	var me apitypes.Me
	if env.member.get("/v1/me", &me); me.Capabilities.McpOAuth == nil || *me.Capabilities.McpOAuth {
		t.Errorf("capability with MCP off = %v", me.Capabilities.McpOAuth)
	}
	on := setOAuth(t, env.admin, true, true)
	check("both on", 0)
	if env.member.get("/v1/me", &me); me.Capabilities.McpOAuth == nil || !*me.Capabilities.McpOAuth {
		t.Errorf("capability with both on = %v", me.Capabilities.McpOAuth)
	}
	// Auditors can't change it; the change is audited.
	code, e := env.auditor.call("PUT", "/v1/admin/settings/mcp", map[string]any{"enabled": true, "oauthEnabled": false}, nil, ifMatch(on.Revision))
	mustCode(t, "auditor put", code, e, 403, "forbidden")
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.mcp_oauth' AND after_state->>'oauthEnabled' = 'true'`); n != 1 {
		t.Errorf("platform.mcp_oauth entries = %d, want 1", n)
	}
}

func TestOAuthDiscovery(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	setOAuth(t, env.admin, true, true)
	for _, p := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		code, _, raw := getStatus(t, base+p)
		var prm struct {
			Resource             string
			AuthorizationServers []string `json:"authorization_servers"`
			ScopesSupported      []string `json:"scopes_supported"`
		}
		if code != 200 || json.Unmarshal(raw, &prm) != nil || prm.Resource != base+"/mcp" || len(prm.AuthorizationServers) != 1 ||
			prm.AuthorizationServers[0] != base || strings.Join(prm.ScopesSupported, " ") != "mcp" {
			t.Errorf("%s = %d %s", p, code, raw)
		}
	}
	code, _, raw := getStatus(t, base+"/.well-known/oauth-authorization-server")
	var asm map[string]any
	if code != 200 || json.Unmarshal(raw, &asm) != nil {
		t.Fatalf("server metadata = %d %s", code, raw)
	}
	for k, want := range map[string]any{
		"issuer": base, "authorization_endpoint": base + "/oauth/authorize", "token_endpoint": base + "/oauth/token",
		"registration_endpoint": base + "/oauth/register", "revocation_endpoint": base + "/oauth/revoke",
		"authorization_response_iss_parameter_supported": true, "client_id_metadata_document_supported": true,
	} {
		if asm[k] != want {
			t.Errorf("%s = %v, want %v", k, asm[k], want)
		}
	}
	if b, _ := json.Marshal(asm["code_challenge_methods_supported"]); string(b) != `["S256"]` {
		t.Errorf("PKCE methods = %s (plain must not be offered)", b)
	}
	if b, _ := json.Marshal(asm["token_endpoint_auth_methods_supported"]); string(b) != `["none"]` {
		t.Errorf("auth methods = %s", b)
	}
	// /mcp without a credential names the resource metadata (RFC 9728 §5.1).
	res, body := mcpRaw(t, base, "POST", "", listTools)
	wantRefusal(t, "no credential", res, body, 401, -32001, "unauthorized")
	want := `Bearer resource_metadata="` + base + `/.well-known/oauth-protected-resource/mcp", scope="mcp"`
	if h := res.Header.Get("WWW-Authenticate"); h != want {
		t.Errorf("challenge = %q, want %q", h, want)
	}
}

func TestOAuthFlowWithRegisteredClient(t *testing.T) {
	env := newAgentEnv(t)
	base := env.app.URL
	ag := env.publishAgent(t, "Parking helper", env.agentConfig(env.kb.Id.String()))
	setOAuth(t, env.admin, true, true)
	c := registerClient(t, base)
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'oauth.client_register' AND actor_kind = 'system'`); n != 1 {
		t.Errorf("client_register audit = %d", n)
	}

	// Signed out: the authorization endpoint sends the browser to the consent page, which asks to sign in first.
	p := newPKCE()
	q := c.query(p, nil)
	res := authorize(t, base, nil, q)
	if loc := res.Header.Get("Location"); res.StatusCode != 302 || loc != "/oauth/consent?"+q.Encode() {
		t.Fatalf("signed-out authorize = %d %q", res.StatusCode, loc)
	}
	// The consent page's view, as the member.
	var view apitypes.OAuthConsent
	if code := env.member.get("/v1/oauth/consent?"+q.Encode(), &view); code != 200 || view.Client.Name != "Test Assistant" ||
		view.Client.Kind != "registered" || view.Client.Host != "assistant.example.com" || view.RedirectHost != "127.0.0.1:4567" || view.Remembered {
		t.Fatalf("consent view = %d %+v", code, view)
	}
	// The decision needs the app's CSRF token.
	noCSRF := &session{t: t, app: env.app, client: env.member.client}
	if code, e := noCSRF.call("POST", "/v1/oauth/consent", map[string]any{"query": q.Encode(), "decision": "allow"}, nil, nil); code != 403 || e != "csrf_failed" {
		t.Fatalf("consent without CSRF = %d %s", code, e)
	}
	back := consent(t, env.member, q, "allow")
	if back.Host != "127.0.0.1:4567" || back.Query().Get("state") != "st-1" || back.Query().Get("iss") != base || back.Query().Get("code") == "" {
		t.Fatalf("allow redirect = %s", back)
	}
	code := back.Query().Get("code")

	// A wrong verifier fails, and uses the code up.
	status, out, _ := c.token(url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {newPKCE().verifier},
		"redirect_uri": {"http://127.0.0.1:4567/callback"}})
	wantOAuthError(t, "wrong verifier", status, out, 400, "invalid_grant")
	status, out, _ = c.token(url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {p.verifier},
		"redirect_uri": {"http://127.0.0.1:4567/callback"}})
	wantOAuthError(t, "code used twice", status, out, 400, "invalid_grant")

	// Consent is remembered: a signed-in person goes straight back with a new code.
	p2 := newPKCE()
	res = authorize(t, base, env.member, c.query(p2, map[string]string{"redirect_uri": "http://127.0.0.1:5555/callback", "state": "st-2"}))
	loc, _ := url.Parse(res.Header.Get("Location"))
	if res.StatusCode != 302 || loc.Host != "127.0.0.1:5555" || loc.Query().Get("state") != "st-2" || loc.Query().Get("iss") != base {
		t.Fatalf("remembered authorize = %d %s", res.StatusCode, loc)
	}
	status, out, hdr := c.token(url.Values{"grant_type": {"authorization_code"}, "code": {loc.Query().Get("code")},
		"code_verifier": {p2.verifier}, "redirect_uri": {"http://127.0.0.1:5555/callback"}, "resource": {base + "/mcp"}})
	access, _ := out["access_token"].(string)
	refresh, _ := out["refresh_token"].(string)
	if status != 200 || !strings.HasPrefix(access, "gat_") || !strings.HasPrefix(refresh, "grt_") || out["token_type"] != "Bearer" ||
		out["expires_in"] != float64(3600) || out["scope"] != "mcp" || hdr.Get("Cache-Control") != "no-store" {
		t.Fatalf("exchange = %d %v %v", status, out, hdr)
	}
	// Stored as digests only.
	if n := env.scalar(t, `SELECT count(*) FROM oauth_tokens WHERE position(convert_to($1, 'UTF8') in token_hash) > 0 OR length(token_hash) <> 32`, access); n != 0 {
		t.Errorf("a token is stored in clear (%d)", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'oauth.consent'`); n != 1 {
		t.Errorf("oauth.consent entries = %d, want 1 (remembered the second time)", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'oauth.token_issue' AND metadata->>'oauthClient' = 'Test Assistant'
		AND metadata::text NOT LIKE '%gat_%' AND metadata::text NOT LIKE '%grt_%'`); n != 1 {
		t.Errorf("oauth.token_issue entries = %d", n)
	}

	oauthUseMCP(t, env, access, ag.Slug)

	// The token is for /mcp only: the REST API refuses it.
	for _, p := range []string{env.base + "/kbs", "/v1/me", "/v1/agents"} {
		req, _ := http.NewRequest("GET", base+p, nil)
		req.Header.Set("Authorization", "Bearer "+access)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = r.Body.Close()
		if r.StatusCode != 401 {
			t.Errorf("GET %s with an access token = %d, want 401", p, r.StatusCode)
		}
	}

	// Refresh rotates. The old refresh token again within the grace period
	// (two refreshes in flight) gets another pair; after it, reuse revokes the grant.
	status, out, _ = c.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	if status != 200 || out["refresh_token"] == refresh || out["access_token"] == access {
		t.Fatalf("refresh = %d %v", status, out)
	}
	access2 := out["access_token"].(string)
	if _, err := mcpToken(t, base, access2); err != nil {
		t.Fatalf("refreshed token: %v", err)
	}
	status, out, _ = c.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	if status != 200 || out["access_token"] == access2 {
		t.Fatalf("refresh again within the grace period = %d %v", status, out)
	}
	if _, err := mcpToken(t, base, out["access_token"].(string)); err != nil {
		t.Fatalf("token from the second refresh: %v", err)
	}
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE oauth_tokens SET rotated_at = rotated_at - interval '1 minute' WHERE rotated_at IS NOT NULL`); err != nil {
		t.Fatal(err)
	}
	status, out, _ = c.token(url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	wantOAuthError(t, "refresh reuse", status, out, 400, "invalid_grant")
	res, body := mcpRaw(t, base, "POST", access2, listTools)
	wantRefusal(t, "after reuse", res, body, 401, -32001, "invalid_token")
	if h := res.Header.Get("WWW-Authenticate"); !strings.Contains(h, `error="invalid_token"`) || !strings.Contains(h, "resource_metadata=") {
		t.Errorf("challenge = %q", h)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'oauth.revoke' AND metadata->>'reason' = 'refresh_reuse'`); n != 1 {
		t.Errorf("reuse revocation audit = %d", n)
	}
	var grants []apitypes.OAuthGrant
	if code := env.member.get("/v1/me/oauth-grants", &grants); code != 200 || len(grants) != 0 {
		t.Errorf("grants after reuse = %d %+v", code, grants)
	}
}

// oauthUseMCP searches and asks over MCP with an access token: the person's
// knowledge bases and agents, audited as the person through the app.
func oauthUseMCP(t *testing.T, env *agentEnv, access, agentSlug string) {
	t.Helper()
	cs, err := mcpToken(t, env.app.URL, access)
	if err != nil {
		t.Fatalf("connect with an access token: %v", err)
	}
	names, tools := toolNames(t, cs)
	if strings.Join(names, ",") != "ask,search" || strings.Join(schemaEnum(t, tools["search"], "knowledge_base"), ",") != "student-help" ||
		strings.Join(schemaEnum(t, tools["ask"], "agent"), ",") != agentSlug {
		t.Fatalf("tools = %v", names)
	}
	var found mcpserver.SearchResult
	res := callTool(t, cs, "search", map[string]any{"knowledge_base": "student-help", "query": "Where do I buy a parking permit?"}, &found)
	if res.IsError || len(found.Passages) == 0 {
		t.Fatalf("search = %s", toolText(res))
	}
	member := env.member.me.User.Id
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'query' AND metadata->>'channel' = 'mcp' AND user_id = $1
		AND api_key_id IS NULL`, member); n != 1 {
		t.Errorf("mcp usage as the person = %d", n)
	}
	var asked mcpserver.AskResult
	res = callTool(t, cs, "ask", map[string]any{"agent": agentSlug, "question": "Where do students buy a parking permit?"}, &asked)
	if res.IsError || asked.Conversation == "" {
		t.Fatalf("ask = %s", toolText(res))
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'mcp.search' AND actor_kind = 'user' AND actor_user_id = $1
		AND metadata->>'via' = 'oauth' AND metadata->>'oauthClient' = 'Test Assistant' AND team_id IS NOT NULL`, member); n != 1 {
		t.Errorf("mcp.search audit as the person = %d", n)
	}
	// A handle is bound to the grant: a key of the same person can't use it.
	key := createKey(t, env.member, env.base, map[string]any{"name": "other", "scopes": []string{"mcp"}})
	other := mustConnect(t, env.app.URL, key.Secret, "")
	res = callTool(t, other, "ask", map[string]any{"agent": agentSlug, "question": "And the price?", "conversation": asked.Conversation}, nil)
	if !res.IsError || !strings.Contains(toolText(res), "wasn't found") {
		t.Errorf("handle across credentials = %s", toolText(res))
	}
}
