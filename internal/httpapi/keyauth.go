package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/apikeys"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/ratelimit"
)

type keyActorKey struct{}

// sessionOrKey accepts a browser session or an API key
// (Authorization: Bearer rag_...). API-key requests carry no cookies, so no
// CSRF check applies; what a key may do is decided by its scopes in the
// services (ADR-0012).
func (a *api) sessionOrKey(next http.Handler) http.Handler {
	return a.keyOr(a.Auth.RequireSession(next), next, httpx.Error)
}

// errorWriter writes an error response in some envelope.
type errorWriter func(w http.ResponseWriter, status int, code, message string)

// keyOr authenticates "Authorization: Bearer rag_..." API keys (then records
// the use and calls next) and hands every other request to fallback. fail
// writes key errors.
func (a *api) keyOr(fallback, next http.Handler, fail errorWriter) http.Handler {
	return a.keyAuth(fallback, next, fail, true)
}

// keyAuth is keyOr; with touch false, next records the key's use itself
// once it accepts the request (/mcp refuses a key without the mcp scope,
// and a refused call isn't a use).
func (a *api) keyAuth(fallback, next http.Handler, fail errorWriter, touch bool) http.Handler {
	limiter := &ratelimit.Limiter{KV: a.KV}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if header == "" {
			fallback.ServeHTTP(w, r)
			return
		}
		if a.APIKeys == nil || !strings.HasPrefix(header, "Bearer ") || len(header) > 512 {
			fail(w, http.StatusUnauthorized, "invalid_api_key", "Send a valid API key as: Authorization: Bearer <key>")
			return
		}
		actor, err := a.APIKeys.Verify(r.Context(), strings.TrimPrefix(header, "Bearer "))
		if errors.Is(err, apikeys.ErrInvalidKey) {
			fail(w, http.StatusUnauthorized, "invalid_api_key", "The API key is invalid, expired or revoked")
			return
		} else if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		res, err := limiter.Allow(r.Context(), "key:"+actor.Key.ID.String(), a.Config.RequestsPerMinute, time.Minute)
		if err != nil {
			a.Metrics.RateLimitErrors.Inc() // fail open: authenticated traffic (ADR-0015)
		} else if !res.Allowed {
			w.Header().Set("Retry-After", strconv.Itoa(max(int(res.RetryAfter.Seconds()), 1)))
			fail(w, http.StatusTooManyRequests, "rate_limited", "Too many requests for this API key. Try again shortly.")
			return
		}
		if touch {
			a.APIKeys.Touch(r.Context(), actor.Key.ID)
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), keyActorKey{}, actor)))
	})
}

// keyActor returns the API-key principal, if the request used one.
func keyActor(r *http.Request) (authz.Actor, bool) {
	a, ok := r.Context().Value(keyActorKey{}).(authz.Actor)
	return a, ok
}
