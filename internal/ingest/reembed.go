// Embedding a ready document for another profile of its source (an
// embedding set; profile migration, docs/phase5-deploy.md §5 P2, ADR-0007).
// The stored parsed text is reused: the chunks of the source's own profile
// are copied when the chunk settings match, else the text is cut again with
// the target's settings. Nothing is fetched, and nothing is parsed again
// unless no parsed text was stored (documents processed before it was).

package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/ncecere/grounded/internal/blob"
	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/parse"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// SetArgs embeds a source's ready documents for one of its profiles. The
// worker lives in internal/profilemig; ingestion enqueues it when a
// document of a source with several profiles changes. FollowUp marks the
// job queued while another one for the set was running (see KickSet).
type SetArgs struct {
	SourceID  uuid.UUID `json:"sourceId"`
	ProfileID uuid.UUID `json:"profileId"`
	FollowUp  bool      `json:"followUp,omitempty"`
}

func (SetArgs) Kind() string { return "embedding_set.sync" }

func (SetArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: Queue, MaxAttempts: 25, UniqueOpts: river.UniqueOpts{ByArgs: true, ByState: []rivertype.JobState{
		rivertype.JobStateAvailable, rivertype.JobStatePending, rivertype.JobStateRunning,
		rivertype.JobStateRetryable, rivertype.JobStateScheduled,
	}}}
}

// KickSet enqueues, in tx, the embedding of a source's documents for a
// profile. One job per set waits at a time; when the one found is running
// (it may have scanned for documents already), a follow-up is queued, and
// the worker runs one job per set at a time.
func KickSet(ctx context.Context, client *river.Client[pgx.Tx], tx pgx.Tx, sourceID, profileID uuid.UUID) error {
	if client == nil {
		return nil // the sweep enqueues it
	}
	res, err := client.InsertTx(ctx, tx, SetArgs{SourceID: sourceID, ProfileID: profileID}, nil)
	if err != nil || !res.UniqueSkippedAsDuplicate || res.Job == nil || res.Job.State != rivertype.JobStateRunning {
		return err
	}
	_, err = client.InsertTx(ctx, tx, SetArgs{SourceID: sourceID, ProfileID: profileID, FollowUp: true}, nil)
	return err
}

// KickSets kicks a source's profiles other than except. Without a client
// the sweep enqueues them within a minute.
func KickSets(ctx context.Context, client *river.Client[pgx.Tx], tx pgx.Tx, sourceID, except uuid.UUID) error {
	if client == nil {
		return nil
	}
	profiles, err := dbgen.New(tx).SourceEmbeddingProfiles(ctx, sourceID)
	if err != nil {
		return err
	}
	for _, id := range profiles {
		if id == except {
			continue
		}
		if err := KickSet(ctx, client, tx, sourceID, id); err != nil {
			return err
		}
	}
	return nil
}

// Chunking is what decides a profile's chunks: two profiles with the same
// Chunking cut the same text into the same chunks.
type Chunking struct {
	MaxTokens, Overlap int
	Version            int32
}

// ChunkingOf returns a profile's chunking; maxInputTokens is its model's
// input limit (0 = none), which caps the chunk size.
func ChunkingOf(prof dbgen.EmbeddingProfile, maxInputTokens int) Chunking {
	maxTokens := int(prof.ChunkSize)
	if m := maxInputTokens; m > 0 && maxTokens > m-64 {
		maxTokens = max(m-64, 32) // leave room for the title/heading header
	}
	return Chunking{MaxTokens: maxTokens, Overlap: min(int(prof.ChunkOverlap), maxTokens/2), Version: prof.ChunkerVersion}
}

// Reembedded is what embedding one document for a set did.
type Reembedded struct {
	Chunks   int
	Rechunk  bool // cut again from the parsed text (not copied)
	Tokens   int
	Requests int
}

// ErrSuperseded reports that the document changed (or the set went away)
// while it was being embedded; nothing was written.
var ErrSuperseded = errSuperseded

