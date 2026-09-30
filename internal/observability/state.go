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
// running job per kind), maintenance mode, open break-glass sessions and
// the stored health of enabled connections and models.
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
	healthFailing, healthFailingFor     *prometheus.Desc
}

type jobState struct {
	kind, state          string
	count                float64
	availableAge, runAge float64
}

// healthState is one row of healthSQL: a kind's count of failing subjects
// (name empty), or how long one failing subject has been failing.
type healthState struct {
	count      bool
	kind, name string
	value      float64
}

type stateSnapshot struct {
	ok                 bool
	jobs               []jobState
	maintenance        bool
	maintenanceStarted *time.Time
	bgActive, bgPend   float64
	health             []healthState
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
		healthFailing: prometheus.NewDesc("grounded_health_failing",
			"Enabled subjects (connections, models, MCP servers) whose latest stored health check failed, by kind.", []string{"kind"}, nil),
		healthFailingFor: prometheus.NewDesc("grounded_health_failing_seconds",
			"How long each failing enabled subject has been failing, by kind and name (absent while healthy).", []string{"kind", "name"}, nil),
	}
}

func (c *StateCollector) Describe(ch chan<- *prometheus.Desc) {
	for _, d := range []*prometheus.Desc{c.up, c.jobs, c.availableAge, c.runningAge, c.maintenance, c.maintenanceStarted, c.bg, c.healthFailing, c.healthFailingFor} {
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
	for _, h := range s.health {
		if h.count {
			gauge(c.healthFailing, h.value, h.kind)
		} else {
			gauge(c.healthFailingFor, h.value, h.kind, h.name)
		}
	}
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

// healthSQL reads the stored health of enabled subjects
// (docs/operations/health.md): per kind with an enabled subject, how many
// failed their latest check; per failing subject (by kind and name, so two
// models with one display name are one series), how long it has failed.
const healthSQL = `
WITH latest AS (
    SELECT s.subject_kind, s.name, h.status, h.status_since
    FROM health_subjects s
    LEFT JOIN LATERAL (
        SELECT c.status, c.status_since FROM health_checks c
        WHERE c.subject_kind = s.subject_kind AND c.subject_id = s.subject_id
        ORDER BY c.checked_at DESC, c.id DESC
        LIMIT 1
    ) h ON true
    WHERE s.enabled
)
SELECT true, subject_kind, ''::text, (count(*) FILTER (WHERE status = 'failing'))::float8
FROM latest GROUP BY subject_kind
UNION ALL
SELECT false, subject_kind, name, max(GREATEST(EXTRACT(EPOCH FROM now() - status_since), 0))::float8
FROM latest WHERE status = 'failing' GROUP BY subject_kind, name
ORDER BY 1 DESC, 2, 3`

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
	if err != nil {
		return s, err
	}
	rows, err = db.Query(ctx, healthSQL)
	if err != nil {
		return s, err
	}
	s.health, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (healthState, error) {
		var h healthState
		err := r.Scan(&h.count, &h.kind, &h.name, &h.value)
		return h, err
	})
	return s, err
}

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
