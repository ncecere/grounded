package sourcesync

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/connector"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/observability"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/sourcetypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/webhooks"
)

// maxAttempts is how often a sync that fails is tried again (with River's backoff) before it is marked failed.
const maxAttempts = 4

// SyncArgs runs one sync.
type SyncArgs struct {
	SyncID uuid.UUID `json:"sync_id"`
}

func (SyncArgs) Kind() string { return "connector.sync" }

func (SyncArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: maxAttempts}
}

// SyncWorker runs syncs.
type SyncWorker struct {
	river.WorkerDefaults[SyncArgs]
	S *Service
}

// NextRetry spaces a failed sync's attempts: one minute, then five, then twenty-five, unless the service says otherwise.
func (w *SyncWorker) NextRetry(job *river.Job[SyncArgs]) time.Time {
	if w.S.RetryDelay != nil {
		return time.Now().Add(w.S.RetryDelay(job.Attempt))
	}
	d := time.Minute
	for i := 1; i < job.Attempt; i++ {
		d *= 5
	}
	return time.Now().Add(d)
}

// Timeout: a first sync of a large source takes as long as it takes. It checkpoints, and a restart continues.
func (w *SyncWorker) Timeout(*river.Job[SyncArgs]) time.Duration { return -1 }

func (w *SyncWorker) Work(ctx context.Context, job *river.Job[SyncArgs]) error {
	err := w.S.runSync(ctx, job.Args.SyncID, job.Attempt >= maxAttempts)
	if err != nil && ctx.Err() != nil {
		// The worker is shutting down: not a failure of the sync. It continues from its checkpoint.
		return river.JobSnooze(15 * time.Second)
	}
	return err
}

// Register adds the connector workers.
func Register(w *river.Workers, s *Service) {
	river.AddWorker(w, &SyncWorker{S: s})
	river.AddWorker(w, &ScheduleWorker{S: s})
}

// runSync runs one sync to its end. last: this is the final attempt, so an error marks the sync failed instead of
// being returned for a retry.
func (s *Service) runSync(ctx context.Context, id uuid.UUID, last bool) error {
	run, src, err := s.admit(ctx, id)
	if err != nil || !Active(run) {
		return err
	}
	c, err := connectorFor(src.Type)
	if err != nil {
		return s.fail(ctx, run, src, "This server has no connector for this source's type")
	}
	creds, row, err := s.credentials(ctx, s.q, src.ID)
	if err != nil {
		return s.fail(ctx, run, src, "The source's stored credentials can't be read. Enter them again in its settings.")
	}
	req := connector.Request{Cursor: row.Cursor, Full: run.FullListing || len(row.Cursor) == 0}
	if len(run.Checkpoint) > 0 {
		req.Cursor = run.Checkpoint // a restart of this sync continues where it was
	}
	k := s.newSink(src, run)
	res, err := c.Sync(ctx, s.env(ctx, src, creds), req, k)
	bg := context.WithoutCancel(ctx)
	if ferr := k.flush(bg, true); ferr != nil && err == nil {
		err = ferr
	}
	switch {
	case err == nil:
		return s.finish(ctx, k, res)
	case errors.Is(err, connector.ErrStopped) && k.stop != "":
		return s.stopped(bg, k)
	case ctx.Err() != nil:
		return err
	case errors.Is(err, connector.ErrCredentials):
		return s.fail(bg, run, src, "The provider refused the credentials. Enter new ones in the source's settings.")
	case last:
		return s.fail(bg, run, src, redact(err.Error(), creds))
	}
	s.Log.WarnContext(ctx, "sync attempt failed", "sync", run.ID, "source", src.ID, "err", redact(err.Error(), creds))
	return err
}

// admit marks the sync running and returns it with its source. A sync whose source is paused, whose type is off, or
// that starts during maintenance ends cancelled with the reason.
func (s *Service) admit(ctx context.Context, id uuid.UUID) (dbgen.SourceSync, dbgen.DataSource, error) {
	var run dbgen.SourceSync
	var src dbgen.DataSource
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		var err error
		if run, err = q.LockSourceSync(ctx, id); errors.Is(store.NotFound(err), store.ErrNotFound) {
			return nil // the source was deleted
		} else if err != nil || !Active(run) {
			return err
		}
		if src, err = q.GetSource(ctx, run.SourceID); err != nil {
			return err
		}
		why := ""
		if on, err := platform.SourceTypeEnabled(ctx, q, src.Type); err != nil {
			return err
		} else if !on {
			why = "type_off"
		}
		if src.Status == "paused" {
			why = "paused"
		}
		if paused, err := s.Maintenance.Paused(ctx); err != nil {
			return err
		} else if paused {
			why = "maintenance"
		}
		if why != "" {
			run, err = q.FinishSourceSync(ctx, dbgen.FinishSourceSyncParams{ID: run.ID, Status: StatusCancelled, StoppedReason: why})
			return err
		}
		run, err = q.StartSourceSync(ctx, run.ID)
		return err
	})
	return run, src, err
}

// stopped ends a sync that could not go on (a team limit) or was cancelled. Nothing is removed and the cursor stays, so
// the next sync starts where this one did.
func (s *Service) stopped(ctx context.Context, k *sink) error {
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, _ pgx.Tx) error {
		cur, err := q.LockSourceSync(ctx, k.run.ID)
		if err != nil || !Active(cur) {
			return gone(err)
		}
		if err := q.ClearSyncRemovals(ctx, cur.ID); err != nil {
			return err
		}
		if _, err = q.FinishSourceSync(ctx, dbgen.FinishSourceSyncParams{ID: cur.ID, Status: StatusCompleted, StoppedReason: k.stop}); err == nil {
			observability.ConnectorSyncs.WithLabelValues(k.src.Type, "stopped").Inc()
		}
		return err
	})
}

