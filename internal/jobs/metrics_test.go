package jobs_test

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/jobs"
	"github.com/ncecere/grounded/internal/observability"
)

func TestJobOutcome(t *testing.T) {
	cases := map[string]error{
		jobs.OutcomeOK:        nil,
		jobs.OutcomeError:     errors.New("boom"),
		jobs.OutcomeSnoozed:   river.JobSnooze(time.Minute),
		jobs.OutcomeCancelled: river.JobCancel(errors.New("give up")),
	}
	for want, err := range cases {
		if got := jobs.JobOutcome(err); got != want {
			t.Errorf("JobOutcome(%v) = %s, want %s", err, got, want)
		}
	}
}

func TestMetricsMiddlewareCountsOutcomes(t *testing.T) {
	mw := jobs.MetricsMiddleware()
	work := func(kind string, fn func(context.Context) error) {
		defer func() { _ = recover() }()
		_ = mw.Work(context.Background(), &rivertype.JobRow{Kind: kind}, fn)
	}
	work("test.metrics", func(context.Context) error { return nil })
	work("test.metrics", func(context.Context) error { return errors.New("boom") })
	work("test.metrics", func(context.Context) error { panic("boom") })

	rec := httptest.NewRecorder()
	observability.NewMetrics().Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	for _, want := range []string{
		`grounded_jobs_worked_total{kind="test.metrics",outcome="ok"} 1`,
		`grounded_jobs_worked_total{kind="test.metrics",outcome="error"} 1`,
		`grounded_jobs_worked_total{kind="test.metrics",outcome="panic"} 1`,
		`grounded_job_duration_seconds_count{kind="test.metrics"} 3`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics lack %s", want)
		}
	}
}
