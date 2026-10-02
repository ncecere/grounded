package gaps

import (
	"context"
	"time"

	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/observability"
)

// Interval is how often the topics job runs (owner decision 3: hourly).
const Interval = time.Hour

// runTimeout bounds one run.
const runTimeout = 20 * time.Minute

// Args is a run of the topics job.
type Args struct{}

func (Args) Kind() string { return "gaps.topics" }

// InsertOpts: one attempt (the next hourly run catches up), one run per
// hour across workers.
func (Args) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 1, UniqueOpts: river.UniqueOpts{ByPeriod: Interval}}
}

// Worker runs the topics job. Maintenance mode doesn't pause it: it writes
// only the gap report's own tables and the usage ledger.
type Worker struct {
	river.WorkerDefaults[Args]
	Runner *Runner
}

// Timeout bounds a run.
func (w *Worker) Timeout(*river.Job[Args]) time.Duration { return runTimeout }

// Work runs one pass.
func (w *Worker) Work(ctx context.Context, _ *river.Job[Args]) error {
	sum, err := w.Runner.Run(ctx)
	if err != nil {
		return err
	}
	observe(sum)
	if sum != (Summary{}) {
		w.Runner.log().InfoContext(ctx, "gap topics", "embedded", sum.Embedded, "assigned", sum.Assigned, "newTopics", sum.NewTopics,
			"merged", sum.Merged, "confirmed", sum.Confirmed, "reopened", sum.Reopened, "resolved", sum.Resolved, "labelled", sum.Labelled,
			"pruned", sum.Pruned)
	}
	return nil
}

// Register adds the topics job's worker.
func Register(w *river.Workers, r *Runner) {
	river.AddWorker(w, &Worker{Runner: r})
}

// Periodic schedules the topics job hourly, and once at start.
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(Interval),
		func() (river.JobArgs, *river.InsertOpts) { return Args{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true})
}

// observe exports a run's counts (grounded_gap_topic_changes_total).
func observe(sum Summary) {
	for kind, n := range map[string]int{"embedded": sum.Embedded, "assigned": sum.Assigned, "new_topic": sum.NewTopics, "merged": sum.Merged,
		"confirmed": sum.Confirmed, "reopened": sum.Reopened, "resolved": sum.Resolved, "labelled": sum.Labelled, "pruned": sum.Pruned} {
		if n > 0 {
			observability.GapTopicChanges.WithLabelValues(kind).Add(float64(n))
		}
	}
}