// Reembed embeds one ready document of src for target and commits its
// chunks and vectors for the target's profile, replacing any it had.
func (p *Processor) Reembed(ctx context.Context, src dbgen.DataSource, doc dbgen.PendingSetDocumentsRow, target catalog.EmbedTarget) (Reembedded, error) {
	var out Reembedded
	chunks, rechunk, err := p.setChunks(ctx, src, doc, target)
	if err != nil {
		return out, err
	}
	if len(chunks) == 0 {
		return out, parse.ErrEmpty
	}
	title := doc.Title
	if title == "" {
		title = doc.Filename
	}
	vectors, usage, err := p.embed(ctx, target, p.embedTexts(target, title, chunks), doc.TeamID)
	if err != nil {
		return out, err
	}
	out = Reembedded{Chunks: len(chunks), Rechunk: rechunk, Tokens: usage.Counted, Requests: usage.Requests}
	return out, p.commitSet(ctx, src, doc, target, rechunked{chunks: chunks, vectors: vectors, usage: usage})
}

// setChunks are the document's chunks for target: copies of the chunks of
// the source's own profile when the chunking matches, else the parsed text
// cut with the target's settings (leaving out the boilerplate blocks the
// document dropped).
func (p *Processor) setChunks(ctx context.Context, src dbgen.DataSource, doc dbgen.PendingSetDocumentsRow, target catalog.EmbedTarget) ([]chunk.Chunk, bool, error) {
	q := dbgen.New(p.Pool)
	if own := src.EmbeddingProfileID; own != target.Profile.ID {
		// The own profile's model may be disabled already: only its
		// settings are read.
		row, err := q.GetEmbeddingProfile(ctx, own)
		if err != nil {
			return nil, false, err
		}
		if ChunkingOf(row.EmbeddingProfile, maxInput(row.Model)) == ChunkingOf(target.Profile, target.MaxInputTokens) {
			rows, err := q.ProfileDocumentChunks(ctx, dbgen.ProfileDocumentChunksParams{DocumentID: doc.ID, ProfileID: own})
			if err != nil {
				return nil, false, err
			}
			if len(rows) > 0 {
				return copiedChunks(rows), false, nil
			}
		}
	}
	md, err := p.readParsed(ctx, doc.BlobKey)
	if errors.Is(err, blob.ErrNotFound) || errors.Is(err, errNoParsed) {
		md, err = p.parseStored(ctx, src, doc)
	}
	if err != nil {
		return nil, false, err
	}
	dropped, err := q.GetDocumentDropped(ctx, doc.ID)
	if err != nil && !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return nil, false, err
	}
	chunks, err := p.split(md, target, planFromDropped(chunk.Blocks(md), dropped))
	return chunks, true, err
}

func maxInput(m dbgen.Model) int {
	if m.MaxInputTokens == nil {
		return 0
	}
	return int(*m.MaxInputTokens)
}

func copiedChunks(rows []dbgen.ProfileDocumentChunksRow) []chunk.Chunk {
	out := make([]chunk.Chunk, len(rows))
	for i, r := range rows {
		out[i] = chunk.Chunk{Ordinal: int(r.Ordinal), Content: r.Content, HeadingPath: r.HeadingPath,
			PageStart: int(r.PageStart), PageEnd: int(r.PageEnd), Tokens: int(r.TokenCount)}
	}
	return out
}

// planFromDropped drops the blocks the document dropped when it was
// processed (their hashes are recorded in document_blocks).
func planFromDropped(blocks []chunk.Block, dropped []int64) bpPlan {
	if len(dropped) == 0 {
		return bpPlan{}
	}
	hashed := make([]boilerplate.Block, len(blocks))
	for i, b := range blocks {
		hashed[i] = boilerplate.Block{Hash: boilerplate.Hash(b.Text), Heading: b.Heading}
	}
	return bpPlan{dropped: dropped, drop: dropTexts(blocks, hashed, dropped)}
}

// parseStored parses a document's stored original (no fetch), for documents
// without stored parsed text.
func (p *Processor) parseStored(ctx context.Context, src dbgen.DataSource, doc dbgen.PendingSetDocumentsRow) (string, error) {
	if doc.BlobKey == "" {
		return "", blob.ErrNotFound
	}
	p.Log.InfoContext(ctx, "no parsed text; parsing the stored original", "document", doc.ID)
	data, err := p.read(ctx, doc.BlobKey)
	if err != nil {
		return "", err
	}
	full := dbgen.Document{ID: doc.ID, Filename: doc.Filename, ExternalID: doc.ExternalID}
	if src.Type == "web" {
		if d, err := dbgen.New(p.Pool).GetDocument(ctx, doc.ID); err == nil {
			full = d
		}
	}
	parsed, _, err := p.parse(ctx, src, full, data)
	return parsed.Markdown, err
}

