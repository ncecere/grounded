package httpapi_test

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Helpers for OAuth sign-in for MCP clients (oauth_*_integration_test.go).

const oauthRedirect = "http://127.0.0.1/callback"

// setOAuth sets the MCP server and OAuth sign-in as the platform admin.
func setOAuth(t *testing.T, admin *session, mcpOn, oauthOn bool) apitypes.MCPSettings {
	t.Helper()
	var cur, out apitypes.MCPSettings
	if code := admin.get("/v1/admin/settings/mcp", &cur); code != 200 {
		t.Fatalf("get mcp settings = %d", code)
	}
	code, e := admin.call("PUT", "/v1/admin/settings/mcp", map[string]any{"enabled": mcpOn, "oauthEnabled": oauthOn}, &out, ifMatch(cur.Revision))
	mustCode(t, "set mcp oauth", code, e, 200, "")
	if out.Enabled != mcpOn || out.OauthEnabled != oauthOn {
		t.Fatalf("settings = %+v", out)
	}
	return out
}

// pkce is a verifier and its S256 challenge.
type pkce struct{ verifier, challenge string }

func newPKCE() pkce {
	v := rand.Text() + rand.Text() // 52 characters of base32
	sum := sha256.Sum256([]byte(v))
	return pkce{verifier: v, challenge: base64.RawURLEncoding.EncodeToString(sum[:])}
}

// oauthClient drives the protocol endpoints as a client would.
type oauthClient struct {
	t    *testing.T
	base string
	id   string
}

// registerClient registers a public client with redirect URIs.
func registerClient(t *testing.T, base string, redirects ...string) *oauthClient {
	t.Helper()
	if len(redirects) == 0 {
		redirects = []string{oauthRedirect}
	}
	code, out := postJSON(t, base+"/oauth/register", map[string]any{"client_name": "Test Assistant", "redirect_uris": redirects,
		"client_uri": "https://assistant.example.com", "token_endpoint_auth_method": "none", "grant_types": []string{"authorization_code", "refresh_token"}})
	if code != http.StatusCreated || !strings.HasPrefix(out["client_id"].(string), "gcl_") {
		t.Fatalf("register = %d %v", code, out)
	}
	return &oauthClient{t: t, base: base, id: out["client_id"].(string)}
}

func postJSON(t *testing.T, u string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	res, err := http.Post(u, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// query is an authorization request for p, with overrides.
func (c *oauthClient) query(p pkce, over map[string]string) url.Values {
	q := url.Values{"client_id": {c.id}, "redirect_uri": {"http://127.0.0.1:4567/callback"}, "response_type": {"code"},
		"code_challenge": {p.challenge}, "code_challenge_method": {"S256"}, "resource": {c.base + "/mcp"}, "state": {"st-1"}, "scope": {"mcp"}}
	for k, v := range over {
		if v == "" {
			q.Del(k)
		} else {
			q.Set(k, v)
		}
	}
	return q
}

// authorize sends the browser (with s's cookies, or none) to the
// authorization endpoint, without following the redirect.
func authorize(t *testing.T, base string, s *session, q url.Values) *http.Response {
	t.Helper()
	cl := &http.Client{CheckRedirect: noFollow}
	if s != nil {
		cl.Jar = s.client.Jar
	}
	res, err := cl.Get(base + "/oauth/authorize?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	_ = res.Body.Close()
	return res
}

// consent allows or denies on the consent page as s and returns where the
// browser is sent.
func consent(t *testing.T, s *session, q url.Values, decision string) *url.URL {
	t.Helper()
	var out struct{ RedirectUrl string }
	code, e := s.call("POST", "/v1/oauth/consent", map[string]any{"query": q.Encode(), "decision": decision}, &out, nil)
	mustCode(t, "consent "+decision, code, e, 200, "")
	u, err := url.Parse(out.RedirectUrl)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// token posts to the token endpoint.
func (c *oauthClient) token(form url.Values) (int, map[string]any, http.Header) {
	c.t.Helper()
	if form.Get("client_id") == "" {
		form.Set("client_id", c.id)
	}
	res, err := http.PostForm(c.base+"/oauth/token", form)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out, res.Header
}

// exchange redeems a code for tokens (which must succeed).
func (c *oauthClient) exchange(code string, p pkce) (access, refresh string) {
	c.t.Helper()
	status, out, _ := c.token(url.Values{"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {p.verifier},
		"redirect_uri": {"http://127.0.0.1:4567/callback"}, "resource": {c.base + "/mcp"}})
	if status != 200 {
		c.t.Fatalf("exchange = %d %v", status, out)
	}
	return out["access_token"].(string), out["refresh_token"].(string)
}

// signInApp runs the whole flow for s (consent once) and returns tokens.
func (c *oauthClient) signInApp(s *session) (access, refresh string) {
	c.t.Helper()
	p := newPKCE()
	q := c.query(p, nil)
	back := consent(c.t, s, q, "allow")
	return c.exchange(back.Query().Get("code"), p)
}

// wantOAuthError checks a token endpoint error.
func wantOAuthError(t *testing.T, what string, status int, out map[string]any, wantStatus int, wantCode string) {
	t.Helper()
	if status != wantStatus || out["error"] != wantCode {
		t.Fatalf("%s = %d %v, want %d %s", what, status, out, wantStatus, wantCode)
	}
}

// mcpToken connects the SDK's client to /mcp with an access token.
func mcpToken(t *testing.T, base, token string) (*mcp.ClientSession, error) {
	t.Helper()
	return mcpConnect(t, base, token, "")
}
