package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/keyrotation"
	"github.com/ncecere/grounded/internal/secrets"
)

// keyRotationRoutes: key rotation status for the admin Overview (E10).
func (a *api) keyRotationRoutes() []route {
	return []route{
		{"GET", "/v1/admin/key-rotation", a.admin(a.adminGetKeyRotation)},
	}
}

// adminGetKeyRotation lists the usable API keys and widget keys that are not
// on the current API key pepper yet (docs/operations/rotate-keys.md): ids,
// names, teams and last use only.
func (a *api) adminGetKeyRotation(w http.ResponseWriter, r *http.Request) {
	peppers, err := secrets.ParsePeppers(a.Config.APIKeyPepper, a.Config.APIKeyPepperPrevious)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	keys, err := keyrotation.PepperReport(r.Context(), a.q, peppers)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := apitypes.KeyRotationStatus{PreviousPepperConfigured: len(peppers.Previous) > 0, Keys: make([]apitypes.PepperKey, len(keys))}
	for i, k := range keys {
		pk := apitypes.PepperKey{
			Kind: apitypes.PepperKeyKind(k.Kind), Id: k.ID, Name: k.Name, TeamSlug: k.TeamSlug, TeamName: k.TeamName,
			LastUsedAt: k.LastUsedAt, CreatedAt: k.CreatedAt, State: apitypes.PepperKeyState(k.State),
		}
		if k.AgentName != "" {
			pk.AgentName = &k.AgentName
		}
		out.Keys[i] = pk
	}
	httpx.JSON(w, http.StatusOK, out)
}
