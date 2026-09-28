// Package observability configures structured logging and Prometheus metrics.
package observability

import (
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// NewLogger returns a slog logger writing JSON (for Loki) or text.
func NewLogger(w io.Writer, level, format string) *slog.Logger {
	var lvl slog.Level
	_ = lvl.UnmarshalText([]byte(level))
	opts := &slog.HandlerOptions{Level: lvl}
	if format == "text" {
		return slog.New(slog.NewTextHandler(w, opts))
	}
	return slog.New(slog.NewJSONHandler(w, opts))
}

// Metrics owns the process registry and the metrics every mode needs: HTTP
// metrics (every mode serves HTTP), rate-limit backend errors and the
// package-level application metrics (metrics.go).
type Metrics struct {
	registry        *prometheus.Registry
	collectors      []prometheus.Collector
	requests        *prometheus.CounterVec
	requestDuration *prometheus.HistogramVec
	inFlight        prometheus.Gauge
	RateLimitErrors prometheus.Counter
}

func NewMetrics() *Metrics {
	r := prometheus.NewRegistry()
	r.MustRegister(collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	m := &Metrics{
		registry: r,
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "grounded_http_requests_total",
			Help: "HTTP requests by route group, method, route pattern and status code.",
		}, []string{"group", "method", "route", "status"}),
		requestDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "grounded_http_request_duration_seconds",
			Help:    "HTTP request latency by route group, method and route pattern.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30, 60},
		}, []string{"group", "method", "route"}),
		inFlight: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "grounded_http_requests_in_flight",
			Help: "HTTP requests currently being served.",
		}),
		RateLimitErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "grounded_ratelimit_backend_errors_total",
			Help: "Rate-limit checks that failed open because Valkey was unavailable.",
		}),
	}
	m.Register(m.requests, m.requestDuration, m.inFlight, m.RateLimitErrors)
	m.Register(appCollectors()...)
	return m
}

// Register adds other packages' collectors (for example the retention
// job's) to the process registry.
func (m *Metrics) Register(cs ...prometheus.Collector) {
	m.registry.MustRegister(cs...)
	m.collectors = append(m.collectors, cs...)
}

var fqName = regexp.MustCompile(`fqName: "([^"]+)"`)

// Names lists the metric families the registered application collectors
// can expose (the Go runtime and process collectors aside), whether or not
// they have been recorded yet. The dashboard and alert checks use it.
func (m *Metrics) Names() []string {
	ch := make(chan *prometheus.Desc)
	go func() {
		for _, c := range m.collectors {
			c.Describe(ch)
		}
		close(ch)
	}()
	seen := map[string]bool{}
	for d := range ch {
		if s := fqName.FindStringSubmatch(d.String()); s != nil {
			seen[s[1]] = true
		}
	}
	names := make([]string, 0, len(seen))
	for n := range seen {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{Registry: m.registry})
}

// ObserveHTTP records one completed request. route is the matched ServeMux
// pattern (never the raw path) so label cardinality stays bounded.
func (m *Metrics) ObserveHTTP(method, route string, status int, d time.Duration) {
	if route == "" {
		route = "unmatched"
	}
	group := RouteGroup(route)
	m.requests.WithLabelValues(group, method, route, strconv.Itoa(status)).Inc()
	m.requestDuration.WithLabelValues(group, method, route).Observe(d.Seconds())
}

// Route groups (the group label of the HTTP metrics).
const (
	GroupOps       = "ops"       // health checks and metrics
	GroupChat      = "chat"      // streamed answers (long-lived; outside the latency SLO)
	GroupPublic    = "public"    // public agents and the widget
	GroupOpenAI    = "openai"    // the OpenAI-compatible API (except its chat)
	GroupAdmin     = "admin"     // platform administration
	GroupAuth      = "auth"      // sign-in and the caller's identity
	GroupAPI       = "api"       // the rest of /v1
	GroupUI        = "ui"        // the web app and its assets
	GroupUnmatched = "unmatched" // no route
)

// RouteGroup maps a ServeMux pattern ("METHOD /path") to its route group.
func RouteGroup(pattern string) string {
	method, path, ok := strings.Cut(pattern, " ")
	if !ok {
		path = pattern
	}
	switch {
	case pattern == "" || pattern == "unmatched":
		return GroupUnmatched
	case path == "/healthz" || path == "/readyz" || path == "/metrics":
		return GroupOps
	case method == http.MethodPost && isChatPath(path):
		return GroupChat
	}
	for _, g := range pathGroups {
		if g.match(path) {
			return g.group
		}
	}
	return GroupUI
}

// isChatPath reports whether a POST route streams an answer.
func isChatPath(path string) bool {
	return strings.HasSuffix(path, "/chat") || path == "/v1/chat/completions" ||
		path == "/v1/teams/{team}/agents/{agentId}/test"
}

// pathGroups are tried in order after ops and chat.
var pathGroups = []struct {
	group string
	match func(path string) bool
}{
	{GroupPublic, func(p string) bool {
		return strings.HasPrefix(p, "/v1/public/") || p == "/widget.js" || strings.HasPrefix(p, "/embed/")
	}},
	{GroupOpenAI, func(p string) bool { return p == "/v1/models" }},
	{GroupAdmin, func(p string) bool { return strings.HasPrefix(p, "/v1/admin/") }},
	{GroupAuth, func(p string) bool {
		return strings.HasPrefix(p, "/auth/") || strings.HasPrefix(p, "/v1/auth/") || p == "/v1/me" || strings.HasPrefix(p, "/v1/me/")
	}},
	{GroupAPI, func(p string) bool { return strings.HasPrefix(p, "/v1/") }},
}

func (m *Metrics) InFlight() prometheus.Gauge { return m.inFlight }
