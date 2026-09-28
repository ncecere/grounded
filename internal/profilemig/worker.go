// The embedding_set.sync job: embeds a source's ready documents for one of
// its profiles, in bounded, resumable steps. Documents with vectors for the
// profile are done (so a restart resumes where it stopped, and repeating a
// step changes nothing); failures are recorded per document version.
// Maintenance mode doesn't pause it: an admin may turn maintenance on to
// keep new ingestion out of the way of a large migration.

package profilemig

import (
	"context"
	"errors"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Bounds of one step.
const (
	setBatch = 32 // documents read per step
	// setParallel is how many documents of a set are embedded at once by
	// default (their inputs share requests through the batcher).
	setParallel = 8
	// maxTransient is how often a temporary error is retried before the
	// document waits for an admin's retry.
	maxTransient = 3
	// unusablePoll is how often a set whose model is disabled checks again.
	unusablePoll = time.Minute
	// lockPoll is how often a follow-up job checks whether the set's
	// running job has finished.
	lockPoll = 2 * time.Second
)

// SetWorker runs embedding_set.sync jobs.
type SetWorker struct {
	river.WorkerDefaults[ingest.SetArgs]
	S *Service
	P *ingest.Processor
	// Parallel is how many documents are embedded at once (their inputs
	// share requests through the batcher; default setParallel).
	Parallel int
	// Budget is the work time per invocation (default 5 min).
	Budget time.Duration
}

func (w *SetWorker) budget() time.Duration {
	if w.Budget > 0 {
		return w.Budget
	}
	return 5 * time.Minute
}

func (w *SetWorker) Timeout(*river.Job[ingest.SetArgs]) time.Duration {
	return w.budget() + 10*time.Minute
}

func (w *SetWorker) Work(ctx context.Context, job *river.Job[ingest.SetArgs]) error {
	q := dbgen.New(w.S.Pool)
	args := job.Args
	release, ok, err := w.lockSet(ctx, args)
	if err != nil {
		return err
	} else if !ok {
		return river.JobSnooze(lockPoll) // another job for the set runs
	}
	defer release()
	src, ok, err := active(ctx, q, args)
	if err != nil || !ok {
		return err
	}
	target, err := w.S.Catalog.EmbedTarget(ctx, args.ProfileID)
	if errors.Is(err, catalog.ErrProfileUnusable) {
		w.setError(ctx, q, args, "The target profile's model or its connection is disabled; the migration waits.")
		return river.JobSnooze(unusablePoll)
	} else if err != nil {
		return err
	}
	deadline := time.Now().Add(w.budget())
	for {
		docs, err := q.PendingSetDocuments(ctx, dbgen.PendingSetDocumentsParams{SourceID: src.ID, ProfileID: args.ProfileID, MaxRows: setBatch})
		if err != nil {
			return err
		}
		if len(docs) == 0 {
			break
		}
		if wait, err := w.step(ctx, q, src, target, docs); err != nil {
			return err
		} else if wait > 0 {
			return river.JobSnooze(wait)
		}
		if time.Now().After(deadline) {
			return river.JobSnooze(0) // continue in a new invocation
		}
		// Cancelled, cleaned up or moved meanwhile?
		if src, ok, err = active(ctx, q, args); err != nil || !ok {
			return err
		}
	}
	w.setError(ctx, q, args, "")
	return w.S.finishSet(ctx, q, args)
}

// lockSet takes the set's session advisory lock, so one job per set runs
// at a time (a follow-up waits). The lock is held on a connection of its
// own, outside the pool the work uses (store.TryAdvisoryLock).
func (w *SetWorker) lockSet(ctx context.Context, args ingest.SetArgs) (func(), bool, error) {
	return store.TryAdvisoryLockText(ctx, w.S.Pool, "grounded.embedding_set:"+args.SourceID.String()+":"+args.ProfileID.String())
}

// active loads the set's source and reports whether the set is still
// wanted: the source's own profile, or a set that isn't being deleted.
func active(ctx context.Context, q *dbgen.Queries, args ingest.SetArgs) (dbgen.DataSource, bool, error) {
	src, err := q.GetSource(ctx, args.SourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return src, false, nil
	} else if err != nil || src.EmbeddingProfileID == args.ProfileID {
		return src, err == nil, err
	}
	status, err := q.EmbeddingSetStatus(ctx, dbgen.EmbeddingSetStatusParams{SourceID: src.ID, ProfileID: args.ProfileID})
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return src, false, nil // cancelled or cleaned up
	}
	return src, err == nil && status != "deleting", err
}

