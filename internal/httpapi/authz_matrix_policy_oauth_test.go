package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
)

// Classification of OAuth sign-in for MCP clients (docs/mcp.md): the
// consent page and connected apps are the signed-in person's own, in the
// app (API keys get 401); a person's apps are readable by platform admins
// and auditors and revocable by platform admins. The matrix turns the MCP
// server and OAuth sign-in on (seedOAuth).

func init() {
	register("listMyOAuthGrants", policy{scope: scopeGlobal, own: signedIn, build: func(*mctx) request { return get("/v1/me/oauth-grants") }})
	register("getOAuthConsent", policy{scope: scopeGlobal, own: signedIn, build: func(c *mctx) request {
		return get("/v1/oauth/consent?" + c.e.consentQuery())
	}})
	register("decideOAuthConsent", policy{scope: scopeGlobal, own: signedIn, build: func(c *mctx) request {
		return post("/v1/oauth/consent", map[string]any{"query": c.e.consentQuery(), "decision": "deny"})
	}})
	// A person's own grant; anyone else (and every foreign call) aims at
	// team A's owner's.
	register("revokeMyOAuthGrant", policy{scope: scopeUser, own: signedIn, build: func(c *mctx) request {
		email := "aowner@example.edu"
		if c.allowed {
			email = personaEmails[c.who]
		}
		return del("/v1/me/oauth-grants/" + c.e.freshGrant(c.t, email))
	}})
	register("adminListUserOAuthGrants", policy{scope: scopeGlobal, own: platform, build: func(c *mctx) request {
		return get("/v1/admin/users/" + c.e.member.me.User.Id.String() + "/oauth-grants")
	}})
	register("adminRevokeUserOAuthGrant", policy{scope: scopeGlobal, own: padmin, build: func(c *mctx) request {
		return del("/v1/admin/users/" + c.e.member.me.User.Id.String() + "/oauth-grants/" + c.e.freshGrant(c.t, "blair@localhost"))
	}})
}

// personaEmails are the signed-in callers' addresses.
var personaEmails = map[caller]string{
	cMember: "blair@localhost", cEditor: "alex@localhost", cTeamAdmin: "casey@localhost", cOwner: "user@localhost",
	cPlatformAdmin: "admin@localhost", cAuditor: "auditor@localhost",
}

// seedOAuth turns the MCP server and OAuth sign-in on and registers a client.
func (e *matrixEnv) seedOAuth(t *testing.T) string {
	t.Helper()
	p := "/v1/admin/settings/mcp"
	must(t, e.admin, "PUT", p, map[string]any{"enabled": true, "oauthEnabled": true}, ifMatch(revisionOf(t, e.admin, p)))
	body, _ := json.Marshal(map[string]any{"client_name": "Matrix app", "redirect_uris": []string{"http://127.0.0.1/callback"}})
	res, err := http.Post(e.app.URL+"/oauth/register", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var reg struct {
		ClientID string `json:"client_id"`
	}
	if res.StatusCode != http.StatusCreated || json.NewDecoder(res.Body).Decode(&reg) != nil {
		t.Fatalf("register OAuth client: %d", res.StatusCode)
	}
	return reg.ClientID
}

// consentQuery is a valid authorization request for the registered client.
func (e *matrixEnv) consentQuery() string {
	return url.Values{
		"client_id": {e.oauthClient}, "redirect_uri": {"http://127.0.0.1:4000/callback"}, "response_type": {"code"},
		"code_challenge": {"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"}, "code_challenge_method": {"S256"},
		"resource": {e.app.URL + "/mcp"}, "state": {"matrix"},
	}.Encode()
}

// freshGrant gives the person with this email a connected app.
func (e *matrixEnv) freshGrant(t *testing.T, email string) string {
	t.Helper()
	var id string
	err := e.app.Pool.QueryRow(context.Background(), `INSERT INTO oauth_grants (user_id, client_id, client_kind, client_name, resource)
		SELECT id, $2, 'registered', 'Matrix app', $3 FROM users WHERE email = $1 RETURNING id::text`,
		email, fmt.Sprintf("gcl_matrix_%d", e.next()), e.app.URL+"/mcp").Scan(&id)
	if err != nil {
		t.Fatalf("grant for %s: %v", email, err)
	}
	return id
}
