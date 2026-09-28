package observability

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// PoolCollector exposes a pgx pool's statistics, read at scrape time.
type PoolCollector struct {
	stat func() *pgxpool.Stat

	acquired, idle, constructing, total, max *prometheus.Desc
	acquires, emptyAcquires, canceled        *prometheus.Desc
	acquireSeconds                           *prometheus.Desc
}

// NewPoolCollector reads the pool's Stat on every scrape (nil pool: the
// collector only describes its metrics).
func NewPoolCollector(pool *pgxpool.Pool) *PoolCollector {
	d := func(name, help string) *prometheus.Desc { return prometheus.NewDesc(name, help, nil, nil) }
	c := &PoolCollector{
		acquired:       d("grounded_db_pool_acquired_connections", "Postgres connections in use."),
		idle:           d("grounded_db_pool_idle_connections", "Idle Postgres connections in the pool."),
		constructing:   d("grounded_db_pool_constructing_connections", "Postgres connections being opened."),
		total:          d("grounded_db_pool_connections", "Postgres connections in the pool (in use, idle and opening)."),
		max:            d("grounded_db_pool_max_connections", "The pool's connection limit."),
		acquires:       d("grounded_db_pool_acquires_total", "Connections acquired from the pool."),
		emptyAcquires:  d("grounded_db_pool_empty_acquires_total", "Acquires that had to wait because no connection was idle."),
		canceled:       d("grounded_db_pool_canceled_acquires_total", "Acquires cancelled by their context while waiting."),
		acquireSeconds: d("grounded_db_pool_acquire_wait_seconds_total", "Total time spent acquiring connections."),
	}
	if pool != nil {
		c.stat = pool.Stat
	}
	return c
}

func (c *PoolCollector) Describe(ch chan<- *prometheus.Desc) {
	for _, d := range []*prometheus.Desc{c.acquired, c.idle, c.constructing, c.total, c.max, c.acquires, c.emptyAcquires, c.canceled, c.acquireSeconds} {
		ch <- d
	}
}

func (c *PoolCollector) Collect(ch chan<- prometheus.Metric) {
	if c.stat == nil {
		return
	}
	s := c.stat()
	gauge := func(d *prometheus.Desc, v float64) { ch <- prometheus.MustNewConstMetric(d, prometheus.GaugeValue, v) }
	counter := func(d *prometheus.Desc, v float64) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.CounterValue, v)
	}
	gauge(c.acquired, float64(s.AcquiredConns()))
	gauge(c.idle, float64(s.IdleConns()))
	gauge(c.constructing, float64(s.ConstructingConns()))
	gauge(c.total, float64(s.TotalConns()))
	gauge(c.max, float64(s.MaxConns()))
	counter(c.acquires, float64(s.AcquireCount()))
	counter(c.emptyAcquires, float64(s.EmptyAcquireCount()))
	counter(c.canceled, float64(s.CanceledAcquireCount()))
	counter(c.acquireSeconds, s.AcquireDuration().Seconds())
}
