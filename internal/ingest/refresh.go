// The boilerplate.refresh job (ADR-0021): after a crawl run, an upload
// batch, a deletion or a settings change, it recounts a source's repeated
// blocks, updates the classification, and re-chunks the documents whose
// dropped blocks change, from their stored parsed text. Early pages of a
// crawl are indexed before the counts are known; this job makes the result
// independent of the order pages arrived in.
//
// Every step is idempotent and bounded (backfillBatch, staleBatch,
// rechunkBatch per step; Budget per invocation, then the job snoozes
// itself), so a large source is processed in slices and a restart resumes
// where it stopped.

package ingest

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Bounds of one refresh step.
const (
	backfillBatch = 50  // documents whose blocks are recorded from parsed text
	staleBatch    = 200 // documents re-checked against a new classification
	rechunkBatch  = 20  // of those, documents re-chunked (and re-embedded)

	idlePoll = 5 * time.Second // how often a refresh checks for documents in flight

	// maintenancePoll is how often a refresh parked by maintenance mode
	// checks whether it has ended.
	maintenancePoll = 10 * time.Second
)

// RefreshArgs refreshes one source's boilerplate classification.
type RefreshArgs struct {
	SourceID uuid.UUID `json:"sourceId"`
}

func (RefreshArgs) Kind() string { return "boilerplate.refresh" }

func (RefreshArgs) InsertOpts() river.InsertOpts {
	// One job per source waiting or running. A request that lands while a
	// refresh is finishing (still marked running) inserts nothing; the
	// sweep picks it up within a minute.
	return river.InsertOpts{Queue: Queue, MaxAttempts: 10, UniqueOpts: river.UniqueOpts{ByArgs: true, ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning,
		rivertype.JobStateRetryable, rivertype.JobStateScheduled,
	}}}
}

// RequestRefresh marks a source's classification as due and, when client
// is set, enqueues its refresh in tx. Without a client the periodic sweep
// enqueues it.
func RequestRefresh(ctx context.Context, client *river.Client[pgx.Tx], tx pgx.Tx, sourceID uuid.UUID) error {
	if err := dbgen.New(tx).RequestBoilerplateRefresh(ctx, sourceID); err != nil {
		return err
	}
	if client == nil {
		return nil
	}
	_, err := client.InsertTx(ctx, tx, RefreshArgs{SourceID: sourceID}, nil)
	return err
}

// RefreshWorker runs boilerplate.refresh jobs.
type RefreshWorker struct {
	river.WorkerDefaults[RefreshArgs]
	P *Processor
	// IdleWait is how long a refresh waits for the source's documents in
	// flight to finish before counting anyway (default 30 min).
	IdleWait time.Duration
	// Budget is the work time per invocation (default 5 min).
	Budget time.Duration
}

func (w *RefreshWorker) Timeout(*river.Job[RefreshArgs]) time.Duration {
	return w.budget() + 10*time.Minute
}

func (w *RefreshWorker) budget() time.Duration {
	if w.Budget > 0 {
		return w.Budget
	}
	return 5 * time.Minute
}

func (w *RefreshWorker) Work(ctx context.Context, job *river.Job[RefreshArgs]) error {
	p := w.P
	q := dbgen.New(p.Pool)
	src, err := q.GetSource(ctx, job.Args.SourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil
	} else if err != nil {
		return err
	}
	if src.Status != "active" {
		return nil // paused: the sweep resumes it once the source is active
	}
	idle := w.IdleWait
	if idle <= 0 {
		idle = 30 * time.Minute
	}
	// Count when the source's pages have settled: documents still being processed would be missed. This holds before every
	// count, not only the first: a request made while this job runs (another upload batch) is handled in the same loop, and a
	// document of that batch that finishes after the count matches the new classification, so it requests no recount and
	// would stay out of the counts until the next change.
	r := &refresh{p: p, q: q, src: src, settleUntil: job.CreatedAt.Add(idle)}
	deadline := time.Now().Add(w.budget())
	for {
		// Maintenance mode: re-chunking waits (between bounded steps).
		if paused, err := p.Maintenance.Paused(ctx); err != nil {
			return err
		} else if paused {
			return river.JobSnooze(maintenancePoll)
		}
		done, err := r.step(ctx)
		if errors.Is(err, errUnsettled) {
			return river.JobSnooze(idlePoll) // one indexed count per poll
		}
		if d, ok := backpressure(err); ok {
			return river.JobSnooze(d)
		} else if err != nil {
			return err
		}
		if done {
			return nil
		}
		if time.Now().After(deadline) {
			return river.JobSnooze(0) // continue in a new invocation
		}
	}
}

