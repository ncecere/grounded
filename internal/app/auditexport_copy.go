package app

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/auditexport"
	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/config"
)

// exportCopyPeriodic copies the signed daily exports to the operator's bucket, when one is configured.
func exportCopyPeriodic(copier *auditexport.Copier) []*river.PeriodicJob {
	if copier == nil {
		return nil
	}
	return []*river.PeriodicJob{auditexport.CopyPeriodic()}
}

// newExportCopier connects the external copy bucket (docs/signed-daily-audit-export.md, "External copy"); nil when none is set.
func newExportCopier(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, store blob.Store, log *slog.Logger) (*auditexport.Copier, error) {
	c := cfg.AuditExportCopy
	if c.Bucket == "" {
		return nil, nil
	}
	dest, err := blob.NewS3(ctx, blob.S3Config{Endpoint: c.Endpoint, Region: c.Region, Bucket: c.Bucket, AccessKey: c.AccessKey, SecretKey: c.SecretKey,
		ForcePathStyle: c.ForcePathStyle, CAFile: c.CAFile, Prefix: c.Prefix})
	if err != nil {
		return nil, fmt.Errorf("audit export copy bucket: %w", err)
	}
	return &auditexport.Copier{Pool: pool, Store: store, Dest: dest, Log: log}, nil
}
