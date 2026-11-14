package auditexport

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// The reads behind Admin -> Audit exports. The routes that call them are
// for platform admins and auditors only (docs/specs/audit-export).

// Settings is the export setting (coverage, enabled, revision).
func (s *Service) Settings(ctx context.Context) (dbgen.AuditExportSetting, error) {
	return dbgen.New(s.Pool).GetAuditExportSettings(ctx)
}

// Requests lists the export requests.
func (s *Service) Requests(ctx context.Context) ([]dbgen.AuditExportRequest, error) {
	return dbgen.New(s.Pool).ListAuditExportRequests(ctx)
}

// GetRequest is one export request (pgx.ErrNoRows when there is none).
func (s *Service) GetRequest(ctx context.Context, id uuid.UUID) (dbgen.AuditExportRequest, error) {
	return dbgen.New(s.Pool).GetAuditExportRequest(ctx, id)
}

// Export is a completed export's record: its signed envelope and copy state.
func (s *Service) Export(ctx context.Context, id uuid.UUID) (dbgen.AuditExport, error) {
	return dbgen.New(s.Pool).GetAuditExport(ctx, id)
}
