// Re-chunking a ready document after its source's boilerplate
// classification changed (ADR-0021): from the stored parsed text, without
// fetching or parsing again. Chunks whose text, heading path and pages are
// unchanged keep their rows and vectors; only new chunks are embedded.

package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// rechunk re-chunks one stale document under classification set (hash ->
// canonical document; nil when suppression is off) at revision rev.
func (p *Processor) rechunk(ctx context.Context, src dbgen.DataSource, d dbgen.StaleDocumentBlocksRow, set map[int64]uuid.NullUUID, rev int32) error {
	q := dbgen.New(p.Pool)
	md, err := p.readParsed(ctx, d.BlobKey)
	if errors.Is(err, blob.ErrNotFound) || errors.Is(err, errNoParsed) {
		// No stored parsed text: process the document again from its
		// stored original (still no fetch).
		p.Log.InfoContext(ctx, "no parsed text; reprocessing document for boilerplate", "document", d.DocumentID)
		return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
			if err := dbgen.New(tx).ReprocessDocument(ctx, dbgen.ReprocessDocumentParams{ID: d.DocumentID, Version: d.Version}); err != nil {
				return err
			}
			return kickFromWorker(ctx, tx)
		})
	} else if err != nil {
		return err
	}
	blocks := chunk.Blocks(md)
	plan := decide(blocks, set, d.DocumentID)
	plan.rev = rev
	if sameDrops(plan.dropped, d.Dropped) {
		return q.SetDocumentBlocksRev(ctx, dbgen.SetDocumentBlocksRevParams{Rev: rev, DocumentIds: []uuid.UUID{d.DocumentID}})
	}
	target, err := p.Catalog.EmbedTarget(ctx, src.EmbeddingProfileID)
	if err != nil {
		return err
	}
	chunks, err := p.split(md, target, plan)
	if err != nil || len(chunks) == 0 {
		return err
	}
	existing, err := q.DocumentChunkKeys(ctx, dbgen.DocumentChunkKeysParams{DocumentID: d.DocumentID, ProfileID: target.Profile.ID})
	if err != nil {
		return err
	}
	reuse, fresh := matchChunks(chunks, existing)
	fc := make([]chunk.Chunk, len(fresh))
	for i, k := range fresh {
		fc[i] = chunks[k]
	}
	var vectors [][]float32
	var usage EmbedUsage
	if len(fc) > 0 {
		if vectors, usage, err = p.embed(ctx, target, p.embedTexts(target, d.Title, fc), d.TeamID); err != nil {
			return err
		}
	}
	return p.commitRechunk(ctx, src, d, target, plan, rechunked{chunks: chunks, reuse: reuse, fresh: fresh, vectors: vectors, usage: usage})
}

// chunkKey identifies a chunk's embedded input (the title is unchanged).
func chunkKey(content string, path []string, start, end int32) string {
	return fmt.Sprintf("%d:%d\x1e%s\x1e%s", start, end, strings.Join(path, "\x1f"), content)
}

// matchChunks pairs new chunks with existing rows of identical text: reuse[i]
// is the row kept for chunks[i] (uuid.Nil when new); fresh lists the
// indexes of new chunks.
func matchChunks(chunks []chunk.Chunk, existing []dbgen.DocumentChunkKeysRow) ([]uuid.UUID, []int) {
	rows := map[string][]uuid.UUID{}
	for _, e := range existing {
		k := chunkKey(e.Content, e.HeadingPath, e.PageStart, e.PageEnd)
		rows[k] = append(rows[k], e.ID)
	}
	reuse := make([]uuid.UUID, len(chunks))
	var fresh []int
	for i, c := range chunks {
		k := chunkKey(strings.ToValidUTF8(c.Content, "\uFFFD"), c.HeadingPath, int32(c.PageStart), int32(c.PageEnd))
		if ids := rows[k]; len(ids) > 0 {
			reuse[i], rows[k] = ids[0], ids[1:]
		} else {
			fresh = append(fresh, i)
		}
	}
	return reuse, fresh
}

// rechunked is a document's new chunk list.
type rechunked struct {
	chunks  []chunk.Chunk
	reuse   []uuid.UUID // per chunk: the kept row, or uuid.Nil
	fresh   []int       // indexes of new chunks, in vectors order
	vectors [][]float32
	usage   EmbedUsage
}

