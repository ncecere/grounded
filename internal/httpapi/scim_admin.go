package httpapi

import (
	"net/http"
	"strings"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/scimapi"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// scimAdminRoutes: Admin → SCIM provisioning. Signed in only: a token is never managed with an API key or OAuth.
func (a *api) scimAdminRoutes() []route {
	return []route{
		{"GET", "/v1/admin/scim", a.admin(a.adminGetScim)},
		{"POST", "/v1/admin/scim/tokens", a.admin(a.adminCreateScimToken)},
		{"DELETE", "/v1/admin/scim/tokens/{tokenId}", a.admin(a.adminRevokeScimToken)},
	}
}

func toAPIScimToken(t dbgen.ListSCIMTokensRow) apitypes.ScimToken {
	return apitypes.ScimToken{Id: t.ID, Name: t.Name, CreatedAt: t.CreatedAt, LastUsedAt: t.LastUsedAt, CreatedBy: t.CreatedByName}
}

func (a *api) adminGetScim(w http.ResponseWriter, r *http.Request) {
	sum, err := a.SCIM.Get(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.ScimStatus{Available: sum.Enabled, BaseUrl: strings.TrimRight(a.Config.AppURL, "/") + "/scim/v2", MatchClaim: a.SCIM.MatchClaim,
		Tokens: make([]apitypes.ScimToken, len(sum.Tokens)), Users: sum.Counts.Users, PendingUsers: sum.Counts.Pending, Groups: sum.Counts.Groups}
	for i, t := range sum.Tokens {
		out.Tokens[i] = toAPIScimToken(t)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminCreateScimToken(w http.ResponseWriter, r *http.Request) {
	var in apitypes.AdminCreateScimTokenJSONRequestBody
	if !httpx.Decode(w, r, &in) {
		return
	}
	tok, secret, err := a.SCIM.CreateToken(r.Context(), a.actor(r), in.Name)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, apitypes.ScimTokenCreated{Secret: secret, Token: apitypes.ScimToken{
		Id: tok.ID, Name: tok.Name, CreatedAt: tok.CreatedAt, LastUsedAt: tok.LastUsedAt, CreatedBy: creatorName(r)}})
}

// creatorName is the signed-in admin's display name.
func creatorName(r *http.Request) string {
	id, _ := auth.FromContext(r.Context())
	return id.User.DisplayName
}

func (a *api) adminRevokeScimToken(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "tokenId")
	if !ok {
		return
	}
	writeOK(w, r, a.SCIM.RevokeToken(r.Context(), a.actor(r), id))
}

// scimRoutes mounts SCIM provisioning (internal/scimapi) behind the same
// middleware as the API.
func scimRoutes(d Deps) []route {
	var out []route
	for _, rt := range scimapi.Routes(scimapi.Deps{SCIM: d.SCIM, KV: d.KV, Metrics: d.Metrics,
		AppURL: d.Config.AppURL, TrustedProxies: d.Config.TrustedProxies}) {
		out = append(out, route{rt.Method, rt.Path, rt.Handler})
	}
	return out
}
