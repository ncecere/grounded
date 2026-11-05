package httpapi

import (
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/auditstream"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Audit streaming to a SIEM (docs/specs/audit-streaming/DESIGN.md): signed-in platform admins write, auditors read.
func (a *api) auditStreamRoutes() []route {
	return []route{
		{"GET", "/v1/admin/audit-stream", a.admin(a.adminGetAuditStream)},
		{"PUT", "/v1/admin/audit-stream/settings", a.admin(a.adminPutAuditStreamSettings)},
		{"POST", "/v1/admin/audit-stream/destinations", a.admin(a.adminCreateAuditStreamDestination)},
		{"PUT", "/v1/admin/audit-stream/destinations/{destinationId}", a.admin(a.adminPutAuditStreamDestination)},
		{"DELETE", "/v1/admin/audit-stream/destinations/{destinationId}", a.admin(a.adminDeleteAuditStreamDestination)},
		{"PUT", "/v1/admin/audit-stream/destinations/{destinationId}/enabled", a.admin(a.adminSetAuditStreamDestinationEnabled)},
		{"POST", "/v1/admin/audit-stream/destinations/{destinationId}/test", a.admin(a.adminTestAuditStreamDestination)},
	}
}

func (a *api) toAPIAuditStreamDestination(r *http.Request, d auditstream.Destination) apitypes.AuditStreamDestination {
	lag, _ := a.AuditStream.Lag(r.Context(), d.ID)
	return apitypes.AuditStreamDestination{
		Id: d.ID, Name: d.Name, Kind: apitypes.AuditStreamDestinationKind(d.Kind), Format: apitypes.AuditStreamDestinationFormat(d.Format),
		Address: d.Address, HasAuthHeader: d.HasAuth, CaPem: d.CaPem, Enabled: d.Enabled, Started: d.Started,
		SentTotal: d.SentTotal, LastSentAt: d.LastSentAt, LastErrorClass: d.LastErrorClass, FailingSince: d.FailingSince,
		NextAttemptAt: d.NextAttemptAt, LagSeconds: int64(lag / time.Second), Revision: d.Revision, CreatedAt: d.CreatedAt,
	}
}

func (a *api) adminGetAuditStream(w http.ResponseWriter, r *http.Request) {
	st, err := a.AuditStream.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	list, err := a.AuditStream.List(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.AuditStream{Settings: apitypes.AuditStreamSettings{Enabled: st.Enabled, Revision: st.Revision},
		Destinations: make([]apitypes.AuditStreamDestination, len(list))}
	for i, d := range list {
		out.Destinations[i] = a.toAPIAuditStreamDestination(r, d)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminPutAuditStreamSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.AuditStreamSettingsInput](w, r)
	if !ok {
		return
	}
	st, err := a.AuditStream.SetEnabled(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, apitypes.AuditStreamSettings{Enabled: st.Enabled, Revision: st.Revision})
}

func streamInput(in apitypes.AuditStreamDestinationInput) auditstream.Input {
	return auditstream.Input{Name: in.Name, Kind: string(in.Kind), Format: string(in.Format), Address: in.Address, CAPEM: in.CaPem, AuthHeader: in.AuthHeader}
}

// writeDestination answers with a destination as it is now.
func (a *api) writeDestination(w http.ResponseWriter, r *http.Request, status int, id uuid.UUID) {
	list, err := a.AuditStream.List(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	for _, d := range list {
		if d.ID == id {
			writeRevised(w, status, d.Revision, a.toAPIAuditStreamDestination(r, d))
			return
		}
	}
	a.fail(w, r, apperr.NotFound("not_found", "Streaming destination not found"))
}

func (a *api) adminCreateAuditStreamDestination(w http.ResponseWriter, r *http.Request) {
	var in apitypes.AuditStreamDestinationInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	id, err := a.AuditStream.Create(r.Context(), a.actor(r), streamInput(in))
	if failed(w, r, err) {
		return
	}
	a.writeDestination(w, r, http.StatusCreated, id)
}

func (a *api) adminPutAuditStreamDestination(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "destinationId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.AuditStreamDestinationInput](w, r)
	if !ok {
		return
	}
	if failed(w, r, a.AuditStream.Update(r.Context(), a.actor(r), id, streamInput(in), rev)) {
		return
	}
	a.writeDestination(w, r, http.StatusOK, id)
}

func (a *api) adminDeleteAuditStreamDestination(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "destinationId")
	if !ok {
		return
	}
	rev, ok := ifMatch(w, r)
	if !ok {
		return
	}
	writeOK(w, r, a.AuditStream.Delete(r.Context(), a.actor(r), id, rev))
}

func (a *api) adminSetAuditStreamDestinationEnabled(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "destinationId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.AdminSetAuditStreamDestinationEnabledJSONRequestBody](w, r)
	if !ok {
		return
	}
	if failed(w, r, a.AuditStream.SetDestinationEnabled(r.Context(), a.actor(r), id, in.Enabled, rev)) {
		return
	}
	a.writeDestination(w, r, http.StatusOK, id)
}

func (a *api) adminTestAuditStreamDestination(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "destinationId")
	if !ok {
		return
	}
	class, err := a.AuditStream.Test(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.AuditStreamTestResult{Delivered: class == "", ErrorClass: class})
}