// commitSet replaces the document's chunks for the target's profile in one
// transaction, unless the document changed or the set is being deleted.
func (p *Processor) commitSet(ctx context.Context, src dbgen.DataSource, doc dbgen.PendingSetDocumentsRow, t catalog.EmbedTarget, rc rechunked) error {
	prof, err := p.ensureProfile(ctx, t) // before the transaction: see ensureProfile
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, p.Pool, func(tx pgx.Tx) error {
		var version int32
		var status string
		err := tx.QueryRow(ctx, "SELECT version, status FROM documents WHERE id = $1 FOR UPDATE", doc.ID).Scan(&version, &status)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (version != doc.Version || status != StatusReady)) {
			return errSuperseded
		} else if err != nil {
			return err
		}
		q := dbgen.New(tx)
		if ok, err := setWritable(ctx, q, src.ID, prof.ID); err != nil {
			return err
		} else if !ok {
			return errSuperseded
		}
		if err := q.DeleteProfileDocumentChunks(ctx, dbgen.DeleteProfileDocumentChunksParams{DocumentID: doc.ID, ProfileID: prof.ID}); err != nil {
			return err
		}
		all := make([]int, len(rc.chunks))
		for i := range all {
			all[i] = i
		}
		rc.fresh = all
		if err := insertFresh(ctx, tx, p, src.ID, doc.ID, prof, rc); err != nil {
			return err
		}
		if err := q.DeleteSetFailure(ctx, dbgen.DeleteSetFailureParams{DocumentID: doc.ID, ProfileID: prof.ID}); err != nil {
			return err
		}
		return recordSetUsage(ctx, q, src, doc, t, rc)
	})
}

// setWritable share-locks the set (or the source, for its own profile) and
// reports whether chunks may be written for the profile: the cleanup job
// marks a set deleting before removing its chunks.
func setWritable(ctx context.Context, q *dbgen.Queries, sourceID, profileID uuid.UUID) (bool, error) {
	status, err := q.LockEmbeddingSetShared(ctx, dbgen.LockEmbeddingSetSharedParams{SourceID: sourceID, ProfileID: profileID})
	if err == nil {
		return status != "deleting", nil
	} else if !errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, err
	}
	own, err := q.LockSourceProfileShared(ctx, sourceID)
	if errors.Is(store.NotFound(err), store.ErrNotFound) {
		return false, nil
	}
	return err == nil && own == profileID, err
}

// recordSetUsage records the embedding tokens of a document's re-embedding.
func recordSetUsage(ctx context.Context, q *dbgen.Queries, src dbgen.DataSource, doc dbgen.PendingSetDocumentsRow, t catalog.EmbedTarget, rc rechunked) error {
	tokens := rc.usage.Reported
	if tokens <= 0 {
		tokens = rc.usage.Counted
	}
	meta, _ := json.Marshal(map[string]any{"countedTokens": rc.usage.Counted, "requests": rc.usage.Requests,
		"reportedByProxy": rc.usage.Reported > 0, "reason": "profile_migration", "chunks": len(rc.chunks), "profileId": t.Profile.ID})
	return q.InsertUsage(ctx, dbgen.InsertUsageParams{
		Kind: "embed_tokens", Quantity: int64(tokens), ModelID: uuid.NullUUID{UUID: t.Model.ID, Valid: true}, Metadata: meta,
		TeamID: doc.TeamID, UserID: doc.UploadedBy, SourceID: uuid.NullUUID{UUID: src.ID, Valid: true},
		DocumentID: uuid.NullUUID{UUID: doc.ID, Valid: true},
	})
}

// SetOutcome classifies a failed re-embedding: permanent failures wait for
// an admin's retry; others are retried. Code and message are shown.
type SetOutcome struct {
	Code, Message string
	Permanent     bool
}

// ClassifySet classifies a re-embedding error (backpressure is handled by
// the caller before this).
func ClassifySet(err error) SetOutcome {
	o := classify(err)
	if o.code == "" {
		o.code = "processing_error"
	}
	return SetOutcome{Code: o.code, Message: clip(fmt.Sprint(o.message), 1000), Permanent: !o.retry}
}

// Backpressure reports whether err means the model asked Grounded to wait,
// and for how long.
func Backpressure(err error) (time.Duration, bool) { return backpressure(err) }
