package ingest

import (
	"context"
	"errors"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

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

// carrySamples keeps the display text of blocks whose canonical document is
// unchanged, so the refresh reads parsed text only for new or moved blocks, and
// reports whether the classification changed. A sample is only ever the text of
// the block in its current canonical document: reusing one from a refresh that
// picked another document made it depend on the order documents arrived in
// (a near-duplicate variant takes its cluster's canonical document).
func carrySamples(old, next classified) (changed bool) {
	changed = len(old) != len(next)
	for h, b := range next {
		o, ok := old[h]
		moved := !ok || o.CanonicalDocumentID != b.CanonicalDocumentID
		changed = changed || moved
		if !moved && o.Sample != "" {
			b.Sample = o.Sample
			next[h] = b
		}
	}
	return changed
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
			h := boilerplate.Hash(b.Text)
			if !slices.Contains(hashes, h) {
				continue
			}
			if row := c[h]; row.Sample == "" {
				row.Sample = boilerplate.Sample(b.Text)
				c[h] = row
			}
			// A cluster is shown by its first block, which the canonical
			// document may not have: it shows the variant it has.
			if m := c[h].MemberOf; m != nil && c[*m].Sample == "" {
				row := c[*m]
				row.Sample = boilerplate.Sample(b.Text)
				c[*m] = row
			}
		}
	}
	return nil
}

// insertBlocksSQL writes a classification in one statement.
const insertBlocksSQL = `
INSERT INTO source_boilerplate_blocks (source_id, block_hash, doc_count, sample, canonical_document_id, variants, member_of)
SELECT $1, u.h, u.c, u.s, u.d, u.v, u.m
FROM unnest($2::bigint[], $3::int[], $4::text[], $5::uuid[], $6::int[], $7::bigint[]) AS u(h, c, s, d, v, m)`

func insertBlocks(ctx context.Context, tx pgx.Tx, sourceID uuid.UUID, c classified) error {
	if len(c) == 0 {
		return nil
	}
	hashes, counts, samples, docs := make([]int64, 0, len(c)), make([]int32, 0, len(c)), make([]string, 0, len(c)), make([]uuid.NullUUID, 0, len(c))
	variants, members := make([]int32, 0, len(c)), make([]*int64, 0, len(c))
	for h, b := range c {
		hashes, counts, samples, docs = append(hashes, h), append(counts, b.DocCount), append(samples, b.Sample), append(docs, b.CanonicalDocumentID)
		variants, members = append(variants, max(b.Variants, 1)), append(members, b.MemberOf)
	}
	_, err := tx.Exec(ctx, insertBlocksSQL, sourceID, hashes, counts, samples, docs, variants, members)
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
