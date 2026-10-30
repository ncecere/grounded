package contenthealth

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// RunArgs makes one report.
type RunArgs struct {
	ReportID uuid.UUID `json:"reportId"`
}

func (RunArgs) Kind() string { return "content_health.run" }

// InsertOpts: its own queue, one attempt (a report that failed is made again by a person, never by a retry loop).
func (RunArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 1}
}

// RunWorker makes a report. It writes only the report's own tables, so maintenance mode does not pause it; it makes no
// network call and calls no model.
type RunWorker struct {
	river.WorkerDefaults[RunArgs]
	S *Service
}

// Timeout bounds one report.
func (w *RunWorker) Timeout(*river.Job[RunArgs]) time.Duration { return ReportTimeout }

func (w *RunWorker) Work(ctx context.Context, job *river.Job[RunArgs]) error {
	return w.S.Execute(ctx, job.Args.ReportID)
}

// PruneArgs removes expired reports and ends stuck ones.
type PruneArgs struct{}

func (PruneArgs) Kind() string { return "content_health.prune" }

// InsertOpts: on the report queue too, so a release that does not know the job (a rolling update, a rollback) never takes it.
func (PruneArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 1, UniqueOpts: river.UniqueOpts{ByPeriod: time.Hour}}
}

// PruneWorker keeps the stored reports within their bounds: the latest KeepReports per team, each for RetentionDays after it
// ended; a report that never started or whose worker died ends as failed (timed_out).
type PruneWorker struct {
	river.WorkerDefaults[PruneArgs]
	S *Service
}

func (w *PruneWorker) Work(ctx context.Context, _ *river.Job[PruneArgs]) error { return w.S.Prune(ctx) }

// Prune does one pass.
func (s *Service) Prune(ctx context.Context) error {
	n, err := s.q.FailStuckContentHealthReports(ctx, dbgen.FailStuckContentHealthReportsParams{
		RetentionDays: RetentionDays, QueuedMinutes: stuckQueuedMinutes, RunningMinutes: stuckRunningMinutes,
	})
	if err != nil {
		return err
	}
	gone, err := s.q.PruneContentHealthReports(ctx, dbgen.PruneContentHealthReportsParams{Keep: KeepReports})
	if err != nil {
		return err
	}
	if n > 0 || gone > 0 {
		s.Log.InfoContext(ctx, "content health reports pruned", "stuck", n, "deleted", gone)
	}
	return nil
}

// Register adds the report job and the prune job to the workers.
func Register(w *river.Workers, s *Service) {
	river.AddWorker(w, &RunWorker{S: s})
	river.AddWorker(w, &PruneWorker{S: s})
}

// PrunePeriodic schedules the prune job hourly.
func PrunePeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Hour),
		func() (river.JobArgs, *river.InsertOpts) { return PruneArgs{}, nil }, nil)
}