func (w *SetWorker) setError(ctx context.Context, q *dbgen.Queries, args ingest.SetArgs, msg string) {
	if err := q.SetEmbeddingSetError(ctx, dbgen.SetEmbeddingSetErrorParams{SourceID: args.SourceID, ProfileID: args.ProfileID, LastError: msg}); err != nil {
		w.S.Log.WarnContext(ctx, "could not record embedding set state", "source", args.SourceID, "err", err)
	}
}

// step embeds a batch of documents, Parallel at a time. It returns how
// long to wait when the model asked Grounded to back off.
func (w *SetWorker) step(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, target catalog.EmbedTarget, docs []dbgen.PendingSetDocumentsRow) (time.Duration, error) {
	parallel := w.Parallel
	if parallel <= 0 {
		parallel = setParallel
	}
	var (
		mu       sync.Mutex
		wait     time.Duration
		firstErr error
		wg       sync.WaitGroup
	)
	sem := make(chan struct{}, parallel)
	for _, doc := range docs {
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() { <-sem; wg.Done() }()
			_, err := w.P.Reembed(ctx, src, doc, target)
			d, rerr := w.outcome(ctx, q, src, target, doc, err)
			mu.Lock()
			defer mu.Unlock()
			wait = max(wait, d)
			if firstErr == nil {
				firstErr = rerr
			}
		}()
	}
	wg.Wait()
	if ctx.Err() != nil {
		return 0, ctx.Err()
	}
	return wait, firstErr
}

// outcome records a document's result: nothing on success or when it
// changed meanwhile; a wait under backpressure; else a failure (retried
// later when temporary, up to maxTransient times).
func (w *SetWorker) outcome(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, target catalog.EmbedTarget, doc dbgen.PendingSetDocumentsRow, err error) (time.Duration, error) {
	switch {
	case err == nil, errors.Is(err, ingest.ErrSuperseded):
		return 0, nil
	case ctx.Err() != nil:
		return 0, nil // shutting down: the next run resumes
	}
	if d, ok := ingest.Backpressure(err); ok {
		return d, nil
	}
	o := ingest.ClassifySet(err)
	attempts, aerr := q.GetSetFailureAttempts(ctx, dbgen.GetSetFailureAttemptsParams{DocumentID: doc.ID, ProfileID: target.Profile.ID, Version: doc.Version})
	if aerr != nil && !errors.Is(store.NotFound(aerr), store.ErrNotFound) {
		return 0, aerr
	}
	permanent := o.Permanent || attempts+1 >= maxTransient
	var retry *time.Time
	if !permanent {
		t := time.Now().Add(backoff(int(attempts)))
		retry = &t
	}
	w.S.Log.InfoContext(ctx, "document not embedded for the target profile", "document", doc.ID, "code", o.Code, "permanent", permanent, "err", err)
	return 0, q.UpsertSetFailure(ctx, dbgen.UpsertSetFailureParams{
		DocumentID: doc.ID, ProfileID: target.Profile.ID, SourceID: src.ID, Version: doc.Version,
		ErrorCode: o.Code, ErrorMessage: o.Message, Permanent: permanent, RetryAfter: retry,
	})
}

// backoff is the wait before retrying a temporary failure: 30 s, 2 min,
// 8 min, plus up to 20% jitter.
func backoff(attempt int) time.Duration {
	d := 30 * time.Second << (2 * min(attempt, 4))
	return d + time.Duration(rand.Int64N(int64(d/5)+1))
}

// finishSet runs when no document is pending: documents waiting after a
// temporary error snooze the job; a complete set lets its migrations
// switch; failures notify the admins.
func (s *Service) finishSet(ctx context.Context, q *dbgen.Queries, args ingest.SetArgs) error {
	pr, err := q.EmbeddingSetProgress(ctx, dbgen.EmbeddingSetProgressParams{SourceID: args.SourceID, ProfileID: args.ProfileID})
	if err != nil {
		return err
	}
	if pr.Waiting > 0 {
		return river.JobSnooze(max(time.Until(pr.NextRetry), time.Second))
	}
	migrations, err := q.RunningMigrationsForSet(ctx, dbgen.RunningMigrationsForSetParams{SourceID: args.SourceID, ProfileID: args.ProfileID})
	if err != nil {
		return err
	}
	if pr.Done < pr.Documents {
		for _, id := range migrations {
			if err := s.notifyAttention(ctx, id); err != nil {
				return err
			}
		}
		return nil
	}
	if err := q.MarkEmbeddingSetReady(ctx, dbgen.MarkEmbeddingSetReadyParams{SourceID: args.SourceID, ProfileID: args.ProfileID}); err != nil {
		return err
	}
	for _, id := range migrations {
		if err := s.Advance(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
