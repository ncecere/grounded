// The scheduler: starting runs of web sources whose next sync is due.

package web

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/limits"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ScheduleArgs starts runs for web sources whose next sync is due. It runs
// every minute on every worker; row locks keep sources from double starts.
type ScheduleArgs struct{}

func (ScheduleArgs) Kind() string { return "web.schedule" }

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

func (w *ScheduleWorker) Work(ctx context.Context, _ *river.Job[ScheduleArgs]) error {
	// Maintenance mode: due sources stay due and start once it ends.
	if paused, err := w.S.Maintenance.Paused(ctx); err != nil || paused {
		return err
	}
	started := 0
	err := pgx.BeginFunc(ctx, w.S.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		due, err := q.DueWebSources(ctx)
		if err != nil {
			return err
		}
		now := time.Now()
		for _, src := range due {
			cfg, err := Stored(src.Config)
			if err != nil || cfg.Schedule == ScheduleManual {
				if err := q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID}); err != nil {
					return err
				}
				continue
			}
			_, err = w.S.StartRun(ctx, tx, src, TriggerSchedule, uuid.Nil)
			var busy *InProgressError
			var blocked *limits.Error
			if errors.As(err, &busy) || platform.IsMaintenance(err) {
				continue // the active run sets the next sync when it finishes; or maintenance began meanwhile
			} else if errors.As(err, &blocked) {
				// Crawling is blocked for the team: try again next period.
				if err := q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID, NextSyncAt: NextSync(cfg.Schedule, now)}); err != nil {
					return err
				}
				continue
			} else if err != nil {
				return err
			}
			// Provisional: a cancelled or failed run still waits a period.
			if err := q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID, NextSyncAt: NextSync(cfg.Schedule, now)}); err != nil {
				return err
			}
			started++
		}
		return nil
	})
	if started > 0 {
		w.S.Log.Info("scheduled crawls started", "count", started)
	}
	if err != nil {
		return err
	}
	// Safety net for runs waiting for a crawl slot: limits raised, or a
	// slot freed by a deleted source.
	return w.S.PromoteAll(ctx)
}
