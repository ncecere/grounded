package app

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/preflight"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// logPreflight logs the production-readiness warnings at startup
// (docs/phase5-deploy.md §5 E7). Failing to compute them is logged, never
// fatal: they are advice, unlike config.SafetyErrors.
func logPreflight(ctx context.Context, cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) {
	findings, err := preflight.Check(ctx, cfg, dbgen.New(pool))
	if err != nil {
		log.WarnContext(ctx, "preflight checks failed", "err", err)
		return
	}
	preflight.Log(ctx, log, findings)
}
