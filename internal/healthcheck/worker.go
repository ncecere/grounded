package healthcheck

import (
	"context"
	"math/rand/v2"
	"time"

	"github.com/riverqueue/river"
)

// DefaultInterval is how often the health job re-tests enabled subjects
// (HEALTH_CHECK_INTERVAL; docs/operations/health.md).
const DefaultInterval = 15 * time.Minute

// maxJitter bounds the random delay of each scheduled run.
const maxJitter = 2 * time.Minute

// runTimeout bounds one run; probes are bounded too (probeTimeout).
const runTimeout = 10 * time.Minute

// Args is a scheduled run of the health job.
type Args struct{}

func (Args) Kind() string { return "health.check" }

// Worker runs the health job. Maintenance mode doesn't pause it: it pauses
// ingestion, and a probe changes nothing and costs no tokens.
type Worker struct {
	river.WorkerDefaults[Args]
	Runner *Runner
}

func (w *Worker) Timeout(*river.Job[Args]) time.Duration { return runTimeout }

// Work runs one pass. Probe failures are recorded, not returned: River
// doesn't retry a run; the next scheduled one re-tests.
func (w *Worker) Work(ctx context.Context, _ *river.Job[Args]) error {
	sum, err := w.Runner.Run(ctx)
	if err != nil {
		return err
	}
	if sum.Targets > 0 || sum.Pruned > 0 {
		w.Runner.log().InfoContext(ctx, "health checks", "targets", sum.Targets, "healthy", sum.Healthy, "failing", sum.Failing,
			"errors", sum.Errors, "pruned", sum.Pruned)
	}
	return nil
}

// Jitter is a random delay for a run scheduled every interval: up to a
// tenth of the interval, at most maxJitter, so installs and restarts don't
// probe their gateways in step. rnd returns a number in [0, n).
func Jitter(interval time.Duration, rnd func(n int64) int64) time.Duration {
	span := min(interval/10, maxJitter)
	if span <= 0 {
		return 0
	}
	return time.Duration(rnd(int64(span)))
}

// Periodic schedules the job every interval (nil when interval is 0: the
// scheduled re-test is off). Each run starts after a Jitter delay; one run
// per interval even when several workers schedule it.
func Periodic(interval time.Duration) *river.PeriodicJob {
	if interval <= 0 {
		return nil
	}
	return river.NewPeriodicJob(river.PeriodicInterval(interval), func() (river.JobArgs, *river.InsertOpts) {
		return Args{}, &river.InsertOpts{
			MaxAttempts: 1,
			ScheduledAt: time.Now().Add(Jitter(interval, rand.Int64N)),
			UniqueOpts:  river.UniqueOpts{ByPeriod: interval},
		}
	}, &river.PeriodicJobOpts{RunOnStart: true})
}

// Register adds the health job's worker.
func Register(w *river.Workers, r *Runner) {
	river.AddWorker(w, &Worker{Runner: r})
}
