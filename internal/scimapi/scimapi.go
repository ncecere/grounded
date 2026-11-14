// Package scimapi serves SCIM 2.0 provisioning at /scim/v2
// (docs/specs/scim/DESIGN.md): a protocol of its own (RFC 7644), like /oauth,
// so it is not in the OpenAPI document. Only a SCIM token reaches it; a
// session, an API key or an OAuth token is refused. Admin → SCIM provisioning
// (the tokens) is part of the API, in internal/httpapi.
package scimapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/scim"
)

const (
	scimPerTokenPerMinute = 600
	scimFailuresPerMinute = 30
	scimContentType       = "application/scim+json"
)

// Deps are what the SCIM endpoint needs: the SCIM service, the rate limiter's
// store, the metrics and two settings.
type Deps struct {
	SCIM    *scim.Service
	KV      *kv.Store
	Metrics *observability.Metrics
	// AppURL is the public base URL; resources' locations are under it.
	AppURL string
	// TrustedProxies may set X-Forwarded-For (failures are limited per client address).
	TrustedProxies []netip.Prefix
}

// Route is one SCIM endpoint; the API server mounts them beside its own
// routes, behind the same middleware.
type Route struct {
	Method  string
	Path    string
	Handler http.Handler
}

type api struct{ Deps }

// Routes are the /scim/v2 endpoints.
func Routes(d Deps) []Route {
	a := &api{Deps: d}
	g := &scimGate{a: a, limiter: &ratelimit.Limiter{KV: d.KV}}
	on := func(h func(w http.ResponseWriter, r *http.Request, o scim.Origin)) http.Handler { return g.wrap(h) }
	return []Route{
		{"GET", "/scim/v2/ServiceProviderConfig", on(a.scimServiceProviderConfig)},
		{"GET", "/scim/v2/ResourceTypes", on(a.scimResourceTypes)},
		{"GET", "/scim/v2/Schemas", on(a.scimSchemas)},
		{"GET", "/scim/v2/Users", on(a.scimListUsers)},
		{"POST", "/scim/v2/Users", on(a.scimCreateUser)},
		{"GET", "/scim/v2/Users/{id}", on(a.scimGetUser)},
		{"PUT", "/scim/v2/Users/{id}", on(a.scimReplaceUser)},
		{"PATCH", "/scim/v2/Users/{id}", on(a.scimPatchUser)},
		{"DELETE", "/scim/v2/Users/{id}", on(a.scimDeleteUser)},
		{"GET", "/scim/v2/Groups", on(a.scimListGroups)},
		{"POST", "/scim/v2/Groups", on(a.scimCreateGroup)},
		{"GET", "/scim/v2/Groups/{id}", on(a.scimGetGroup)},
		{"PUT", "/scim/v2/Groups/{id}", on(a.scimReplaceGroup)},
		{"PATCH", "/scim/v2/Groups/{id}", on(a.scimPatchGroup)},
		{"DELETE", "/scim/v2/Groups/{id}", on(a.scimDeleteGroup)},
		// Anything else under /scim is a SCIM 404, never the web app.
		{"GET", "/scim/", on(func(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
			scimError(w, &scim.Error{Status: 404, Detail: "Not found"})
		})},
	}
}

type scimGate struct {
	a       *api
	limiter *ratelimit.Limiter
}

// wrap checks SCIM is available and the bearer token, and rate-limits: failed attempts per client address, requests per
// token.
func (g *scimGate) wrap(h func(w http.ResponseWriter, r *http.Request, o scim.Origin)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !g.a.SCIM.Available() {
			scimError(w, &scim.Error{Status: http.StatusNotFound, Detail: "SCIM is not available: Grounded has no sign-in provider"})
			return
		}
		ip := httpx.ClientIP(r, g.a.TrustedProxies)
		if !g.allow(w, r, "scim:fail:"+ip, scimFailuresPerMinute, true) {
			return
		}
		secret, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		tok, err := g.a.SCIM.Authenticate(r.Context(), strings.TrimSpace(secret))
		if !ok || errors.Is(err, scim.ErrUnauthorized) {
			_, _ = g.limiter.Allow(r.Context(), "scim:fail:"+ip, scimFailuresPerMinute, time.Minute)
			w.Header().Set("WWW-Authenticate", `Bearer realm="scim"`)
			scimError(w, &scim.Error{Status: http.StatusUnauthorized, Detail: "A valid SCIM token is required"})
			return
		} else if err != nil {
			scimFail(w, r, err)
			return
		}
		if !g.allow(w, r, "scim:token:"+tok.ID.String(), scimPerTokenPerMinute, false) {
			return
		}
		h(w, r, scim.Origin{Token: tok, RequestID: httpx.RequestID(r.Context()), ClientIP: ip})
	})
}

// allow counts a request against a limit (peek only: failures are counted when they happen).
func (g *scimGate) allow(w http.ResponseWriter, r *http.Request, key string, limit int, peek bool) bool {
	var n int
	var err error
	if peek {
		n, err = g.limiter.Peek(r.Context(), key, time.Minute)
	} else {
		var res ratelimit.Result
		res, err = g.limiter.Allow(r.Context(), key, limit, time.Minute)
		if err == nil && !res.Allowed {
			n = limit
		}
	}
	if err != nil {
		g.a.Metrics.RateLimitErrors.Inc()
		return true
	}
	if n >= limit {
		w.Header().Set("Retry-After", "60")
		scimError(w, &scim.Error{Status: http.StatusTooManyRequests, Detail: "Too many requests. Try again shortly."})
		return false
	}
	return true
}

func scimJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", scimContentType)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func scimError(w http.ResponseWriter, e *scim.Error) {
	body := map[string]any{"schemas": []string{scim.SchemaError}, "status": strconv.Itoa(e.Status), "detail": e.Detail}
	if e.Type != "" {
		body["scimType"] = e.Type
	}
	scimJSON(w, e.Status, body)
}

// scimFail writes a SCIM error, or a 500 (logged, without detail) for anything else.
func scimFail(w http.ResponseWriter, r *http.Request, err error) {
	var e *scim.Error
	if errors.As(err, &e) {
		scimError(w, e)
		return
	}
	httpx.InternalWith(w, r, err, scimErrorWriter)
}

// scimErrorWriter writes httpx's internal errors in SCIM's error schema.
func scimErrorWriter(w http.ResponseWriter, status int, _, message string) {
	scimError(w, &scim.Error{Status: status, Detail: message})
}

func scimBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, scim.MaxBodyBytes))
	if err != nil {
		scimError(w, &scim.Error{Status: http.StatusRequestEntityTooLarge, Detail: "The request body is larger than 1 MiB"})
		return nil, false
	}
	return raw, true
}
