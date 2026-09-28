package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/platform"
)

// Maintenance mode (docs/phase5-deploy.md §5 P5): its status for every
// signed-in caller (the shell's banner, API clients) and the admin switch.

// maintenanceRoutes: the status and the admin setting.
func (a *api) maintenanceRoutes() []route {
	return []route{
		{"GET", "/v1/maintenance", a.either(a.getMaintenance)},
		{"GET", "/v1/admin/settings/maintenance", a.admin(a.adminGetMaintenance)},
		{"PUT", "/v1/admin/settings/maintenance", a.admin(a.adminPutMaintenance)},
	}
}

func (a *api) getMaintenance(w http.ResponseWriter, r *http.Request) {
	st, err := a.Platform.Maintenance(r.Context())
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIMaintenanceStatus(st))
}

func (a *api) adminGetMaintenance(w http.ResponseWriter, r *http.Request) {
	st, err := a.Platform.MaintenanceAdmin(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIMaintenanceSettings(st))
}

func (a *api) adminPutMaintenance(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.MaintenanceUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.Platform.SetMaintenance(r.Context(), a.actor(r), platform.MaintenanceUpdate{
		Enabled: in.Enabled, Reason: deref(in.Reason, ""), PlannedEndAt: in.PlannedEndAt,
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIMaintenanceSettings(st))
}

func toAPIMaintenanceStatus(st platform.MaintenanceState) apitypes.MaintenanceStatus {
	return apitypes.MaintenanceStatus{Enabled: st.Enabled, Reason: st.Reason, PlannedEndAt: st.PlannedEndAt, StartedAt: st.StartedAt}
}

func toAPIMaintenanceSettings(st platform.MaintenanceState) apitypes.MaintenanceSettings {
	return apitypes.MaintenanceSettings{
		Enabled: st.Enabled, Reason: st.Reason, PlannedEndAt: st.PlannedEndAt, StartedAt: st.StartedAt,
		StartedBy: maintenancePerson(st.StartedBy), UpdatedBy: maintenancePerson(st.UpdatedBy),
		UpdatedAt: st.UpdatedAt, Revision: st.Revision,
	}
}

func maintenancePerson(p platform.Person) *apitypes.PersonRef {
	return personRef(uuid.NullUUID{UUID: p.ID, Valid: p.ID != uuid.Nil}, p.DisplayName, p.Email)
}
