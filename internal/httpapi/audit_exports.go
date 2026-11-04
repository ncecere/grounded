package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/auditexport"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store/dbgen"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func (a *api) auditExportRoutes() []route {
	return []route{
		{"GET", "/v1/admin/audit-export-settings", a.admin(a.getAuditExportSettings)},
		{"PUT", "/v1/admin/audit-export-settings", a.admin(a.putAuditExportSettings)},
		{"GET", "/v1/admin/audit-exports", a.admin(a.listAuditExports)},
		{"POST", "/v1/admin/audit-exports", a.admin(a.requestAuditExport)},
		{"GET", "/v1/admin/audit-exports/{exportId}", a.admin(a.getAuditExport)},
		{"POST", "/v1/admin/audit-exports/{exportId}/retry", a.admin(a.retryAuditExport)},
		{"GET", "/v1/admin/audit-exports/{exportId}/download", a.admin(a.downloadAuditExport)},
	}
}
func (a *api) exportSettings(row dbgen.AuditExportSetting) apitypes.AuditExportSettings {
	key := ""
	if a.AuditExports != nil {
		key = a.AuditExports.KeyID()
	}
	return apitypes.AuditExportSettings{CoverageStart: openapi_types.Date{Time: row.CoverageStart.Time}, Destination: "builtin", Enabled: row.Enabled, Revision: row.Revision, KeyReady: key != "", KeyId: key}
}
func (a *api) getAuditExportSettings(w http.ResponseWriter, r *http.Request) {
	row, err := a.q.GetAuditExportSettings(r.Context())
	if failed(w, r, err) {
		return
	}
	writeRevised(w, 200, row.Revision, a.exportSettings(row))
}
func (a *api) putAuditExportSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.AuditExportSettingsInput](w, r)
	if !ok {
		return
	}
	if in.Destination != "builtin" {
		failed(w, r, apperr.Invalid("unsupported_destination", "Only built-in private storage is supported"))
		return
	}
	if a.AuditExports == nil {
		failed(w, r, apperr.New(503, "audit_export_unavailable", "Signed exports are unavailable"))
		return
	}
	out, err := a.AuditExports.Configure(r.Context(), rev, in.Enabled, in.CoverageStart.Time.UTC(), a.actor(r).Audit("", "", ""))
	if failed(w, r, exportError(err)) {
		return
	}
	writeRevised(w, 200, out.Revision, a.exportSettings(out))
}
func exportError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return apperr.NotFound("audit_export_not_found", "Export not found")
	}
	if errors.Is(err, auditexport.ErrRange) {
		return apperr.Conflict("audit_export_range", "Use the next closed UTC day in the approved coverage range")
	}
	if errors.Is(err, auditexport.ErrStorage) || errors.Is(err, auditexport.ErrInvalid) {
		return apperr.New(503, "audit_export_unavailable", "Export artifact is unavailable")
	}
	return err
}
func (a *api) exportStatus(ctx context.Context, row dbgen.AuditExportRequest) (apitypes.AuditExportStatus, error) {
	out := apitypes.AuditExportStatus{Id: row.ID, Day: openapi_types.Date{Time: row.Day.Time}, Revision: row.Revision, State: apitypes.AuditExportStatusState(row.State), FailureCode: row.FailureCode}
	if row.State == "completed" && row.ExportID.Valid {
		e, err := a.q.GetAuditExport(ctx, row.ExportID.UUID)
		if err != nil {
			return out, err
		}
		var envelope map[string]interface{}
		if err = json.Unmarshal(e.Envelope, &envelope); err != nil {
			return out, auditexport.ErrInvalid
		}
		out.Envelope = &envelope
	}
	return out, nil
}
func (a *api) listAuditExports(w http.ResponseWriter, r *http.Request) {
	rows, err := a.q.ListAuditExportRequests(r.Context())
	if failed(w, r, err) {
		return
	}
	out := make([]apitypes.AuditExportStatus, 0, len(rows))
	for _, row := range rows {
		item, err := a.exportStatus(r.Context(), row)
		if failed(w, r, exportError(err)) {
			return
		}
		out = append(out, item)
	}
	httpx.JSON(w, 200, out)
}
func exportID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("exportId"))
	if err != nil {
		failed(w, r, apperr.Invalid("invalid_id", "Invalid export ID"))
		return uuid.Nil, false
	}
	return id, true
}
func (a *api) getAuditExport(w http.ResponseWriter, r *http.Request) {
	id, ok := exportID(w, r)
	if !ok {
		return
	}
	row, err := a.q.GetAuditExportRequest(r.Context(), id)
	if failed(w, r, exportError(err)) {
		return
	}
	out, err := a.exportStatus(r.Context(), row)
	if failed(w, r, exportError(err)) {
		return
	}
	writeRevised(w, 200, row.Revision, out)
}
func (a *api) requestAuditExport(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.AuditExportRequest](w, r)
	if !ok {
		return
	}
	a.enqueueExport(w, r, rev, in.Day.Time.UTC(), uuid.Nil)
}
func (a *api) retryAuditExport(w http.ResponseWriter, r *http.Request) {
	id, ok := exportID(w, r)
	if !ok {
		return
	}
	rev, ok := ifMatch(w, r)
	if !ok {
		return
	}
	a.enqueueExport(w, r, rev, time.Time{}, id)
}
func (a *api) enqueueExport(w http.ResponseWriter, r *http.Request, rev int64, day time.Time, retry uuid.UUID) {
	if a.AuditExports == nil {
		failed(w, r, apperr.New(503, "audit_export_unavailable", "Signed exports are unavailable"))
		return
	}
	row, err := a.AuditExports.Request(r.Context(), rev, day, retry, a.actor(r).Audit("", "", ""))
	if failed(w, r, exportError(err)) {
		return
	}
	out, err := a.exportStatus(r.Context(), row)
	if failed(w, r, exportError(err)) {
		return
	}
	writeRevised(w, 200, row.Revision, out)
}
func (a *api) downloadAuditExport(w http.ResponseWriter, r *http.Request) {
	id, ok := exportID(w, r)
	if !ok {
		return
	}
	row, err := a.q.GetAuditExportRequest(r.Context(), id)
	if failed(w, r, exportError(err)) {
		return
	}
	if row.State != "completed" || !row.ExportID.Valid {
		failed(w, r, apperr.Conflict("not_completed", "Export is not completed"))
		return
	}
	if a.AuditExports == nil {
		failed(w, r, apperr.New(503, "audit_export_unavailable", "Signed exports are unavailable"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	payload, err := a.AuditExports.Download(ctx, row.ExportID.UUID)
	if failed(w, r, exportError(err)) {
		return
	}
	defer payload.Close()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Content-Disposition", `attachment; filename="audit-export.jsonl"`)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(30 * time.Second))
	_, _ = io.Copy(w, payload)
}
