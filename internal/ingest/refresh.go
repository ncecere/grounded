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
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/boilerplate"
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
	// Count when the source's pages have settled: documents still being
	// processed would be missed now and re-checked later.
	idle := w.IdleWait
	if idle <= 0 {
		idle = 30 * time.Minute
	}
	if n, err := q.CountSourceInflight(ctx, src.ID); err != nil {
		return err
	} else if n > 0 && time.Since(job.CreatedAt) < idle {
		return river.JobSnooze(idlePoll) // one indexed count per poll
	}
	r := &refresh{p: p, q: q, src: src}
	deadline := time.Now().Add(w.budget())
	for {
		// Maintenance mode: re-chunking waits (between bounded steps).
		if paused, err := p.Maintenance.Paused(ctx); err != nil {
			return err
		} else if paused {
			return river.JobSnooze(maintenancePoll)
		}
		done, err := r.step(ctx)
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

// refresh is one source's refresh.
type refresh struct {
	p   *Processor
	q   *dbgen.Queries
	src dbgen.DataSource
}

// step does one bounded unit of work and reports whether none was left.
func (r *refresh) step(ctx context.Context) (bool, error) {
	row, err := r.q.GetSourceBoilerplate(ctx, r.src.ID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return true, nil
	} else if err != nil {
		return false, err
	}
	eff := r.p.Boilerplate.Resolve(r.src.Type, SettingsOf(row.Enabled.Bool, row.Enabled.Valid, row.MinDocs, row.Ratio))
	if eff.Enabled {
		if n, err := r.backfill(ctx); err != nil || n > 0 {
			return false, err
		}
	}
	if due(row) {
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

// readParsed reads the parsed Markdown stored next to an original.
func (p *Processor) readParsed(ctx context.Context, blobKey string) (string, error) {
	key := parsedKey(blobKey)
	if key == "" {
		return "", errNoParsed
	}
	data, err := p.read(ctx, key)
	return string(data), err
}

var errNoParsed = errors.New("no parsed text stored")

// classified is a source's classification: hash -> the block's row.
type classified map[int64]dbgen.ListBoilerplateBlocksRow

func (c classified) canonical() map[int64]uuid.NullUUID {
	out := make(map[int64]uuid.NullUUID, len(c))
	for h, b := range c {
		out[h] = b.CanonicalDocumentID
	}
	return out
}

// classify recounts the source's blocks and stores the new classification.
// The revision moves only when the set of blocks or a canonical copy
// changed, since only that changes what documents drop.
func (r *refresh) classify(ctx context.Context, row dbgen.SourceBoilerplate, eff boilerplate.Effective) error {
	docs, err := r.q.CountSourceBlockDocuments(ctx, r.src.ID)
	if err != nil {
		return err
	}
	threshold := eff.Threshold(int(docs))
	next := classified{}
	if eff.Enabled {
		if next, err = r.count(ctx, threshold); err != nil {
			return err
		}
	}
	old, err := r.load(ctx)
	if err != nil {
		return err
	}
	changed := len(old) != len(next)
	for h, b := range next {
		o, ok := old[h]
		changed = changed || !ok || o.CanonicalDocumentID != b.CanonicalDocumentID
		if ok && o.Sample != "" {
			b.Sample = o.Sample
			next[h] = b
		}
	}
	if err := r.addSamples(ctx, next); err != nil {
		return err
	}
	rev := row.Rev
	if changed {
		rev++
	}
	return pgx.BeginFunc(ctx, r.p.Pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if err := q.DeleteBoilerplateBlocks(ctx, r.src.ID); err != nil {
			return err
		}
		if err := insertBlocks(ctx, tx, r.src.ID, next); err != nil {
			return err
		}
		// Handled up to the request read above; a later one stays due.
		return q.FinishBoilerplateRefresh(ctx, dbgen.FinishBoilerplateRefreshParams{
			SourceID: r.src.ID, Rev: rev, Documents: int32(docs), Threshold: int32(threshold), RefreshedAt: row.RequestedAt,
		})
	})
}

// count finds the blocks in at least threshold documents and their
// canonical copies.
func (r *refresh) count(ctx context.Context, threshold int) (classified, error) {
	rows, err := r.q.RepeatedBlocks(ctx, dbgen.RepeatedBlocksParams{SourceID: r.src.ID, Threshold: int32(threshold)})
	if err != nil || len(rows) == 0 {
		return classified{}, err
	}
	out := make(classified, len(rows))
	hashes := make([]int64, len(rows))
	for i, b := range rows {
		hashes[i] = b.BlockHash
		out[b.BlockHash] = dbgen.ListBoilerplateBlocksRow{BlockHash: b.BlockHash, DocCount: b.Docs}
	}
	canon, err := r.q.CanonicalDocuments(ctx, dbgen.CanonicalDocumentsParams{SourceID: r.src.ID, Hashes: hashes})
	if err != nil {
		return nil, err
	}
	for _, c := range canon {
		b := out[c.BlockHash]
		b.CanonicalDocumentID = uuid.NullUUID{UUID: c.DocumentID, Valid: true}
		out[c.BlockHash] = b
	}
	return out, nil
}

func (r *refresh) load(ctx context.Context) (classified, error) {
	rows, err := r.q.ListBoilerplateBlocks(ctx, r.src.ID)
	if err != nil {
		return nil, err
	}
	out := make(classified, len(rows))
	for _, b := range rows {
		out[b.BlockHash] = b
	}
	return out, nil
}

// addSamples fills in the display text of blocks without one, from their
// canonical document's parsed text.
func (r *refresh) addSamples(ctx context.Context, c classified) error {
	byDoc := map[uuid.UUID][]int64{}
	for h, b := range c {
		if b.Sample == "" && b.CanonicalDocumentID.Valid {
			byDoc[b.CanonicalDocumentID.UUID] = append(byDoc[b.CanonicalDocumentID.UUID], h)
		}
	}
	for id, hashes := range byDoc {
		doc, err := r.q.GetDocument(ctx, id)
		if errors.Is(store.NotFound(err), store.ErrNotFound) {
			continue
		} else if err != nil {
			return err
		}
		md, err := r.p.readParsed(ctx, doc.BlobKey)
		if err != nil {
			continue // shown without text
		}
		for _, b := range chunk.Blocks(md) {
			if h := boilerplate.Hash(b.Text); slices.Contains(hashes, h) && c[h].Sample == "" {
				row := c[h]
				row.Sample = boilerplate.Sample(b.Text)
				c[h] = row
			}
		}
	}
	return nil
}

// insertBlocksSQL writes a classification in one statement.
const insertBlocksSQL = `
INSERT INTO source_boilerplate_blocks (source_id, block_hash, doc_count, sample, canonical_document_id)
SELECT $1, u.h, u.c, u.s, u.d
FROM unnest($2::bigint[], $3::int[], $4::text[], $5::uuid[]) AS u(h, c, s, d)`

func insertBlocks(ctx context.Context, tx pgx.Tx, sourceID uuid.UUID, c classified) error {
	if len(c) == 0 {
		return nil
	}
	hashes, counts, samples, docs := make([]int64, 0, len(c)), make([]int32, 0, len(c)), make([]string, 0, len(c)), make([]uuid.NullUUID, 0, len(c))
	for h, b := range c {
		hashes, counts, samples, docs = append(hashes, h), append(counts, b.DocCount), append(samples, b.Sample), append(docs, b.CanonicalDocumentID)
	}
	_, err := tx.Exec(ctx, insertBlocksSQL, sourceID, hashes, counts, samples, docs)
	return err
}

// applyStale brings a batch of documents chunked under an older revision up
// to date: those whose dropped blocks are unchanged only move to the new
// revision; the others are re-chunked. It returns how many documents it
// looked at.
func (r *refresh) applyStale(ctx context.Context, rev int32, enabled bool) (int, error) {
	rows, err := r.q.StaleDocumentBlocks(ctx, dbgen.StaleDocumentBlocksParams{SourceID: r.src.ID, Rev: rev, MaxRows: staleBatch})
	if err != nil || len(rows) == 0 {
		return 0, err
	}
	var set map[int64]uuid.NullUUID
	if enabled {
		c, err := r.load(ctx)
		if err != nil {
			return 0, err
		}
		set = c.canonical()
	}
	var same []uuid.UUID
	rechunked := 0
	for _, d := range rows {
		if sameDrops(candidateDrops(d.Hashes, set, d.DocumentID), d.Dropped) {
			same = append(same, d.DocumentID)
			continue
		}
		if rechunked == rechunkBatch {
			continue // the next step
		}
		rechunked++
		if err := r.p.rechunk(ctx, r.src, d, set, rev); err != nil {
			return 0, err
		}
	}
	if len(same) > 0 {
		if err := r.q.SetDocumentBlocksRev(ctx, dbgen.SetDocumentBlocksRevParams{Rev: rev, DocumentIds: same}); err != nil {
			return 0, err
		}
	}
	return len(rows), nil
}

// candidateDrops is what a document would drop under set, before the
// only-content guard (which needs the full parsed text).
func candidateDrops(hashes []int64, set map[int64]uuid.NullUUID, docID uuid.UUID) []int64 {
	var out []int64
	for _, h := range hashes {
		if dropsIn(set, h, docID) {
			out = append(out, h)
		}
	}
	return out
}

func sameDrops(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	a, b = slices.Clone(a), slices.Clone(b)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}

// SweepArgs enqueues refreshes that are due but have no job: requested
// while a refresh was finishing, by code without a River client, or seeded
// by the migration.
type SweepArgs struct{}

func (SweepArgs) Kind() string { return "boilerplate.sweep" }

func (SweepArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByPeriod: time.Minute}}
}

// SweepWorker runs boilerplate.sweep.
type SweepWorker struct {
	river.WorkerDefaults[SweepArgs]
	Queries *dbgen.Queries
}

func (w *SweepWorker) Work(ctx context.Context, _ *river.Job[SweepArgs]) error {
	ids, err := w.Queries.SourcesDueForBoilerplate(ctx)
	if err != nil || len(ids) == 0 {
		return err
	}
	client, err := river.ClientFromContextSafely[pgx.Tx](ctx)
	if err != nil {
		return err
	}
	params := make([]river.InsertManyParams, len(ids))
	for i, id := range ids {
		params[i] = river.InsertManyParams{Args: RefreshArgs{SourceID: id}}
	}
	_, err = client.InsertMany(ctx, params)
	return err
}
