package retention

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

// Metrics are the retention job's Prometheus metrics (worker processes).
// A nil *Metrics records nothing.
type Metrics struct {
	deleted     *prometheus.CounterVec
	held        *prometheus.GaugeVec
	errors      *prometheus.CounterVec
	lastSuccess *prometheus.GaugeVec
	duration    prometheus.Histogram
}

// NewMetrics creates the retention metrics; register Collectors().
func NewMetrics() *Metrics {
	return &Metrics{
		deleted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "grounded_retention_deleted_total",
			Help: "Rows (or stored-file prefixes) deleted by retention, by data kind.",
		}, []string{"kind"}),
		held: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "grounded_retention_held",
			Help: "Rows past their retention period kept by a legal hold, by data kind, at the last run.",
		}, []string{"kind"}),
		errors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "grounded_retention_errors_total",
			Help: "Retention runs of a data kind that failed.",
		}, []string{"kind"}),
		lastSuccess: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "grounded_retention_last_success_timestamp_seconds",
			Help: "When retention of a data kind last completed without error (Unix time).",
		}, []string{"kind"}),
		duration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "grounded_retention_run_duration_seconds",
			Help:    "Duration of retention runs.",
			Buckets: []float64{.1, .5, 1, 5, 15, 60, 300, 900},
		}),
	}
}

// Collectors returns the metrics to register.
func (m *Metrics) Collectors() []prometheus.Collector {
	return []prometheus.Collector{m.deleted, m.held, m.errors, m.lastSuccess, m.duration}
}

func (m *Metrics) observe(k Kind, res Result, at time.Time) {
	if m == nil {
		return
	}
	m.deleted.WithLabelValues(string(k)).Add(float64(res.Deleted))
	if res.Error != "" {
		m.errors.WithLabelValues(string(k)).Inc()
		return
	}
	m.held.WithLabelValues(string(k)).Set(float64(res.Held))
	m.lastSuccess.WithLabelValues(string(k)).Set(float64(at.Unix()))
}

func (m *Metrics) observeRun(d time.Duration) {
	if m != nil {
		m.duration.Observe(d.Seconds())
	}
}
