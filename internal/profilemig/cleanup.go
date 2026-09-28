// Cleanup and the sweep: switched migrations whose grace period is over are
// completed, and embedding sets nothing needs any more are deleted in
// bounded batches (their vectors go with their chunks). The sweep enqueues
// embedding for every set and lets complete migrations switch, so nothing
// depends on a job enqueued at the right moment.

package profilemig

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/audit"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// deleteBatch is how many chunks one delete statement removes.
const deleteBatch = 1000

// CleanupArgs completes expired migrations and deletes unneeded sets.
type CleanupArgs struct{}

func (CleanupArgs) Kind() string { return "profile_migration.cleanup" }

func (CleanupArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: 10 * time.Second}}
}

// CleanupWorker runs profile_migration.cleanup.
type CleanupWorker struct {
	river.WorkerDefaults[CleanupArgs]
	S *Service
	// Budget is the work time per invocation (default 2 min); the rest
	// continues in the next one.
	Budget time.Duration
}

func (w *CleanupWorker) Timeout(*river.Job[CleanupArgs]) time.Duration {
	return w.budget() + 5*time.Minute
}

func (w *CleanupWorker) budget() time.Duration {
	if w.Budget > 0 {
		return w.Budget
	}
	return 2 * time.Minute
}

func (w *CleanupWorker) Work(ctx context.Context, _ *river.Job[CleanupArgs]) error {
	more, err := w.S.Cleanup(ctx, time.Now().Add(w.budget()))
	if err != nil || !more {
		return err
	}
	return river.JobSnooze(0)
}

// Cleanup completes switched migrations past their grace period, then
// deletes unneeded embedding sets until the deadline. It reports whether
// work is left.
func (s *Service) Cleanup(ctx context.Context, deadline time.Time) (bool, error) {
	if err := s.expire(ctx); err != nil {
		return false, err
	}
	var sets []dbgen.UnneededEmbeddingSetsRow
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.LockProfileMigrations(ctx); err != nil {
			return err
		}
		var err error
		if sets, err = q.UnneededEmbeddingSets(ctx); err != nil {
			return err
		}
		for _, set := range sets {
			if err := q.MarkEmbeddingSetDeleting(ctx, dbgen.MarkEmbeddingSetDeletingParams(set)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	for _, set := range sets {
		done, err := s.deleteSet(ctx, set, deadline)
		if err != nil || !done {
			return true, err
		}
	}
	return false, nil
}

// expire completes switched migrations whose old vectors are due.
func (s *Service) expire(ctx context.Context) error {
	expired, err := s.q.ExpiredSwitchedMigrations(ctx)
	if err != nil {
		return err
	}
	for _, m := range expired {
		err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
			if err := q.LockProfileMigrations(ctx); err != nil {
				return err
			}
			cur, err := q.LockProfileMigration(ctx, m.ID)
			if err != nil || cur.Status != StatusSwitched {
				return err
			}
			done, err := q.FinishProfileMigration(ctx, dbgen.FinishProfileMigrationParams{Status: StatusCompleted, ID: m.ID})
			if err != nil {
				return err
			}
			return audit.Record(ctx, q, audit.Entry{ActorKind: audit.ActorSystem, TeamID: m.TeamID, Action: "kb.profile_migration_complete",
				TargetType: "knowledge_base", TargetID: m.KBID.String(), Metadata: s.meta(done, nil)})
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// deleteSet deletes a set's chunks in batches, then the set, while it is
// still marked deleting (a new migration may claim it back). It reports
// whether it finished.
func (s *Service) deleteSet(ctx context.Context, set dbgen.UnneededEmbeddingSetsRow, deadline time.Time) (bool, error) {
	for {
		status, err := s.q.EmbeddingSetStatus(ctx, dbgen.EmbeddingSetStatusParams(set))
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		} else if err != nil {
			return false, err
		}
		if status != "deleting" {
			return true, nil
		}
		n, err := s.q.DeleteSetChunksBatch(ctx, dbgen.DeleteSetChunksBatchParams{SourceID: set.SourceID, ProfileID: set.ProfileID, MaxRows: deleteBatch})
		if err != nil {
			return false, err
		}
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			return false, nil
		}
	}
	return true, store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		if err := q.DeleteSetFailuresFor(ctx, dbgen.DeleteSetFailuresForParams(set)); err != nil {
			return err
		}
		return q.DeleteEmbeddingSet(ctx, dbgen.DeleteEmbeddingSetParams(set))
	})
}

// SweepArgs enqueues embedding for every set and advances running
// migrations.
type SweepArgs struct{}

func (SweepArgs) Kind() string { return "profile_migration.sweep" }

func (SweepArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: 30 * time.Second}}
}

// SweepWorker runs profile_migration.sweep.
type SweepWorker struct {
	river.WorkerDefaults[SweepArgs]
	S *Service
}

func (w *SweepWorker) Work(ctx context.Context, _ *river.Job[SweepArgs]) error {
	q := w.S.q
	sets, err := q.ListEmbeddingSets(ctx)
	if err != nil {
		return err
	}
	if len(sets) > 0 {
		client, err := river.ClientFromContextSafely[pgx.Tx](ctx)
		if err != nil {
			return err
		}
		params := make([]river.InsertManyParams, len(sets))
		for i, set := range sets {
			params[i] = river.InsertManyParams{Args: ingest.SetArgs{SourceID: set.SourceID, ProfileID: set.ProfileID}}
		}
		if _, err := client.InsertMany(ctx, params); err != nil {
			return err
		}
	}
	running, err := q.RunningMigrationIDs(ctx)
	if err != nil {
		return err
	}
	for _, id := range running {
		if err := w.S.Advance(ctx, id); err != nil {
			w.S.Log.WarnContext(ctx, "profile migration could not advance", "migration", id, "err", err)
		}
	}
	return nil
}

// Register adds the profile migration workers; p is the ingestion
// processor (the batcher, chunker and vector store).
func Register(w *river.Workers, s *Service, p *ingest.Processor) {
	river.AddWorker(w, &SetWorker{S: s, P: p})
	river.AddWorker(w, &CleanupWorker{S: s})
	river.AddWorker(w, &SweepWorker{S: s})
}

// SweepPeriodic runs the sweep every 30 s.
func SweepPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(30*time.Second),
		func() (river.JobArgs, *river.InsertOpts) { return SweepArgs{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}

// CleanupPeriodic runs the cleanup every 10 minutes.
func CleanupPeriodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(10*time.Minute),
		func() (river.JobArgs, *river.InsertOpts) { return CleanupArgs{}, nil }, &river.PeriodicJobOpts{RunOnStart: true})
}
