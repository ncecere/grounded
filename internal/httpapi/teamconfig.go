package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/teamconfig"
)

// Unlike general either routes, export does not Touch the API key (a write).
func (a *api) configurationRoute() http.Handler {
	return a.keyAuthMode(a.Auth.RequireSession(http.HandlerFunc(a.exportTeamConfiguration)), http.HandlerFunc(a.exportTeamConfiguration), httpx.Error, false, true)
}
func (a *api) exportTeamConfiguration(w http.ResponseWriter, r *http.Request) {
	raw, err := teamconfig.Export(r.Context(), a.Pool, a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	w.Header().Set("Content-Type", "application/yaml")
	w.Header().Set("Content-Disposition", `attachment; filename="team-configuration.yaml"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}
