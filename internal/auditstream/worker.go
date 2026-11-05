package auditstream

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Deliver sends one destination's waiting entries, a batch at a time, until none wait, it fails, or the budget is spent.
// It reports how many entries were delivered. One delivery per destination runs at a time (an advisory lock), so a cursor
// never moves twice for the same batch.
func (s *Service) Deliver(ctx context.Context, id uuid.UUID, budget time.Duration) (int, error) {
	release, ok, err := store.TryAdvisoryLockText(ctx, s.Pool, "grounded.audit_stream:"+id.String())
	if err != nil || !ok {
		return 0, err
	}
	defer release()
	q := dbgen.New(s.Pool)
	deadline := s.now().Add(budget)
	sent := 0
	for s.now().Before(deadline) {
		d, err := q.GetAuditStreamDestination(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!d.Enabled || d.CursorTxid == "")) {
			return sent, nil // deleted, switched off, or never started
		} else if err != nil {
			return sent, err
		}
		rows, err := q.NextAuditStreamEntries(ctx, dbgen.NextAuditStreamEntriesParams{CursorTxid: d.CursorTxid, CursorID: d.CursorID, MaxRows: MaxBatch})
		if err != nil || len(rows) == 0 {
			return sent, err
		}
		events, last := s.batch(rows)
		if err := s.send(ctx, d, events); err != nil {
			wait := backoff(d.Failures)
			if ferr := q.FailAuditStreamDestination(ctx, dbgen.FailAuditStreamDestinationParams{ID: id, ErrorClass: Class(err),
				NextAttemptAt: ptr(s.now().Add(wait))}); ferr != nil {
				return sent, ferr
			}
			s.Log.WarnContext(ctx, "audit stream delivery failed", "destination", id, "class", Class(err), "retry_in", wait)
			return sent, nil
		}
		if err := q.AdvanceAuditStreamCursor(ctx, dbgen.AdvanceAuditStreamCursorParams{ID: id, CursorTxid: rows[last].Txid, CursorID: rows[last].ID,
			Sent: int64(len(events))}); err != nil {
			return sent, err
		}
		sent += len(events)
		if len(events) < MaxBatch {
			return sent, nil
		}
	}
	return sent, nil
}

// batch projects rows into events, stopping before MaxBatchBytes; last is the index of the last row included (at least one).
func (s *Service) batch(rows []dbgen.NextAuditStreamEntriesRow) ([]Event, int) {
	events := make([]Event, 0, len(rows))
	size := 0
	for i, r := range rows {
		e := ToEvent(s.Instance, r)
		raw, _ := json.Marshal(e)
		if i > 0 && size+len(raw)+200 > MaxBatchBytes {
			return events, i - 1
		}
		size += len(raw) + 200 // the envelope (HEC or syslog header)
		events = append(events, e)
	}
	return events, len(rows) - 1
}

// backoff after failures failures in a row: 5 s, doubling, at most 5 min.
func backoff(failures int32) time.Duration {
	d := minBackoff
	for i := int32(0); i < failures && d < maxBackoff; i++ {
		d *= 2
	}
	return min(d, maxBackoff)
}

func ptr[T any](v T) *T { return &v }

// DispatchArgs runs a delivery round for every due destination.
type DispatchArgs struct{}

func (DispatchArgs) Kind() string { return "audit_stream.dispatch" }

func (DispatchArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 1, UniqueOpts: river.UniqueOpts{ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning, rivertype.JobStateRetryable, rivertype.JobStateScheduled,
	}}}
}

// DispatchWorker delivers to every due destination at once (at most 5), each for at most a minute.
type DispatchWorker struct {
	river.WorkerDefaults[DispatchArgs]
	S *Service
}

func (w *DispatchWorker) Timeout(*river.Job[DispatchArgs]) time.Duration { return 2 * time.Minute }

func (w *DispatchWorker) Work(ctx context.Context, _ *river.Job[DispatchArgs]) error {
	ids, err := dbgen.New(w.S.Pool).DueAuditStreamDestinations(ctx)
	if err != nil || len(ids) == 0 {
		return err
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := w.S.Deliver(ctx, id, time.Minute); err != nil {
				w.S.Log.WarnContext(ctx, "audit stream delivery stopped", "destination", id, "err", err)
			}
		}()
	}
	wg.Wait()
	return nil
}

// Register adds the worker.
func Register(w *river.Workers, s *Service) { river.AddWorker(w, &DispatchWorker{S: s}) }

// Periodic runs a delivery round every 5 seconds (and on start).
func Periodic() *river.PeriodicJob {
	return river.NewPeriodicJob(river.PeriodicInterval(5*time.Second), func() (river.JobArgs, *river.InsertOpts) { return DispatchArgs{}, nil },
		&river.PeriodicJobOpts{RunOnStart: true})
}