// errUnsettled: the source has documents in flight, so counting now would miss them; the job waits (until settleUntil).
var errUnsettled = errors.New("boilerplate refresh: documents in flight")

// refresh is one source's refresh.
type refresh struct {
	p   *Processor
	q   *dbgen.Queries
	src dbgen.DataSource
	// settleUntil is how long a count waits for the source's documents in flight (the job's creation plus IdleWait); zero
	// counts at once.
	settleUntil time.Time
}

// settled reports whether the source's documents can be counted now: none in flight, or waiting for them took too long.
func (r *refresh) settled(ctx context.Context) error {
	if r.settleUntil.IsZero() || !time.Now().Before(r.settleUntil) {
		return nil
	}
	n, err := r.q.CountSourceInflight(ctx, r.src.ID)
	if err != nil {
		return err
	}
	if n > 0 {
		return errUnsettled
	}
	return nil
}

// step does one bounded unit of work and reports whether none was left.
func (r *refresh) step(ctx context.Context) (bool, error) {
	row, err := r.q.GetSourceBoilerplate(ctx, r.src.ID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return true, nil
	} else if err != nil {
		return false, err
	}
	eff := r.p.Boilerplate.Resolve(r.src.Type, SettingsOf(row.Enabled, row.Fuzzy, row.MinDocs, row.Ratio))
	if eff.Enabled {
		if n, err := r.backfill(ctx); err != nil || n > 0 {
			return false, err
		}
		if eff.Fuzzy {
			if n, err := r.backfillSketches(ctx); err != nil || n > 0 {
				return false, err
			}
		}
	}
	if due(row) {
		if err := r.settled(ctx); err != nil {
			return false, err
		}
		return false, r.classify(ctx, row, eff)
	}
	n, err := r.applyStale(ctx, row.Rev, eff.Enabled)
	return n == 0, err
}

func due(row dbgen.SourceBoilerplate) bool {
	return row.RequestedAt != nil && (row.RefreshedAt == nil || row.RequestedAt.After(*row.RefreshedAt))
}

// backfill records the blocks of ready documents processed before blocks
// were recorded (or before this feature), from their stored parsed text.
// Nothing was dropped from them.
func (r *refresh) backfill(ctx context.Context) (int, error) {
	docs, err := r.q.DocumentsMissingBlocks(ctx, dbgen.DocumentsMissingBlocksParams{SourceID: r.src.ID, MaxRows: backfillBatch})
	if err != nil {
		return 0, err
	}
	for _, d := range docs {
		var hashes []int64
		if md, err := r.p.readParsed(ctx, d.BlobKey); err == nil {
			hashes = decide(chunk.Blocks(md), nil, d.ID).hashes
		} else {
			// Without parsed text the document can't take part; an empty
			// row keeps it from being retried on every refresh.
			r.p.Log.WarnContext(ctx, "no parsed text for boilerplate counting", "document", d.ID, "err", err)
		}
		if err := r.q.UpsertDocumentBlocks(ctx, dbgen.UpsertDocumentBlocksParams{
			DocumentID: d.ID, SourceID: r.src.ID, Hashes: nonNilInts(hashes), Dropped: []int64{}, Rev: -1,
		}); err != nil {
			return 0, err
		}
	}
	return len(docs), nil
}
