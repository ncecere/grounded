// OAuth sign-in for MCP clients (experimental, off by default; docs/mcp.md
// "Signing in with OAuth"): the protocol endpoints of the authorization
// server in internal/oauth. Like /mcp they speak a protocol (OAuth 2.1,
// RFC 8414, RFC 9728, RFC 7591, RFC 7009), so they are described in
// docs/mcp.md rather than api/openapi.yaml and mounted outside apiRoutes.
// Every one answers 404 unless OAuth sign-in is in effect (its setting and
// the MCP server both on).

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"html/template"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/oauthex"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/oauth"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

const (
	// maxOAuthBody bounds token, revocation and registration requests.
	maxOAuthBody = 16 << 10
	// Per-address rates (per minute) of the protocol endpoints. Registration
	// is rarer and fails closed when Valkey is down; the others fail open.
	oauthRatePerMinute    = 60
	registerRatePerMinute = 10
	// prmPath is the protected resource metadata of /mcp (RFC 9728 §3.1).
	prmPath = "/.well-known/oauth-protected-resource/mcp"
)

// oauthRoutes serve the protocol endpoints.
func oauthRoutes(d Deps) []route {
	a := &api{Deps: d, q: dbgen.New(d.Pool)}
	limiter := &ratelimit.Limiter{KV: d.KV}
	on := func(name string, perMinute int, failClosed bool, h http.HandlerFunc) http.Handler {
		return a.oauthGate(limiter, name, perMinute, failClosed, h)
	}
	return []route{
		{"GET", "/.well-known/oauth-protected-resource", on("", 0, false, a.oauthResourceMetadata)},
		{"GET", prmPath, on("", 0, false, a.oauthResourceMetadata)},
		{"GET", "/.well-known/oauth-authorization-server", on("", 0, false, a.oauthServerMetadata)},
		{"GET", "/oauth/authorize", on("authorize", oauthRatePerMinute, false, a.oauthAuthorize)},
		{"POST", "/oauth/token", on("token", oauthRatePerMinute, false, a.oauthToken)},
		{"POST", "/oauth/revoke", on("revoke", oauthRatePerMinute, false, a.oauthRevoke)},
		{"POST", "/oauth/register", on("register", registerRatePerMinute, true, a.oauthRegister)},
		// Without these, a GET would fall through to the web app (an HTML page with 200).
		{"GET", "/oauth/token", on("", 0, false, oauthPostOnly)},
		{"GET", "/oauth/revoke", on("", 0, false, oauthPostOnly)},
		{"GET", "/oauth/register", on("", 0, false, oauthPostOnly)},
		// Other well-known documents (OpenID discovery, which clients try as a
		// fallback) don't exist: JSON 404, not the web app, whether OAuth is on or not.
		{"GET", "/.well-known/", notFound},
	}
}

// oauthPostOnly answers a GET on an endpoint that only takes POST (405).
func oauthPostOnly(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", http.MethodPost)
	oauthJSONError(w, http.StatusMethodNotAllowed, "invalid_request", "This endpoint only accepts POST.")
}

// oauthOn reports whether OAuth sign-in is in effect.
func (a *api) oauthOn(ctx context.Context) bool {
	if a.OAuth == nil || a.Platform == nil {
		return false
	}
	on, err := a.Platform.MCPOAuthEnabled(ctx)
	if err != nil {
		a.Log.ErrorContext(ctx, "mcp oauth switch", "err", err)
	}
	return err == nil && on
}

// oauthGate answers 404 while OAuth sign-in is off, then applies the
// endpoint's per-address rate (perMinute 0: none).
func (a *api) oauthGate(limiter *ratelimit.Limiter, name string, perMinute int, failClosed bool, h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.oauthOn(r.Context()) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Not found")
			return
		}
		if perMinute > 0 {
			ip := httpx.ClientIP(r, a.Config.TrustedProxies)
			res, err := limiter.Allow(r.Context(), "oauth:"+name+":"+ip, perMinute, time.Minute)
			switch {
			case err != nil && failClosed:
				oauthJSONError(w, http.StatusServiceUnavailable, "temporarily_unavailable", "Try again shortly.")
				return
			case err != nil:
				a.Metrics.RateLimitErrors.Inc()
			case !res.Allowed:
				w.Header().Set("Retry-After", strconv.Itoa(max(int(res.RetryAfter.Seconds()), 1)))
				oauthJSONError(w, http.StatusTooManyRequests, "slow_down", "Too many requests. Try again shortly.")
				return
			}
		}
		h(w, r)
	})
}

