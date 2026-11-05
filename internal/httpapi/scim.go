package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/ratelimit"
	"github.com/ncecere/grounded/internal/scim"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// SCIM 2.0 provisioning at /scim/v2 (docs/specs/scim/DESIGN.md): a protocol of its own (RFC 7644), like /oauth, so it is
// not in the OpenAPI document. Only a SCIM token reaches it; a session, an API key or an OAuth token is refused.

const (
	scimPerTokenPerMinute = 600
	scimFailuresPerMinute = 30
	scimContentType       = "application/scim+json"
)

func scimRoutes(d Deps) []route {
	a := &api{Deps: d, q: dbgen.New(d.Pool)}
	g := &scimGate{a: a, limiter: &ratelimit.Limiter{KV: d.KV}}
	on := func(h func(w http.ResponseWriter, r *http.Request, o scim.Origin)) http.Handler { return g.wrap(h) }
	return []route{
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
		ip := httpx.ClientIP(r, g.a.Config.TrustedProxies)
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

func (a *api) scimBase() string { return strings.TrimRight(a.Config.AppURL, "/") + "/scim/v2" }

func (a *api) scimServiceProviderConfig(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
	scimJSON(w, http.StatusOK, scim.ServiceProviderConfig(a.scimBase()))
}

func (a *api) scimResourceTypes(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
	scimJSON(w, http.StatusOK, scim.ResourceTypes(a.scimBase()))
}

func (a *api) scimSchemas(w http.ResponseWriter, _ *http.Request, _ scim.Origin) {
	scimJSON(w, http.StatusOK, scim.Schemas(a.scimBase()))
}

func (a *api) scimUser(w http.ResponseWriter, status int, u dbgen.User) {
	out := scim.ToUser(a.scimBase(), u)
	w.Header().Set("ETag", out.Meta.Version)
	if status == http.StatusCreated {
		w.Header().Set("Location", out.Meta.Location)
	}
	scimJSON(w, status, out)
}

func (a *api) scimListUsers(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	f, perr := scim.ParseFilter(r.URL.Query().Get("filter"), "username", "externalid", "id", "emails.value")
	if perr != nil {
		scimError(w, perr)
		return
	}
	p := scim.ParsePage(r.URL.Query().Get("startIndex"), r.URL.Query().Get("count"))
	users, total, err := a.SCIM.ListUsers(r.Context(), f, p)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	items := make([]any, len(users))
	for i, u := range users {
		items[i] = scim.ToUser(a.scimBase(), u)
	}
	scimJSON(w, http.StatusOK, scim.List(total, p.Start, items))
}

func (a *api) scimCreateUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	u, err := a.SCIM.CreateUser(r.Context(), o, raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusCreated, u)
}

func (a *api) scimGetUser(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	u, err := a.SCIM.GetUser(r.Context(), r.PathValue("id"))
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusOK, u)
}

func (a *api) scimReplaceUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	u, err := a.SCIM.ReplaceUser(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusOK, u)
}

func (a *api) scimPatchUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	u, err := a.SCIM.PatchUser(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimUser(w, http.StatusOK, u)
}

func (a *api) scimDeleteUser(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	if err := a.SCIM.DeleteUser(r.Context(), o, r.PathValue("id")); err != nil {
		scimFail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// withMembers is false when the client asked to leave members out (Entra: excludedAttributes=members).
func withMembers(r *http.Request) bool {
	for _, a := range strings.Split(r.URL.Query().Get("excludedAttributes"), ",") {
		if strings.EqualFold(strings.TrimSpace(a), "members") {
			return false
		}
	}
	return true
}

func (a *api) scimGroup(w http.ResponseWriter, r *http.Request, status int, id string) {
	g, members, err := a.SCIM.GetGroup(r.Context(), id, withMembers(r))
	if err != nil {
		scimFail(w, r, err)
		return
	}
	out := scim.ToGroup(a.scimBase(), g, members)
	w.Header().Set("ETag", out.Meta.Version)
	if status == http.StatusCreated {
		w.Header().Set("Location", out.Meta.Location)
	}
	scimJSON(w, status, out)
}

func (a *api) scimListGroups(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	f, perr := scim.ParseFilter(r.URL.Query().Get("filter"), "displayname", "externalid", "id")
	if perr != nil {
		scimError(w, perr)
		return
	}
	p := scim.ParsePage(r.URL.Query().Get("startIndex"), r.URL.Query().Get("count"))
	groups, total, err := a.SCIM.ListGroups(r.Context(), f, p)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	items := make([]any, len(groups))
	for i, g := range groups {
		var members []dbgen.ListSCIMGroupMembersRow
		if withMembers(r) {
			if _, members, err = a.SCIM.GetGroup(r.Context(), g.ID.String(), true); err != nil {
				scimFail(w, r, err)
				return
			}
		}
		items[i] = scim.ToGroup(a.scimBase(), g, members)
	}
	scimJSON(w, http.StatusOK, scim.List(total, p.Start, items))
}

func (a *api) scimCreateGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	g, err := a.SCIM.CreateGroup(r.Context(), o, raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimGroup(w, r, http.StatusCreated, g.ID.String())
}

func (a *api) scimGetGroup(w http.ResponseWriter, r *http.Request, _ scim.Origin) {
	a.scimGroup(w, r, http.StatusOK, r.PathValue("id"))
}

func (a *api) scimReplaceGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	g, err := a.SCIM.ReplaceGroup(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimGroup(w, r, http.StatusOK, g.ID.String())
}

func (a *api) scimPatchGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	raw, ok := scimBody(w, r)
	if !ok {
		return
	}
	g, err := a.SCIM.PatchGroup(r.Context(), o, r.PathValue("id"), raw)
	if err != nil {
		scimFail(w, r, err)
		return
	}
	a.scimGroup(w, r, http.StatusOK, g.ID.String())
}

func (a *api) scimDeleteGroup(w http.ResponseWriter, r *http.Request, o scim.Origin) {
	if err := a.SCIM.DeleteGroup(r.Context(), o, r.PathValue("id")); err != nil {
		scimFail(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
