// Repeated-boilerplate suppression during document processing (DESIGN.md
// §5.5, ADR-0021): each document's blocks are hashed and recorded, and the
// blocks the source's current classification calls boilerplate are left out
// of its chunks. The classification itself is maintained by the
// boilerplate.refresh job (refresh.go).

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

// bpPlan is the boilerplate decision for one document.
type bpPlan struct {
	hashes  []int64         // distinct block hashes, recorded for counting
	dropped []int64         // hashes left out of the chunks
	rev     int32           // the source's classification revision applied
	drop    map[string]bool // block texts left out
	guarded bool            // everything would have been dropped; nothing was
}

// SourceBoilerplate reads a source's boilerplate settings and revision. A
// source without a row has no overrides and revision 0.
func SourceBoilerplate(ctx context.Context, q *dbgen.Queries, sourceID uuid.UUID) (boilerplate.Settings, int32, error) {
	row, err := q.GetSourceBoilerplate(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return boilerplate.Settings{}, 0, nil
	} else if err != nil {
		return boilerplate.Settings{}, 0, err
	}
	return SettingsOf(row.Enabled.Bool, row.Enabled.Valid, row.MinDocs, row.Ratio), row.Rev, nil
}

// SettingsOf converts stored overrides.
func SettingsOf(enabled, enabledSet bool, minDocs *int32, ratio *float64) boilerplate.Settings {
	var s boilerplate.Settings
	if enabledSet {
		s.Enabled = &enabled
	}
	if minDocs != nil {
		n := int(*minDocs)
		s.MinDocs = &n
	}
	if ratio != nil {
		r := *ratio
		s.Ratio = &r
	}
	return s
}

// planBoilerplate hashes a document's blocks and decides which to drop: the
// blocks classified as boilerplate for its source, except those this
// document keeps as the canonical copy.
func (p *Processor) planBoilerplate(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, docID uuid.UUID, blocks []chunk.Block) (bpPlan, error) {
	settings, rev, err := SourceBoilerplate(ctx, q, src.ID)
	if err != nil {
		return bpPlan{}, err
	}
	var classified map[int64]uuid.NullUUID
	if p.Boilerplate.Resolve(src.Type, settings).Enabled {
		hashes := make([]int64, 0, len(blocks))
		for _, b := range blocks {
			hashes = append(hashes, boilerplate.Hash(b.Text))
		}
		rows, err := q.BoilerplateBlocksIn(ctx, dbgen.BoilerplateBlocksInParams{SourceID: src.ID, Hashes: hashes})
		if err != nil {
			return bpPlan{}, err
		}
		classified = make(map[int64]uuid.NullUUID, len(rows))
		for _, r := range rows {
			classified[r.BlockHash] = r.CanonicalDocumentID
		}
	}
	plan := decide(blocks, classified, docID)
	plan.rev = rev
	if plan.guarded {
		p.Log.InfoContext(ctx, "document kept whole: it has nothing but repeated blocks", "document", docID, "source", src.ID)
	}
	return plan, nil
}

// decide hashes a document's blocks and drops those in classified (hash ->
// canonical document) unless this document is the block's canonical copy.
func decide(blocks []chunk.Block, classified map[int64]uuid.NullUUID, docID uuid.UUID) bpPlan {
	hashed := make([]boilerplate.Block, len(blocks))
	for i, b := range blocks {
		hashed[i] = boilerplate.Block{Hash: boilerplate.Hash(b.Text), Heading: b.Heading}
	}
	plan := bpPlan{hashes: boilerplate.Hashes(hashed)}
	if len(classified) == 0 {
		return plan
	}
	plan.dropped, plan.guarded = boilerplate.Drops(hashed, func(h int64) bool { return dropsIn(classified, h, docID) })
	plan.drop = dropTexts(blocks, hashed, plan.dropped)
	return plan
}

// dropsIn reports whether a document drops block h: it is classified and
// the document is not its canonical copy.
func dropsIn(classified map[int64]uuid.NullUUID, h int64, docID uuid.UUID) bool {
	c, ok := classified[h]
	return ok && (!c.Valid || c.UUID != docID)
}

// dropTexts maps the texts of dropped blocks for chunk.Options.DropBlock.
func dropTexts(blocks []chunk.Block, hashed []boilerplate.Block, dropped []int64) map[string]bool {
	if len(dropped) == 0 {
		return nil
	}
	out := map[string]bool{}
	for i, b := range blocks {
		if slices.Contains(dropped, hashed[i].Hash) {
			out[b.Text] = true
		}
	}
	return out
}

// recordBlocks stores a document's block hashes and what was dropped in tx.
// If the source's classification changed while the document was being
// processed, a refresh is requested so it is re-checked.
func recordBlocks(ctx context.Context, tx pgx.Tx, doc dbgen.Document, plan bpPlan) error {
	q := dbgen.New(tx)
	if err := q.UpsertDocumentBlocks(ctx, dbgen.UpsertDocumentBlocksParams{
		DocumentID: doc.ID, SourceID: doc.SourceID, Hashes: nonNilInts(plan.hashes), Dropped: nonNilInts(plan.dropped), Rev: plan.rev,
	}); err != nil {
		return err
	}
	rev, err := q.GetSourceBoilerplateRev(ctx, doc.SourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) || (err == nil && rev == plan.rev) {
		return nil
	} else if err != nil {
		return err
	}
	return RequestRefresh(ctx, jobsFromContext(ctx), tx, doc.SourceID)
}

func nonNilInts(s []int64) []int64 {
	if s == nil {
		return []int64{}
	}
	return s
}
