package breakglass

import (
	"context"
	"time"

	"github.com/riverqueue/river"
)

// SweepArgs expires due sessions and lapses due requests (every minute).
type SweepArgs struct{}

func (SweepArgs) Kind() string { return "breakglass.sweep" }

func (SweepArgs) InsertOpts() river.InsertOpts {
	// Several workers schedule the same periodic job; one run per minute is enough.
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: time.Minute}}
}

// SweepWorker runs Sweep.
type SweepWorker struct {
	river.WorkerDefaults[SweepArgs]
	S *Service
}

func (w *SweepWorker) Work(ctx context.Context, _ *river.Job[SweepArgs]) error {
	n, err := w.S.Sweep(ctx)
	if n > 0 && w.S.Log != nil {
		w.S.Log.InfoContext(ctx, "closed break-glass sessions", "count", n)
	}
	return err
}

// Periodic schedules the sweep every minute (and on start).
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
		func() (river.JobArgs, *river.InsertOpts) { return SweepArgs{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true})
}
