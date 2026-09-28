// Committing a processed document: its chunks and vectors replace the
// previous ones in one transaction, or the document is finished without
// chunks (failed or empty).

package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/vectorstore"
)

var errSuperseded = errors.New("document changed while processing")

// errProfileMoved: the source's profile changed (a profile migration
// switched) while the document was processed for the old one, and nothing
// keeps the old one's vectors: the document is processed again.
var errProfileMoved = errors.New("the source's embedding profile changed while processing")

// insertChunksSQL writes a document's chunks for one profile ($10) in one
// statement. heading paths are joined with U+001F per row.
const insertChunksSQL = `
INSERT INTO chunks (id, document_id, source_id, profile_id, ordinal, content, heading_path, page_start, page_end, token_count, content_tsv)
SELECT u.id, $1, $2, $10, u.ordinal, u.content,
       CASE WHEN u.headings = '' THEN '{}'::text[] ELSE string_to_array(u.headings, E'\x1f') END,
       u.page_start, u.page_end, u.tokens,
       to_tsvector('english', replace(u.headings, E'\x1f', ' ') || ' ' || u.content)
FROM unnest($3::uuid[], $4::int[], $5::text[], $6::text[], $7::int[], $8::int[], $9::int[])
     AS u(id, ordinal, content, headings, page_start, page_end, tokens)`

// commit replaces the document's chunks and vectors atomically, unless the
// document was replaced or deleted while it was being processed.
func (p *Processor) commit(ctx context.Context, doc dbgen.Document, res result) error {
	prof, err := p.ensureProfile(ctx, res.target)
	if err != nil {
		return err
	}
	n := len(res.chunks)
	ids := make([]uuid.UUID, n)
	ordinals, starts, ends, tokens := make([]int32, n), make([]int32, n), make([]int32, n), make([]int32, n)
	contents, headings := make([]string, n), make([]string, n)
	recs := make([]vectorstore.Record, n)
	total := 0
	for i, c := range res.chunks {
		ids[i] = uuid.New()
		ordinals[i], starts[i], ends[i], tokens[i] = int32(c.Ordinal), int32(c.PageStart), int32(c.PageEnd), int32(c.Tokens)
		contents[i] = strings.ToValidUTF8(c.Content, "\uFFFD")
		headings[i] = strings.Join(c.HeadingPath, "\x1f")
		recs[i] = vectorstore.Record{ChunkID: ids[i], SourceID: doc.SourceID, Vector: res.vectors[i]}
		total += c.Tokens
	}
	warnings, _ := json.Marshal(nonNil(res.parsed.Warnings))
	paused, err := p.paused(ctx)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		var version int32
		var status string
		err := tx.QueryRow(ctx, "SELECT version, status FROM documents WHERE id = $1 FOR UPDATE", doc.ID).Scan(&version, &status)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (version != doc.Version || status != "processing")) {
			return errSuperseded
		} else if err != nil {
			return err
		}
		q := dbgen.New(tx)
		if ok, err := setWritable(ctx, q, doc.SourceID, prof.ID); err != nil {
			return err
		} else if !ok {
			return errProfileMoved
		}
		if err := q.DeleteDocumentChunks(ctx, doc.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, insertChunksSQL, doc.ID, doc.SourceID, ids, ordinals, contents, headings, starts, ends, tokens, prof.ID); err != nil {
			return fmt.Errorf("insert chunks: %w", err)
		}
		if err := p.Vectors.Upsert(ctx, tx, prof, recs); err != nil {
			return fmt.Errorf("insert vectors: %w", err)
		}
		if err := q.FinishDocument(ctx, dbgen.FinishDocumentParams{
			ID: doc.ID, Status: StatusReady, Title: clip(res.parsed.Title, 500), Kind: string(res.kind),
			Parser: res.parsed.Parser, Pages: int32(res.parsed.Pages), Warnings: warnings,
			ChunkCount: int32(n), TokenCount: int32(total),
		}); err != nil {
			return err
		}
		if err := recordBlocks(ctx, tx, doc, res.plan); err != nil {
			return err
		}
		if err := setOCRRecord(ctx, q, doc, res.parsed.OCR); err != nil {
			return err
		}
		if err := recordUsage(ctx, q, doc, res, n); err != nil {
			return err
		}
		// The source's other profiles (a profile migration) embed the new
		// version in the background.
		if err := KickSets(ctx, jobsFromContext(ctx), tx, doc.SourceID, prof.ID); err != nil {
			return err
		}
		return p.refill(ctx, tx, paused)
	})
}