// fail marks a sync failed and tells the team's webhooks. The cursor stays where it was.
func (s *Service) fail(ctx context.Context, run dbgen.SourceSync, src dbgen.DataSource, msg string) error {
	return store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := q.LockSourceSync(ctx, run.ID)
		if err != nil || !Active(cur) {
			return gone(err)
		}
		if err := q.ClearSyncRemovals(ctx, cur.ID); err != nil {
			return err
		}
		if _, err := q.FinishSourceSync(ctx, dbgen.FinishSourceSyncParams{ID: cur.ID, Status: StatusFailed, Error: msg}); err != nil {
			return err
		}
		observability.ConnectorSyncs.WithLabelValues(src.Type, "failed").Inc()
		if s.Webhooks == nil || !src.TeamID.Valid {
			return nil
		}
		return s.Webhooks.Emit(ctx, tx, webhooks.Event{Type: webhooks.EventSourceSyncFailed, TeamID: src.TeamID.UUID,
			Data: map[string]any{"sourceId": src.ID, "sourceName": src.Name, "sourceType": src.Type, "syncId": cur.ID, "reason": msg}})
	})
}

// finish ends a sync that ran to the end of its listing: removals (or their hold), the connector's groups, the cursor
// and the next sync.
func (s *Service) finish(ctx context.Context, k *sink, res connector.Result) error {
	var removed []dbgen.DeleteSyncRemovalsRow
	var held, ended bool
	err := store.InTx(ctx, s.Pool, func(q *dbgen.Queries, tx pgx.Tx) error {
		cur, err := q.LockSourceSync(ctx, k.run.ID)
		if err != nil || !Active(cur) {
			return gone(err) // cancelled meanwhile, or the source was deleted
		}
		src, err := q.LockSource(ctx, k.src.ID)
		if err != nil {
			return err
		}
		p := dbgen.FinishSourceSyncParams{ID: cur.ID, Status: StatusCompleted, Complete: res.Complete}
		if removed, err = s.settleRemovals(ctx, q, src, cur, res.Complete, &p); err != nil {
			return err
		}
		if res.Complete && k.provider {
			keep := make([]string, 0, len(k.groups))
			for g := range k.groups {
				keep = append(keep, g)
			}
			if _, err := q.DeleteSourceGroupsExcept(ctx, dbgen.DeleteSourceGroupsExceptParams{SourceID: src.ID, Keep: keep}); err != nil {
				return err
			}
		}
		if err := q.SetSourceCursor(ctx, dbgen.SetSourceCursorParams{ID: src.ID, Cursor: res.Cursor, Complete: res.Complete}); err != nil {
			return err
		}
		done, err := q.FinishSourceSync(ctx, p)
		if err != nil {
			return err
		}
		held, ended = done.Removals == RemovalsPending, true
		return s.afterSync(ctx, q, tx, src, done)
	})
	if err != nil || !ended {
		return err
	}
	result := "completed"
	if held {
		result = "held"
	}
	observability.ConnectorSyncs.WithLabelValues(k.src.Type, result).Inc()
	observability.ConnectorItems.WithLabelValues(k.src.Type, "removed").Add(float64(len(removed)))
	s.Log.InfoContext(ctx, "sync finished", "sync", k.run.ID, "source", k.src.ID, "complete", res.Complete, "removed", len(removed), "held", held)
	return nil
}

// afterSync is what follows a finished sync in its transaction: repeated blocks are counted again, the next sync is
// scheduled, and the team's webhooks hear of it.
func (s *Service) afterSync(ctx context.Context, q *dbgen.Queries, tx pgx.Tx, src dbgen.DataSource, done dbgen.SourceSync) error {
	if err := ingest.RequestRefresh(ctx, s.Jobs, tx, src.ID); err != nil {
		return err
	}
	row, err := q.GetSourceConnector(ctx, src.ID)
	if err != nil {
		return err
	}
	now := s.now()
	if err := q.SetNextSync(ctx, dbgen.SetNextSyncParams{ID: src.ID, NextSyncAt: NextSync(row.Schedule, now), LastSyncAt: &now}); err != nil {
		return err
	}
	if s.Webhooks == nil || !src.TeamID.Valid {
		return nil
	}
	return s.Webhooks.Emit(ctx, tx, webhooks.Event{Type: webhooks.EventSourceSynced, TeamID: src.TeamID.UUID, Data: map[string]any{
		"sourceId": src.ID, "sourceName": src.Name, "sourceType": src.Type, "syncId": done.ID,
		"itemsAdded": done.ItemsAdded, "itemsChanged": done.ItemsChanged, "itemsUnchanged": done.ItemsUnchanged,
		"itemsSkipped": done.ItemsSkipped, "documentsDeleted": done.ItemsRemoved, "removalsHeld": done.RemovalsPending,
		"complete": done.Complete}})
}

// capable reports whether a source's type syncs through this package.
func capable(typ string) bool {
	return typ != sourcetypes.Web && sourcetypes.Of(typ).Sync
}

// gone treats a sync whose row is no longer there (its source was deleted) as nothing left to do.
func gone(err error) error {
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil
	}
	return err
}
