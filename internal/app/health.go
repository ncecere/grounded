package app

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/healthcheck"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// registerHealth adds the health job (stored health, docs/operations/health.md):
// its worker always (a job queued before HEALTH_CHECK_INTERVAL turned it
// off still completes), its schedule while the interval isn't 0.
func registerHealth(w *river.Workers, cfg config.Config, pool *pgxpool.Pool, s *Services, log *slog.Logger) {
	healthcheck.Register(w, &healthcheck.Runner{
		Store: s.HealthChecks, Log: log,
		Checkers: []healthcheck.Checker{&healthcheck.ConnectionChecker{Queries: dbgen.New(pool), Probe: s.Catalog.ProbeConnection}},
	}, cfg.HealthCheckInterval)
}

// healthPeriodic is the health job's schedule (none while the interval is 0).
func healthPeriodic(cfg config.Config) []*river.PeriodicJob {
	if p := healthcheck.Periodic(cfg.HealthCheckInterval); p != nil {
		return []*river.PeriodicJob{p}
	}
	return nil
}
