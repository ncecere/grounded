package sourcesync

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ScheduleArgs starts syncs of connector sources whose next sync is due. It runs every minute on every worker; row
// locks keep a source from starting twice.
type ScheduleArgs struct{}

func (ScheduleArgs) Kind() string { return "connector.schedule" }

func (ScheduleArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning, rivertype.JobStateScheduled,
	}}}
}

// ScheduleWorker runs the scheduler.
type ScheduleWorker struct {
	river.WorkerDefaults[ScheduleArgs]
	S *Service
}

// SchedulePeriodic is the scheduler's periodic job.
func SchedulePeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(time.Minute),
		func() (river.JobArgs, *river.InsertOpts) { return ScheduleArgs{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}

func (w *ScheduleWorker) Work(ctx context.Context, _ *river.Job[ScheduleArgs]) error {
	s := w.S
	// Maintenance mode: due sources stay due and start once it ends.
	if paused, err := s.Maintenance.Paused(ctx); err != nil || paused {
		return err
	}
	started := 0
	err := pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		due, err := q.DueConnectorSources(ctx)
		if err != nil {
			return err
		}
		now := s.now()
		for _, src := range due {
			row, err := q.GetSourceConnector(ctx, src.ID)
			if err != nil {
				return err
			}
			// Provisional: the sync sets the next one when it finishes; one that can't start waits a period.
			if err := q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID, NextSyncAt: NextSync(row.Schedule, now), LastSyncAt: src.LastSyncAt}); err != nil {
				return err
			}
			if row.Schedule == ScheduleManual || !capable(src.Type) {
				continue
			}
			_, err = s.StartSync(ctx, tx, src, TriggerSchedule, false, uuid.Nil)
			var busy *InProgressError
			if _, refused := apperr.As(err); errors.As(err, &busy) || refused {
				continue // already syncing, the type is off, no connector, credentials missing, maintenance began
			} else if err != nil {
				return err
			}
			started++
		}
		return nil
	})
	if started > 0 {
		s.Log.InfoContext(ctx, "scheduled syncs started", "count", started)
	}
	return err
}
