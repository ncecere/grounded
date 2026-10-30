// Index preview with near-duplicate boilerplate matching (DESIGN.md §5.5,
// #23): a candidate profile that asks for it cuts each source's documents
// with a classification of its own, taken once when the source's set starts
// and stored with the set. It is made by the code of the refresh
// (classifyBlocks) from the same stored hashes and sketches, so applying the
// setting to the source drops the same blocks.

package ingest

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// PrepareSetBoilerplate classifies src for a candidate profile that asks for
// near-duplicate matching, once: it records the hashes and sketches of
// documents that lack them (from their stored parsed text, as the refresh
// does), counts, and stores the blocks the candidate's passages leave out.
// Nothing is stored for the live index. It stops filling in at deadline and
// reports false; call it again. For any other profile it does nothing.
func (p *Processor) PrepareSetBoilerplate(ctx context.Context, src dbgen.DataSource, prof dbgen.EmbeddingProfile, deadline time.Time) (bool, error) {
	if !prof.BoilerplateFuzzy || src.EmbeddingProfileID == prof.ID {
		return true, nil
	}
	q := dbgen.New(p.Pool)
	if _, err := q.GetSetBoilerplate(ctx, dbgen.GetSetBoilerplateParams{SourceID: src.ID, ProfileID: prof.ID}); err == nil {
		return true, nil
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, err
	}
	settings, _, err := SourceBoilerplate(ctx, q, src.ID)
	if err != nil {
		return false, err
	}
	eff := p.Boilerplate.Resolve(src.Type, settings)
	eff.Fuzzy = true
	r := &refresh{p: p, q: q, src: src}
	if eff.Enabled {
		if ready, err := r.fillIn(ctx, deadline); err != nil || !ready {
			return false, err
		}
	}
	docs, err := q.CountSourceBlockDocuments(ctx, src.ID)
	if err != nil {
		return false, err
	}
	threshold := eff.Threshold(int(docs))
	set := classified{}
	if eff.Enabled {
		if set, err = p.classifyBlocks(ctx, q, src.ID, eff, threshold); err != nil {
			return false, err
		}
	}
	return true, pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		if err := dbgen.New(tx).InsertSetBoilerplate(ctx, dbgen.InsertSetBoilerplateParams{
			SourceID: src.ID, ProfileID: prof.ID, Documents: int32(docs), Threshold: int32(threshold)}); err != nil {
			return err
		}
		return insertSetBlocks(ctx, tx, src.ID, prof.ID, set)
	})
}

// fillIn records the hashes and sketches the documents lack, until none are
// left (true) or the deadline passes (false).
func (r *refresh) fillIn(ctx context.Context, deadline time.Time) (bool, error) {
	for _, step := range []func(context.Context) (int, error){r.backfill, r.backfillSketches} {
		for {
			n, err := step(ctx)
			if err != nil {
				return false, err
			} else if n == 0 {
				break
			} else if time.Now().After(deadline) {
				return false, nil
			}
		}
	}
	return true, nil
}

const insertSetBlocksSQL = `
INSERT INTO set_boilerplate_blocks (source_id, profile_id, block_hash, canonical_document_id)
SELECT $1, $2, u.h, u.d FROM unnest($3::bigint[], $4::uuid[]) AS u(h, d)
ON CONFLICT DO NOTHING`

func insertSetBlocks(ctx context.Context, tx pgx.Tx, sourceID, profileID uuid.UUID, c classified) error {
	if len(c) == 0 {
		return nil
	}
	hashes, docs := make([]int64, 0, len(c)), make([]uuid.NullUUID, 0, len(c))
	for h, b := range c {
		hashes, docs = append(hashes, h), append(docs, b.CanonicalDocumentID)
	}
	_, err := tx.Exec(ctx, insertSetBlocksSQL, sourceID, profileID, hashes, docs)
	return err
}

// previewPlan decides which blocks of a document a preview's passages leave
// out under the preview's classification of the source: the same decision as
// at ingestion and in the refresh (decide).
func (p *Processor) previewPlan(ctx context.Context, q *dbgen.Queries, sourceID, docID, profileID uuid.UUID, blocks []chunk.Block) (bpPlan, error) {
	if _, err := q.GetSetBoilerplate(ctx, dbgen.GetSetBoilerplateParams{SourceID: sourceID, ProfileID: profileID}); errors.Is(store.NotFound(err), store.ErrNotFound) {
		return bpPlan{}, errSetNotClassified
	} else if err != nil {
		return bpPlan{}, err
	}
	hashes := make([]int64, len(blocks))
	for i, b := range blocks {
		hashes[i] = boilerplate.Hash(b.Text)
	}
	rows, err := q.SetBoilerplateBlocksIn(ctx, dbgen.SetBoilerplateBlocksInParams{SourceID: sourceID, ProfileID: profileID, Hashes: hashes})
	if err != nil {
		return bpPlan{}, err
	}
	set := make(map[int64]uuid.NullUUID, len(rows))
	for _, r := range rows {
		set[r.BlockHash] = r.CanonicalDocumentID
	}
	return decide(blocks, set, docID), nil
}
