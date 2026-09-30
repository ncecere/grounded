// /mcp as an OAuth protected resource (experimental; docs/mcp.md "Signing
// in with OAuth"): an access token from internal/oauth acts as its person.

package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/mcpserver"
	"github.com/ncecere/grounded/internal/oauth"
	"github.com/ncecere/grounded/internal/ratelimit"
)

// bearerAccessToken returns the request's bearer value when it has the
// shape of an OAuth access token (API keys look different).
func bearerAccessToken(r *http.Request) (string, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return token, ok && oauth.IsAccessToken(token)
}

// mcpOAuth serves a request with an access token: refused (401, with the
// challenge that sends the client to sign in again) while OAuth sign-in is
// off, or when the token is unknown, expired, revoked, for another
// resource, or its person is suspended; limited per grant like an API key.
func (a *api) mcpOAuth(serve func(http.ResponseWriter, *http.Request, mcpserver.Caller)) func(http.ResponseWriter, *http.Request, string) {
	limiter := &ratelimit.Limiter{KV: a.KV}
	return func(w http.ResponseWriter, r *http.Request, token string) {
		if !a.oauthOn(r.Context()) {
			mcpError(w, http.StatusUnauthorized, "oauth_off", "OAuth sign-in for MCP clients is off. Use an API key with the mcp scope.")
			return
		}
		p, err := a.OAuth.Authenticate(r.Context(), token)
		if errors.Is(err, oauth.ErrInvalidToken) {
			w.Header().Set("WWW-Authenticate", a.wwwAuthenticate("invalid_token"))
			mcpError(w, http.StatusUnauthorized, "invalid_token", "The access token is invalid, expired or revoked. Sign in again.")
			return
		} else if err != nil {
			a.Log.ErrorContext(r.Context(), "mcp oauth", "err", err)
			mcpError(w, http.StatusInternalServerError, "internal", "Something went wrong. Try again shortly.")
			return
		}
		res, err := limiter.Allow(r.Context(), "oauth-grant:"+p.Grant.ID.String(), a.Config.RequestsPerMinute, time.Minute)
		if err != nil {
			a.Metrics.RateLimitErrors.Inc() // fail open: authenticated traffic (ADR-0015)
		} else if !res.Allowed {
			w.Header().Set("Retry-After", strconv.Itoa(max(int(res.RetryAfter.Seconds()), 1)))
			mcpError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests from this app. Try again shortly.")
			return
		}
		caller := mcpserver.NewOAuthCaller(p.UserID, p.Grant, httpx.RequestID(r.Context()), httpx.ClientIP(r, a.Config.TrustedProxies))
		serve(w, r, caller)
	}
}
