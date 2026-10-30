// Near-duplicate boilerplate matching in the ingestion layer (DESIGN.md §5.5,
// #23, opt-in): the sketches recorded with each document's blocks, the
// refresh job's backfill of them, and the clusters the classification adds
// to the exact repeated blocks. The sketches and the clustering are in
// internal/boilerplate; this file reads and writes them.

package ingest

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// blockSketches are the eligible blocks of one document: distinct hashes and
// their sketches, packed in the same order.
type blockSketches struct {
	hashes []int64
	packed []byte
}

// sketchBlocks sketches the blocks of a document that are eligible for
// near-duplicate matching (boilerplate.MinWords words or more).
func sketchBlocks(blocks []chunk.Block) *blockSketches {
	out := &blockSketches{hashes: []int64{}, packed: []byte{}}
	seen := map[int64]bool{}
	for _, b := range blocks {
		h := boilerplate.Hash(b.Text)
		if h == 0 || seen[h] {
			continue
		}
		seen[h] = true
		if s, ok := boilerplate.SketchOf(b.Text); ok {
			out.hashes = append(out.hashes, h)
			out.packed = append(out.packed, s[:]...)
		}
	}
	return out
}

// recordSketches stores a document's sketches next to its block hashes; nil
// (near-duplicate matching is off for the document) clears any stored
// before, which belong to an older version of its text.
func recordSketches(ctx context.Context, q *dbgen.Queries, docID uuid.UUID, s *blockSketches) error {
	p := dbgen.SetDocumentSketchesParams{DocumentID: docID, FuzzyHashes: []int64{}, Sketches: []byte{}}
	if s != nil {
		p.SketchVersion, p.FuzzyHashes, p.Sketches = boilerplate.SketchVersion, s.hashes, s.packed
	}
	return q.SetDocumentSketches(ctx, p)
}

// backfillSketches records the sketches of ready documents processed before
// near-duplicate matching was switched on, from their stored parsed text.
func (r *refresh) backfillSketches(ctx context.Context) (int, error) {
	docs, err := r.q.DocumentsMissingSketches(ctx, dbgen.DocumentsMissingSketchesParams{
		SourceID: r.src.ID, SketchVersion: boilerplate.SketchVersion, MaxRows: backfillBatch})
	if err != nil {
		return 0, err
	}
	for _, d := range docs {
		s := &blockSketches{hashes: []int64{}, packed: []byte{}}
		if md, err := r.p.readParsed(ctx, d.BlobKey); err == nil {
			s = sketchBlocks(chunk.Blocks(md))
		} else {
			// Without parsed text the document can't take part; an empty
			// record keeps it from being retried on every refresh.
			r.p.Log.WarnContext(ctx, "no parsed text for near-duplicate matching", "document", d.ID, "err", err)
		}
		if err := recordSketches(ctx, r.q, d.ID, s); err != nil {
			return 0, err
		}
	}
	return len(docs), nil
}

// fuzzyStreamSQL streams a source's ready documents with their sketches, in
// the order that decides which keeps a cluster's copy (the same as the exact
// blocks': the shortest URL, then the lowest ID).
const fuzzyStreamSQL = `
SELECT d.id, db.fuzzy_hashes, db.sketches
FROM document_blocks db
JOIN documents d ON d.id = db.document_id AND d.status = 'ready'
WHERE db.source_id = $1 AND db.sketch_version = $2 AND cardinality(db.fuzzy_hashes) > 0
ORDER BY length(d.external_id), d.external_id, d.id`

// fuzzyClusters finds a source's near-duplicate clusters that reach
// threshold documents. It reads the documents three times in one snapshot
// (boilerplate.Clusters) and holds neither the documents nor their blocks.
// ids[ref] is the document of a cluster's First. exceeded reports that a
// limit was hit and the source is classified by exact blocks alone.
func (p *Processor) fuzzyClusters(ctx context.Context, sourceID uuid.UUID, threshold int) (clusters []boilerplate.Cluster, ids []uuid.UUID, exceeded bool, err error) {
	tx, err := p.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	stream := func(yield func(boilerplate.FuzzyDoc) bool) error {
		rows, err := tx.Query(ctx, fuzzyStreamSQL, sourceID, boilerplate.SketchVersion)
		if err != nil {
			return err
		}
		defer rows.Close()
		for pos := 0; rows.Next(); pos++ {
			var id uuid.UUID
			var hashes []int64
			var packed []byte
			if err := rows.Scan(&id, &hashes, &packed); err != nil {
				return err
			}
			if pos == len(ids) {
				ids = append(ids, id) // the first pass; later passes see the same order
			}
			if len(packed) != len(hashes)*boilerplate.SketchValues {
				p.Log.WarnContext(ctx, "skipping a document with inconsistent sketches", "document", id)
				continue
			}
			doc := boilerplate.FuzzyDoc{Ref: pos, Blocks: make([]boilerplate.FuzzyBlock, len(hashes))}
			for i, h := range hashes {
				doc.Blocks[i].Hash = h
				copy(doc.Blocks[i].Sketch[:], packed[i*boilerplate.SketchValues:])
			}
			if !yield(doc) {
				return nil
			}
		}
		return rows.Err()
	}
	clusters, exceeded, err = boilerplate.Clusters(stream, threshold, boilerplate.DefaultLimits)
	return clusters, ids, exceeded, err
}

// addClusters adds a source's near-duplicate clusters to its exact
// classification: every variant is classified with the cluster's document
// count and canonical document, and the cluster's first block stands for it
// in lists. A variant that was classified exactly takes the cluster's values.
func (p *Processor) addClusters(ctx context.Context, sourceID uuid.UUID, threshold int, c classified) error {
	clusters, ids, exceeded, err := p.fuzzyClusters(ctx, sourceID, threshold)
	if err != nil {
		return err
	}
	if exceeded {
		p.Log.WarnContext(ctx, "near-duplicate matching skipped: the source has too many candidate blocks; only exact repeats are classified", "source", sourceID)
		return nil
	}
	for _, cl := range clusters {
		if cl.First < 0 || cl.First >= len(ids) {
			return fmt.Errorf("near-duplicate cluster %d has no canonical document", cl.Center)
		}
		canonical := uuid.NullUUID{UUID: ids[cl.First], Valid: true}
		for _, h := range cl.Members {
			row := dbgen.ListBoilerplateBlocksRow{BlockHash: h, DocCount: int32(cl.Docs), CanonicalDocumentID: canonical, Variants: 1}
			if h == cl.Center {
				row.Variants = int32(len(cl.Members))
			} else {
				center := cl.Center
				row.MemberOf = &center
			}
			c[h] = row
		}
	}
	return nil
}

// errSetNotClassified: a candidate profile that asks for near-duplicate
// matching has no classification for the source yet; the document is tried
// again once it has (never cut with the live drops by mistake).
var errSetNotClassified = errors.New("the preview's boilerplate classification is not ready for this source")
