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

// Planning reads only, like export: an API key's last use is not written either. Applying is an ordinary write.
func (a *api) configurationPlanRoute() http.Handler {
	return a.keyAuthMode(a.Auth.RequireSession(http.HandlerFunc(a.planTeamConfiguration)), http.HandlerFunc(a.planTeamConfiguration), httpx.Error, false, true)
}

func (a *api) configurationApplyRoute() http.Handler { return a.either(a.applyTeamConfiguration) }

// planTeamConfiguration says what applying a configuration file (the request body, YAML) would change
// (docs/specs/config-as-code-import §7). It changes nothing.
func (a *api) planTeamConfiguration(w http.ResponseWriter, r *http.Request) {
	p, err := a.TeamConfig.Plan(r.Context(), a.actor(r), r.PathValue("team"), http.MaxBytesReader(w, r.Body, teamconfig.MaxBytes+1))
	if failed(w, r, err) {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, p)
}

// applyTeamConfiguration makes the changes of a checked plan: the same file, with the plan's digest in If-Match.
func (a *api) applyTeamConfiguration(w http.ResponseWriter, r *http.Request) {
	out, err := a.TeamConfig.Apply(r.Context(), a.actor(r), r.PathValue("team"), http.MaxBytesReader(w, r.Body, teamconfig.MaxBytes+1), r.Header.Get("If-Match"))
	if failed(w, r, err) {
		return
	}
	// The response can hold new webhooks' signing secrets, shown once.
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, out)
}
