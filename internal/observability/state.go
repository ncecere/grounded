package observability

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/prometheus/client_golang/prometheus"
)

// StateDB is what the state collector needs from Postgres.
type StateDB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Bounds of the state collector's reads.
const (
	stateTTL     = 10 * time.Second // several scrapers within this share one read
	stateTimeout = 5 * time.Second
)

// StateCollector exposes install-wide state read from Postgres at scrape
// time: the River queue (jobs per kind and state, the oldest waiting and
// running job per kind), maintenance mode and open break-glass sessions.
// Every process that registers it reports the same values, so dashboards
// and alerts aggregate them with max(). The worker (and serve) processes
// register it; API processes do not, to keep scrapes off the database.
type StateCollector struct {
	db  StateDB
	log *slog.Logger

	mu   sync.Mutex
	at   time.Time
	snap stateSnapshot

	up, jobs, availableAge, runningAge  *prometheus.Desc
	maintenance, maintenanceStarted, bg *prometheus.Desc
}

type jobState struct {
	kind, state          string
	count                float64
	availableAge, runAge float64
}

type stateSnapshot struct {
	ok                 bool
	jobs               []jobState
	maintenance        bool
	maintenanceStarted *time.Time
	bgActive, bgPend   float64
}

// NewStateCollector reads from db (nil: the collector only describes its
// metrics).
func NewStateCollector(db StateDB, log *slog.Logger) *StateCollector {
	return &StateCollector{
		db: db, log: log,
		up: prometheus.NewDesc("grounded_state_up",
			"1 when the last read of the queue and platform state from Postgres succeeded.", nil, nil),
		jobs: prometheus.NewDesc("grounded_jobs",
			"River jobs by kind and state (available, running, retryable, scheduled, discarded).", []string{"kind", "state"}, nil),
		availableAge: prometheus.NewDesc("grounded_jobs_oldest_available_age_seconds",
			"How long the oldest job ready to run has waited for a worker, by kind.", []string{"kind"}, nil),
		runningAge: prometheus.NewDesc("grounded_jobs_oldest_running_age_seconds",
			"How long the longest-running job has been running, by kind.", []string{"kind"}, nil),
		maintenance: prometheus.NewDesc("grounded_maintenance_mode",
			"1 while maintenance mode is on.", nil, nil),
		maintenanceStarted: prometheus.NewDesc("grounded_maintenance_mode_started_timestamp_seconds",
			"When the current maintenance mode started (Unix time); absent while off.", nil, nil),
		bg: prometheus.NewDesc("grounded_breakglass_open_sessions",
			"Break-glass sessions open now, by status (active, pending).", []string{"status"}, nil),
	}
}

func (c *StateCollector) Describe(ch chan<- *prometheus.Desc) {
	for _, d := range []*prometheus.Desc{c.up, c.jobs, c.availableAge, c.runningAge, c.maintenance, c.maintenanceStarted, c.bg} {
		ch <- d
	}
}

func (c *StateCollector) Collect(ch chan<- prometheus.Metric) {
	if c.db == nil {
		return
	}
	s := c.snapshot()
	gauge := func(d *prometheus.Desc, v float64, labels ...string) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.GaugeValue, v, labels...)
	}
	if !s.ok {
		gauge(c.up, 0)
		return
	}
	gauge(c.up, 1)
	for _, j := range s.jobs {
		gauge(c.jobs, j.count, j.kind, j.state)
		switch j.state {
		case "available":
			gauge(c.availableAge, j.availableAge, j.kind)
		case "running":
			gauge(c.runningAge, j.runAge, j.kind)
		}
	}
	gauge(c.maintenance, b2f(s.maintenance))
	if s.maintenance && s.maintenanceStarted != nil {
		gauge(c.maintenanceStarted, float64(s.maintenanceStarted.Unix()))
	}
	gauge(c.bg, s.bgActive, "active")
	gauge(c.bg, s.bgPend, "pending")
}

// snapshot returns the cached state, reading it again when older than
// stateTTL.
func (c *StateCollector) snapshot() stateSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Since(c.at) < stateTTL {
		return c.snap
	}
	ctx, cancel := context.WithTimeout(context.Background(), stateTimeout)
	defer cancel()
	s, err := readState(ctx, c.db)
	if err != nil && c.log != nil {
		c.log.Warn("metrics: read queue and platform state", "err", err)
	}
	s.ok = err == nil
	c.snap, c.at = s, time.Now()
	return s
}

const jobStateSQL = `
SELECT kind, state::text, count(*)::float8,
       COALESCE(GREATEST(EXTRACT(EPOCH FROM now() - min(scheduled_at)), 0), 0)::float8,
       COALESCE(GREATEST(EXTRACT(EPOCH FROM now() - min(attempted_at)), 0), 0)::float8
FROM river_job
WHERE state IN ('available', 'running', 'retryable', 'scheduled', 'discarded')
GROUP BY kind, state
ORDER BY kind, state`

const platformStateSQL = `
SELECT m.enabled, m.started_at,
       (SELECT count(*) FROM break_glass_sessions WHERE status = 'active' AND expires_at > now())::float8,
       (SELECT count(*) FROM break_glass_sessions WHERE status = 'pending')::float8
FROM maintenance_mode m`

func readState(ctx context.Context, db StateDB) (stateSnapshot, error) {
	var s stateSnapshot
	rows, err := db.Query(ctx, jobStateSQL)
	if err != nil {
		return s, err
	}
	s.jobs, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (jobState, error) {
		var j jobState
		err := r.Scan(&j.kind, &j.state, &j.count, &j.availableAge, &j.runAge)
		return j, err
	})
	if err != nil {
		return s, err
	}
	err = db.QueryRow(ctx, platformStateSQL).Scan(&s.maintenance, &s.maintenanceStarted, &s.bgActive, &s.bgPend)
	return s, err
}

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
