package app

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/observability"
)

// registerProcessMetrics adds the process's build information and Postgres
// pool statistics, and in the modes that run jobs the install-wide queue and
// platform state read from Postgres at scrape time (one reader per worker is
// enough; API replicas would only repeat it).
func registerProcessMetrics(m *observability.Metrics, mode string, pool *pgxpool.Pool, log *slog.Logger) {
	observability.SetBuildInfo(mode)
	m.Register(observability.NewPoolCollector(pool))
	if mode == ModeServe || mode == ModeWorker {
		m.Register(observability.NewStateCollector(pool, log))
	}
}
