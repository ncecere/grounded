package jobs

import (
	"context"
	"errors"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/observability"
)

// Job outcomes (grounded_jobs_worked_total).
const (
	OutcomeOK        = "ok"
	OutcomeError     = "error"
	OutcomeSnoozed   = "snoozed"
	OutcomeCancelled = "cancelled"
	OutcomePanic     = "panic"
)

// metricsMiddleware records every worked job's outcome and run time by kind.
func metricsMiddleware() rivertype.WorkerMiddleware {
	return river.WorkerMiddlewareFunc(func(ctx context.Context, job *rivertype.JobRow, doInner func(context.Context) error) error {
		start := time.Now()
		result := OutcomePanic // unless doInner returns
		defer func() {
			observability.JobsWorked.WithLabelValues(job.Kind, result).Inc()
			observability.JobDuration.WithLabelValues(job.Kind).Observe(time.Since(start).Seconds())
		}()
		err := doInner(ctx)
		result = JobOutcome(err)
		return err
	})
}

// JobOutcome classifies a worker's result.
func JobOutcome(err error) string {
	var snooze *rivertype.JobSnoozeError
	var cancel *rivertype.JobCancelError
	switch {
	case err == nil:
		return OutcomeOK
	case errors.As(err, &snooze):
		return OutcomeSnoozed
	case errors.As(err, &cancel):
		return OutcomeCancelled
	default:
		return OutcomeError
	}
}
