// Package doctor implements `grounded doctor` (docs/phase5-deploy.md §5 E7):
// the production safety checks and warnings, then connectivity to every
// dependency (Postgres, Valkey, object storage, the OIDC issuer and each
// enabled model connection), with timings. It changes nothing except a
// probe object in object storage, which it deletes again.
package doctor

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/ncecere/grounded/internal/buildinfo"
	"github.com/ncecere/grounded/internal/config"
	"github.com/ncecere/grounded/internal/gateway"
)

// Status of one check.
type Status string

const (
	OK   Status = "ok"
	Warn Status = "warn" // works, but deserves attention
	Info Status = "info" // worth knowing
	Fail Status = "fail" // broken: doctor exits non-zero
	Skip Status = "skip" // not applicable or not configured
)

// Timings are an HTTP check's phases in milliseconds (the admin test's
// RequestTimings).
type Timings struct {
	DNSMs       float64 `json:"dnsMs"`
	ConnectMs   float64 `json:"connectMs"`
	TLSMs       float64 `json:"tlsMs"`
	FirstByteMs float64 `json:"firstByteMs"`
	Reused      bool    `json:"reused"`
}

// Check is one line of the report.
type Check struct {
	Group      string   `json:"group"` // configuration, safety, warnings, postgres, valkey, storage, oidc, models, probe
	Name       string   `json:"name"`
	Status     Status   `json:"status"`
	Detail     string   `json:"detail"`
	Fix        string   `json:"fix,omitempty"`
	DurationMs float64  `json:"durationMs,omitempty"`
	Timings    *Timings `json:"timings,omitempty"`
}

// Report is the outcome of a run. OK is false when any check failed.
type Report struct {
	Version string  `json:"version"`
	Mode    string  `json:"mode"`
	OK      bool    `json:"ok"`
	Checks  []Check `json:"checks"`
}

// Options select what a run checks.
type Options struct {
	// Mode is the process mode whose configuration is validated: api
	// (default), worker, serve or migrate.
	Mode string
	// Timeout bounds each check (default 10s).
	Timeout time.Duration
	// Probes are extra URLs to time with a GET (any HTTP answer counts as
	// reachable), for example a model gateway or a site to crawl.
	Probes []string
}

// runner collects checks.
type runner struct {
	cfg    config.Config
	opts   Options
	checks []Check
}

func (r *runner) add(c Check) { r.checks = append(r.checks, c) }

// ctx bounds one check.
func (r *runner) ctx(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, r.opts.Timeout)
}

// Run performs every check.
func Run(ctx context.Context, cfg config.Config, opts Options) Report {
	if opts.Mode == "" {
		opts.Mode = "api"
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 10 * time.Second
	}
	r := &runner{cfg: cfg, opts: opts}
	r.configuration()
	pool := r.postgres(ctx)
	if pool != nil {
		defer pool.Close()
	}
	r.warnings(ctx, pool)
	r.valkey(ctx)
	r.storage(ctx)
	r.oidc(ctx)
	r.models(ctx, pool)
	r.probes(ctx)
	return r.report()
}

// ConfigLoadFailed is the report when the configuration cannot even be
// loaded (an invalid value or an unreadable *_FILE).
func ConfigLoadFailed(mode string, err error) Report {
	r := &runner{opts: Options{Mode: mode}}
	for _, e := range splitErrors(err) {
		r.add(Check{Group: "configuration", Name: "load", Status: Fail, Detail: e.Error()})
	}
	return r.report()
}

func (r *runner) report() Report {
	rep := Report{Version: buildinfo.String(), Mode: r.opts.Mode, OK: true, Checks: r.checks}
	for _, c := range r.checks {
		if c.Status == Fail {
			rep.OK = false
		}
	}
	return rep
}

// splitErrors lists the errors joined in err (errors.Join), one per check.
func splitErrors(err error) []error {
	if j, ok := err.(interface{ Unwrap() []error }); ok {
		var out []error
		for _, e := range j.Unwrap() {
			out = append(out, splitErrors(e)...)
		}
		return out
	}
	if err == nil {
		return nil
	}
	return []error{err}
}

func millis(d time.Duration) float64 {
	return float64(d.Round(10*time.Microsecond)) / float64(time.Millisecond)
}

func toTimings(t gateway.Timings) *Timings {
	if t == (gateway.Timings{}) {
		return nil
	}
	return &Timings{DNSMs: millis(t.DNS), ConnectMs: millis(t.Connect), TLSMs: millis(t.TLS), FirstByteMs: millis(t.FirstByte), Reused: t.Reused}
}

// errMessage is a gateway error's admin message, or err's text.
func errMessage(err error) string {
	var ge *gateway.Error
	if errors.As(err, &ge) {
		if ge.Status > 0 {
			return ge.Message + " (HTTP " + strconv.Itoa(ge.Status) + ")"
		}
		return ge.Message
	}
	return err.Error()
}
