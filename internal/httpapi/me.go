package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/auth"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// meRoute is GET /v1/me: the signed-in user. With optional=true a request
// without a session cookie gets {"data": null} instead of a 401, so the web
// app's signed-out pages (public agents) don't log an error on every load.
func (a *api) meRoute() http.Handler {
	withSession := a.session(a.getMe)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("optional") == "true" && r.Header.Get("Authorization") == "" && !a.Auth.HasSessionCookie(r) {
			httpx.JSON(w, http.StatusOK, nil)
			return
		}
		withSession.ServeHTTP(w, r)
	})
}

func (a *api) getMe(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.FromContext(r.Context())
	myTeams, err := a.Teams.ListMine(r.Context(), id.User.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.Me{
		User:      toAPIUser(id.User),
		CsrfToken: id.CSRFToken,
		Capabilities: apitypes.Capabilities{
			PlatformAdmin:   id.IsPlatformAdmin(),
			PlatformAuditor: id.IsPlatformAuditor(),
			Evaluations:     ptrTo(a.evaluationsOn(r.Context())),
			Mcp:             ptrTo(a.mcpOn(r.Context())),
		},
		Teams: toAPIMyTeams(myTeams),
	})
}

func ptrTo[T any](v T) *T { return &v }