// recordUsage writes the document's embedding tokens and its processing to
// the usage ledger.
func recordUsage(ctx context.Context, q *dbgen.Queries, doc dbgen.Document, res result, n int) error {
	model := uuid.NullUUID{UUID: res.target.Model.ID, Valid: true}
	meta, _ := json.Marshal(map[string]any{"pages": res.parsed.Pages, "chunks": n, "parser": res.parsed.Parser})
	// The ledger keeps the proxy's figure (what budgets are charged in)
	// and Grounded's own count beside it: some proxies count characters,
	// not tokens (docs/DESIGN.md §18).
	tokens := res.usage.Reported
	if tokens <= 0 {
		tokens = res.usage.Counted
	}
	embedMeta, _ := json.Marshal(map[string]any{"countedTokens": res.usage.Counted, "requests": res.usage.Requests,
		"reportedByProxy": res.usage.Reported > 0})
	for _, u := range []dbgen.InsertUsageParams{
		{Kind: "embed_tokens", Quantity: int64(tokens), ModelID: model, Metadata: embedMeta},
		{Kind: "document_processed", Quantity: 1, Metadata: meta},
	} {
		u.TeamID, u.SourceID, u.DocumentID = doc.TeamID, uuid.NullUUID{UUID: doc.SourceID, Valid: true}, uuid.NullUUID{UUID: doc.ID, Valid: true}
		u.UserID = doc.UploadedBy
		if u.Metadata == nil {
			u.Metadata = json.RawMessage(`{}`)
		}
		if err := q.InsertUsage(ctx, u); err != nil {
			return err
		}
	}
	return nil
}

// ensureProfile creates the profile's vector table once per process. It
// must run before a transaction that writes chunks: creating the table (its
// foreign key to chunks) waits for such a transaction's locks.
func (p *Processor) ensureProfile(ctx context.Context, t catalog.EmbedTarget) (vectorstore.Profile, error) {
	prof := vectorstore.Profile{ID: t.Profile.ID, Dimensions: int(t.Profile.Dimensions), StorageType: t.Profile.StorageType}
	if _, ok := p.ensured.Load(prof.ID); !ok {
		if err := p.Vectors.EnsureProfile(ctx, prof); err != nil {
			return prof, err
		}
		p.ensured.Store(prof.ID, struct{}{})
	}
	return prof, nil
}

// finishWithoutChunks records a final failed/skipped status and removes any
// chunks from a previous version.
func (p *Processor) finishWithoutChunks(ctx context.Context, doc dbgen.Document, o outcome) error {
	paused, err := p.paused(ctx)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		var version int32
		err := tx.QueryRow(ctx, "SELECT version FROM documents WHERE id = $1 FOR UPDATE", doc.ID).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && version != doc.Version) {
			return nil
		} else if err != nil {
			return err
		}
		q := dbgen.New(tx)
		if err := q.DeleteDocumentChunks(ctx, doc.ID); err != nil {
			return err
		}
		if err := q.DeleteDocumentBlocks(ctx, doc.ID); err != nil {
			return err
		}
		if err := setOCRRecord(ctx, q, doc, nil); err != nil {
			return err
		}
		if err := q.FinishDocument(ctx, dbgen.FinishDocumentParams{
			ID: doc.ID, Status: o.status, ErrorCode: o.code, ErrorMessage: clip(o.message, 1000), Kind: string(o.kind), Warnings: json.RawMessage(`[]`),
		}); err != nil {
			return err
		}
		return p.refill(ctx, tx, paused)
	})
}

// refill fills the slot this document frees, in its commit transaction tx:
// it runs the dispatch there when the Processor has a Dispatcher (in a
// savepoint, so a failed dispatch never fails the document; the kick is
// the fallback), and otherwise kicks a dispatch job. Maintenance mode leaves
// the slot to the periodic dispatch, which waits until it ends.
func (p *Processor) refill(ctx context.Context, tx pgx.Tx, paused bool) error {
	client := jobsFromContext(ctx)
	if client == nil {
		return nil // not running under River (tests)
	}
	return p.refillWith(ctx, tx, client, paused)
}

// paused reads maintenance mode for refill. Call it before opening the
// commit transaction: the gate may read the database from the pool, and
// asking for a second connection while holding one can exhaust a small pool
// (every ingest worker holding one and waiting for another).
func (p *Processor) paused(ctx context.Context) (bool, error) {
	if p.Dispatcher == nil {
		return false, nil
	}
	return p.Maintenance.Paused(ctx)
}

func (p *Processor) refillWith(ctx context.Context, tx pgx.Tx, client *river.Client[pgx.Tx], paused bool) error {
	if p.Dispatcher == nil {
		return Kick(ctx, client, tx)
	}
	if paused {
		return nil
	}
	err := pgx.BeginFunc(ctx, tx, func(sp pgx.Tx) error {
		_, err := p.Dispatcher.Dispatch(ctx, sp, client)
		return err
	})
	if err != nil {
		if ctx.Err() != nil {
			return err
		}
		p.Log.Warn("inline dispatch failed; kicking the dispatcher", "err", err)
		return Kick(ctx, client, tx)
	}
	return nil
}

// kickFromWorker schedules the next dispatch when a slot frees up.
func kickFromWorker(ctx context.Context, tx pgx.Tx) error {
	client := jobsFromContext(ctx)
	if client == nil {
		return nil // not running under River (tests)
	}
	return Kick(ctx, client, tx)
}

// jobsFromContext is the River client working the current job, or nil.
func jobsFromContext(ctx context.Context) *river.Client[pgx.Tx] {
	client, err := river.ClientFromContextSafely[pgx.Tx](ctx)
	if err != nil {
		return nil
	}
	return client
}