// oauthJSON writes a protocol response: plain JSON, never cached.
func oauthJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// oauthJSONError writes an OAuth error response (RFC 6749 §5.2).
func oauthJSONError(w http.ResponseWriter, status int, code, description string) {
	oauthJSON(w, status, map[string]string{"error": code, "error_description": description})
}

// oauthFail writes err: an OAuth error as itself, anything else as a
// logged server_error.
func (a *api) oauthFail(w http.ResponseWriter, r *http.Request, err error) {
	var oe *oauth.Error
	if errors.As(err, &oe) {
		oauthJSONError(w, oe.Status, oe.Code, oe.Description)
		return
	}
	a.Log.ErrorContext(r.Context(), "oauth", "err", err)
	oauthJSONError(w, http.StatusInternalServerError, "server_error", "Something went wrong. Try again shortly.")
}

// oauthResourceMetadata is the protected resource metadata of /mcp (RFC
// 9728), at the path-suffixed address the 401 names and at the root.
func (a *api) oauthResourceMetadata(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "max-age=60")
	_ = json.NewEncoder(w).Encode(oauthex.ProtectedResourceMetadata{
		Resource: a.OAuth.Resource(), AuthorizationServers: []string{a.OAuth.Issuer()}, ScopesSupported: []string{oauth.Scope},
		BearerMethodsSupported: []string{"header"}, ResourceName: a.Config.Instance.Name,
	})
}

// oauthServerMetadata is the authorization server metadata (RFC 8414).
func (a *api) oauthServerMetadata(w http.ResponseWriter, _ *http.Request) {
	iss := a.OAuth.Issuer()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "max-age=60")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"issuer":                                         iss,
		"authorization_endpoint":                         iss + "/oauth/authorize",
		"token_endpoint":                                 iss + "/oauth/token",
		"registration_endpoint":                          iss + "/oauth/register",
		"revocation_endpoint":                            iss + "/oauth/revoke",
		"scopes_supported":                               []string{oauth.Scope},
		"response_types_supported":                       []string{"code"},
		"response_modes_supported":                       []string{"query"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"token_endpoint_auth_methods_supported":          []string{"none"},
		"revocation_endpoint_auth_methods_supported":     []string{"none"},
		"code_challenge_methods_supported":               []string{"S256"},
		"client_id_metadata_document_supported":          true,
		"authorization_response_iss_parameter_supported": true,
	})
}

// oauthAuthorize is the authorization endpoint. A request whose client or
// redirect URI isn't good gets a page (never a redirect); other errors go
// back to the client. A signed-in person who already allowed the client
// goes straight back with a code; everyone else goes to the consent page
// of the app (which asks them to sign in first).
func (a *api) oauthAuthorize(w http.ResponseWriter, r *http.Request) {
	req, err := oauth.RequestFromQuery(r.URL.Query())
	if err != nil {
		a.oauthPage(w, r, err)
		return
	}
	c, err := a.OAuth.Check(r.Context(), req)
	var oe *oauth.Error
	if errors.As(err, &oe) && !oe.ShowPage() {
		http.Redirect(w, r, a.OAuth.ErrorRedirect(req, oe), http.StatusFound)
		return
	} else if err != nil {
		a.oauthPage(w, r, err)
		return
	}
	if user, ok := a.Auth.SessionUser(r); ok {
		remembered, err := a.OAuth.Remembered(r.Context(), user.ID, c.ID)
		if err != nil {
			a.oauthPage(w, r, err)
			return
		}
		if remembered {
			actor := authz.Actor{UserID: user.ID, PlatformRole: user.PlatformRole,
				RequestID: httpx.RequestID(r.Context()), ClientIP: httpx.ClientIP(r, a.Config.TrustedProxies)}
			to, err := a.OAuth.Approve(r.Context(), actor, c, req)
			if err != nil {
				a.oauthPage(w, r, err)
				return
			}
			http.Redirect(w, r, to, http.StatusFound)
			return
		}
	}
	http.Redirect(w, r, oauthConsentPath+"?"+r.URL.RawQuery, http.StatusFound)
}

