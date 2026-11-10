package ingest

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

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
		if next, err = r.p.classifyBlocks(ctx, r.q, r.src.ID, eff, threshold); err != nil {
			return err
		}
	}
	old, err := r.load(ctx)
	if err != nil {
		return err
	}
	changed := carrySamples(old, next)
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

// classifyBlocks finds a source's boilerplate blocks at a threshold: the
// blocks in at least that many documents and, with near-duplicate matching
// on, the clusters of similar blocks in that many. It is the classification
// of the refresh and of an index preview alike.
func (p *Processor) classifyBlocks(ctx context.Context, q *dbgen.Queries, sourceID uuid.UUID, eff boilerplate.Effective, threshold int) (classified, error) {
	out, err := countRepeated(ctx, q, sourceID, threshold)
	if err != nil || !eff.Fuzzy {
		return out, err
	}
	return out, p.addClusters(ctx, sourceID, threshold, out)
}

// countRepeated finds the blocks in at least threshold documents and their
// canonical copies.
func countRepeated(ctx context.Context, q *dbgen.Queries, sourceID uuid.UUID, threshold int) (classified, error) {
	rows, err := q.RepeatedBlocks(ctx, dbgen.RepeatedBlocksParams{SourceID: sourceID, Threshold: int32(threshold)})
	if err != nil || len(rows) == 0 {
		return classified{}, err
	}
	out := make(classified, len(rows))
	hashes := make([]int64, len(rows))
	for i, b := range rows {
		hashes[i] = b.BlockHash
		out[b.BlockHash] = dbgen.ListBoilerplateBlocksRow{BlockHash: b.BlockHash, DocCount: b.Docs, Variants: 1}
	}
	canon, err := q.CanonicalDocuments(ctx, dbgen.CanonicalDocumentsParams{SourceID: sourceID, Hashes: hashes})
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