// commitRechunk replaces the document's chunk list in one transaction,
// unless the document changed meanwhile (a newer version is processed with
// the new classification anyway).
func (p *Processor) commitRechunk(ctx context.Context, src dbgen.DataSource, d dbgen.StaleDocumentBlocksRow, t catalog.EmbedTarget, plan bpPlan, rc rechunked) error {
	prof, err := p.ensureProfile(ctx, t) // before the transaction: see ensureProfile
	if err != nil {
		return err
	}
	keep, ords := []uuid.UUID{}, []int32{}
	total := 0
	for i, c := range rc.chunks {
		total += c.Tokens
		if rc.reuse[i] != uuid.Nil {
			keep, ords = append(keep, rc.reuse[i]), append(ords, int32(i))
		}
	}
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		var version int32
		var status string
		err := tx.QueryRow(ctx, "SELECT version, status FROM documents WHERE id = $1 FOR UPDATE", d.DocumentID).Scan(&version, &status)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (version != d.Version || status != StatusReady)) {
			return nil
		} else if err != nil {
			return err
		}
		if ok, err := setWritable(ctx, dbgen.New(tx), src.ID, prof.ID); err != nil {
			return err
		} else if !ok {
			return errProfileMoved // the refresh runs again with the source's new profile
		}
		if err := reorderChunks(ctx, tx, d.DocumentID, prof.ID, keep, ords); err != nil {
			return err
		}
		// The document's chunks for the source's other profiles (a profile
		// migration) are cut again from the new text in the background.
		if n, err := dbgen.New(tx).DeleteOtherProfileChunks(ctx, dbgen.DeleteOtherProfileChunksParams{DocumentID: d.DocumentID, ProfileID: prof.ID}); err != nil {
			return err
		} else if n > 0 {
			if err := KickSets(ctx, jobsFromContext(ctx), tx, src.ID, prof.ID); err != nil {
				return err
			}
		}
		if err := insertFresh(ctx, tx, p, src.ID, d.DocumentID, prof, rc); err != nil {
			return err
		}
		q := dbgen.New(tx)
		if err := q.SetDocumentChunkStats(ctx, dbgen.SetDocumentChunkStatsParams{ID: d.DocumentID, ChunkCount: int32(len(rc.chunks)), TokenCount: int32(total)}); err != nil {
			return err
		}
		// The passages changed: answers cached from the old ones go (migration 00042).
		if _, err := tx.Exec(ctx, "SELECT raise_kb_content_revision($1)", src.ID); err != nil {
			return err
		}
		if err := q.UpsertDocumentBlocks(ctx, dbgen.UpsertDocumentBlocksParams{
			DocumentID: d.DocumentID, SourceID: src.ID, Hashes: nonNilInts(plan.hashes), Dropped: nonNilInts(plan.dropped), Rev: plan.rev,
		}); err != nil {
			return err
		}
		return recordRechunkUsage(ctx, q, src, d, t, rc)
	})
}

// reorderChunks deletes the profile's rows not kept and gives kept rows
// their new ordinals (moved out of the way first: ordinals are unique per
// document and profile).
func reorderChunks(ctx context.Context, tx pgx.Tx, docID, profileID uuid.UUID, keep []uuid.UUID, ords []int32) error {
	if _, err := tx.Exec(ctx, "DELETE FROM chunks WHERE document_id = $1 AND profile_id = $3 AND NOT (id = ANY($2::uuid[]))", docID, keep, profileID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "UPDATE chunks SET ordinal = -1 - ordinal WHERE document_id = $1 AND profile_id = $2", docID, profileID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `UPDATE chunks c SET ordinal = u.o
FROM unnest($1::uuid[], $2::int[]) AS u(id, o) WHERE c.id = u.id`, keep, ords)
	return err
}

// insertFresh inserts the new chunks and their vectors.
func insertFresh(ctx context.Context, tx pgx.Tx, p *Processor, sourceID, docID uuid.UUID, prof vectorstore.Profile, rc rechunked) error {
	n := len(rc.fresh)
	if n == 0 {
		return nil
	}
	ids := make([]uuid.UUID, n)
	ordinals, starts, ends, tokens := make([]int32, n), make([]int32, n), make([]int32, n), make([]int32, n)
	contents, headings := make([]string, n), make([]string, n)
	recs := make([]vectorstore.Record, n)
	for j, i := range rc.fresh {
		c := rc.chunks[i]
		ids[j] = uuid.New()
		ordinals[j], starts[j], ends[j], tokens[j] = int32(i), int32(c.PageStart), int32(c.PageEnd), int32(c.Tokens)
		contents[j] = strings.ToValidUTF8(c.Content, "\uFFFD")
		headings[j] = strings.Join(c.HeadingPath, "\x1f")
		recs[j] = vectorstore.Record{ChunkID: ids[j], SourceID: sourceID, Vector: rc.vectors[j]}
	}
	if _, err := tx.Exec(ctx, insertChunksSQL, docID, sourceID, ids, ordinals, contents, headings, starts, ends, tokens, prof.ID); err != nil {
		return fmt.Errorf("insert chunks: %w", err)
	}
	return p.Vectors.Upsert(ctx, tx, prof, recs)
}

// recordRechunkUsage records the embedding tokens a re-chunk spent.
func recordRechunkUsage(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, d dbgen.StaleDocumentBlocksRow, t catalog.EmbedTarget, rc rechunked) error {
	if rc.usage.Requests == 0 && len(rc.fresh) == 0 {
		return nil
	}
	tokens := rc.usage.Reported
	if tokens <= 0 {
		tokens = rc.usage.Counted
	}
	meta, _ := json.Marshal(map[string]any{"countedTokens": rc.usage.Counted, "requests": rc.usage.Requests,
		"reportedByProxy": rc.usage.Reported > 0, "reason": "boilerplate", "chunks": len(rc.fresh)})
	return q.InsertUsage(ctx, dbgen.InsertUsageParams{
		Kind: "embed_tokens", Quantity: int64(tokens), ModelID: uuid.NullUUID{UUID: t.Model.ID, Valid: true}, Metadata: meta,
		TeamID: d.TeamID, UserID: d.UploadedBy, SourceID: uuid.NullUUID{UUID: src.ID, Valid: true},
		DocumentID: uuid.NullUUID{UUID: d.DocumentID, Valid: true},
	})
}
