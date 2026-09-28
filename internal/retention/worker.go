package retention

import (
	"context"
	"time"

	"github.com/riverqueue/river"
)

// Interval is how often the scheduled run starts. Anonymous conversations
// (hours) are the shortest period; everything else is in days.
const Interval = 10 * time.Minute

// runTimeout bounds one run. Batches are bounded (Batch × MaxBatches per
// kind), so a run normally takes seconds; a backlog continues next run.
const runTimeout = 30 * time.Minute

// Args is the scheduled retention run.
type Args struct{}

func (Args) Kind() string { return "retention.run" }

func (Args) InsertOpts() river.InsertOpts {
	// Several workers schedule the periodic job; one run per period is enough.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: Interval}}
}

// Worker runs the scheduled retention run.
type Worker struct {
	river.WorkerDefaults[Args]
	Runner *Runner
}

func (w *Worker) Timeout(*river.Job[Args]) time.Duration { return runTimeout }

// Work runs every kind. A kind that fails is recorded on the run (and in
// metrics) and retried by the next scheduled run, not by River.
func (w *Worker) Work(ctx context.Context, _ *river.Job[Args]) error {
	_, err := w.Runner.RunScheduled(ctx)
	return err
}

// Periodic schedules the run every Interval.
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(Interval),
		func() (river.JobArgs, *river.InsertOpts) { return Args{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}

// RequestedArgs runs a run a platform admin asked for ("Run now").
type RequestedArgs struct {
	RunID int64 `json:"runId"`
}

func (RequestedArgs) Kind() string { return "retention.run_requested" }

// RequestedWorker runs requested runs, after any run in progress.
type RequestedWorker struct {
	river.WorkerDefaults[RequestedArgs]
	Runner *Runner
}

func (w *RequestedWorker) Timeout(*river.Job[RequestedArgs]) time.Duration { return runTimeout }

func (w *RequestedWorker) Work(ctx context.Context, job *river.Job[RequestedArgs]) error {
	ran, err := w.Runner.RunRequested(ctx, job.Args.RunID)
	if err == nil && !ran {
		return river.JobSnooze(15 * time.Second)
	}
	return err
}

// Register adds the retention workers.
func Register(w *river.Workers, r *Runner) {
	river.AddWorker(w, &Worker{Runner: r})
	river.AddWorker(w, &RequestedWorker{Runner: r})
}