var oauthPageTmpl = template.Must(template.New("oauth").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Can't connect this app · {{.Instance}}</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#1f2328}
h1{font-size:1.4rem}code{background:#f3f4f6;padding:0 .25rem}</style></head>
<body><main><h1>Can't connect this app</h1><p>{{.Message}}</p>
<p>Nothing was shared with the app. Close this page and try connecting again, or ask the app's maker.</p>
<p><small>Error: <code>{{.Code}}</code></small></p></main></body></html>`))

// oauthPage shows an authorization error to the person (400; 500 for a
// failure of ours, logged).
func (a *api) oauthPage(w http.ResponseWriter, r *http.Request, err error) {
	status, code, msg := http.StatusBadRequest, "invalid_request", "The app's request isn't valid."
	var oe *oauth.Error
	if errors.As(err, &oe) {
		code, msg = oe.Code, oe.Description
	} else {
		a.Log.ErrorContext(r.Context(), "oauth authorize", "err", err)
		status, code, msg = http.StatusInternalServerError, "server_error", "Something went wrong. Try again shortly."
	}
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
	w.WriteHeader(status)
	_ = oauthPageTmpl.Execute(w, map[string]string{"Instance": a.Config.Instance.Name, "Message": msg, "Code": code})
}

// oauthForm reads a form-encoded protocol request (bounded).
func oauthForm(w http.ResponseWriter, r *http.Request) bool {
	mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mt != "application/x-www-form-urlencoded" {
		oauthJSONError(w, http.StatusBadRequest, "invalid_request", "Send the request as application/x-www-form-urlencoded.")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxOAuthBody)
	if err := r.ParseForm(); err != nil {
		oauthJSONError(w, http.StatusBadRequest, "invalid_request", "The request body couldn't be read.")
		return false
	}
	return true
}

// formClientID is the client_id in the form, or the user of a Basic
// Authorization header (clients that send it there with an empty secret).
func formClientID(r *http.Request) string {
	if id := r.PostForm.Get("client_id"); id != "" {
		return id
	}
	if user, _, ok := r.BasicAuth(); ok {
		return user
	}
	return ""
}

// oauthToken is the token endpoint.
func (a *api) oauthToken(w http.ResponseWriter, r *http.Request) {
	if !oauthForm(w, r) {
		return
	}
	f := r.PostForm
	out, err := a.OAuth.Token(r.Context(), oauth.TokenRequest{
		GrantType: f.Get("grant_type"), ClientID: formClientID(r), Code: f.Get("code"), RedirectURI: f.Get("redirect_uri"),
		CodeVerifier: f.Get("code_verifier"), RefreshToken: f.Get("refresh_token"), Resource: f.Get("resource"),
		RequestID: httpx.RequestID(r.Context()), ClientIP: httpx.ClientIP(r, a.Config.TrustedProxies),
	})
	if err != nil {
		a.oauthFail(w, r, err)
		return
	}
	oauthJSON(w, http.StatusOK, out)
}

// oauthRevoke is the revocation endpoint (RFC 7009): 200 whatever the token.
func (a *api) oauthRevoke(w http.ResponseWriter, r *http.Request) {
	if !oauthForm(w, r) {
		return
	}
	token := r.PostForm.Get("token")
	if token == "" {
		oauthJSONError(w, http.StatusBadRequest, "invalid_request", "Send the token to revoke.")
		return
	}
	err := a.OAuth.Revoke(r.Context(), token, formClientID(r), httpx.RequestID(r.Context()), httpx.ClientIP(r, a.Config.TrustedProxies))
	if err != nil {
		a.oauthFail(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
}

// oauthRegister is Dynamic Client Registration (RFC 7591) for clients that
// can't use a metadata document: public clients only.
func (a *api) oauthRegister(w http.ResponseWriter, r *http.Request) {
	var in oauth.ClientMetadata
	r.Body = http.MaxBytesReader(w, r.Body, maxOAuthBody)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		oauthJSONError(w, http.StatusBadRequest, "invalid_client_metadata", "Send the client's metadata as a JSON object of at most 16 KiB.")
		return
	}
	reg, err := a.OAuth.Register(r.Context(), in, httpx.RequestID(r.Context()), httpx.ClientIP(r, a.Config.TrustedProxies))
	if err != nil {
		a.oauthFail(w, r, err)
		return
	}
	out := map[string]any{
		"client_id": reg.ID, "client_id_issued_at": reg.IssuedAt, "client_name": reg.Name, "redirect_uris": reg.RedirectURIs,
		"token_endpoint_auth_method": "none", "grant_types": []string{"authorization_code", "refresh_token"},
		"response_types": []string{"code"}, "scope": oauth.Scope,
	}
	if reg.URI != "" {
		out["client_uri"] = reg.URI
	}
	if reg.LogoURI != "" {
		out["logo_uri"] = reg.LogoURI
	}
	oauthJSON(w, http.StatusCreated, out)
}

// wwwAuthenticate is the challenge of a 401 from /mcp while OAuth sign-in
// is on (RFC 9728 §5.1): where the resource's metadata is, the scope, and
// for a bad token its error.
func (a *api) wwwAuthenticate(errCode string) string {
	v := `Bearer resource_metadata="` + a.OAuth.Issuer() + prmPath + `", scope="` + oauth.Scope + `"`
	if errCode != "" {
		v += `, error="` + errCode + `"`
	}
	return strings.TrimSpace(v)
}
