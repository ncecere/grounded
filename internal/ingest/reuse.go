// Reusing a changed document's unchanged passages (#250). A new version of a page often differs by a few bytes (a
// timestamp, a token), and its passages but one are what they were: those keep their rows (and so their IDs, which
// citations and feedback name) and their vectors, and only the new passages are embedded. This is the boilerplate
// re-chunk's matching (rechunk.go, ADR-0021) applied to a new version.
//
// A passage's vector is a function of its embedded input: the profile's document prefix, then the title, heading path
// and content cut to the model's input limit (embedTexts). The heading path, pages and content are compared passage by
// passage (chunkKey). The rest is the same for every passage of the document, so it is recorded once per document when
// its chunks are written (metadata.embed: the profile and a digest of the model, prefix, input limit and title) and
// compared before any row is reused. A document without that record (indexed before #250), or with another, is
// embedded whole. With contextual chunks a passage's input also has its section's context, so every passage is
// embedded again as in the re-chunk (docs/contextual-chunks.md section 4).

package ingest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// embedRecord is metadata.embed: what every passage of the document was embedded with, besides its own text.
type embedRecord struct {
	Profile uuid.UUID `json:"profile"`
	Input   string    `json:"input"` // sha256 of the model, document prefix, input limit and title
}

func embedRecordFor(t catalog.EmbedTarget, title string) embedRecord {
	sum := sha256.Sum256(fmt.Appendf(nil, "%s\x1e%d\x1e%s\x1e%s", t.Model.ID, t.MaxInputTokens, t.Profile.DocumentPrefix, title))
	return embedRecord{Profile: t.Profile.ID, Input: hex.EncodeToString(sum[:])}
}

// storedEmbedRecord reads metadata.embed (ok false when there is none).
func storedEmbedRecord(meta json.RawMessage) (embedRecord, bool) {
	var m struct {
		Embed *embedRecord `json:"embed"`
	}
	if json.Unmarshal(meta, &m) != nil || m.Embed == nil {
		return embedRecord{}, false
	}
	return *m.Embed, true
}

// reusable pairs the document's new chunks with its rows for the target's profile whose embedded input is unchanged:
// reuse[i] is the row kept for chunks[i] (uuid.Nil when it is embedded now), fresh the indexes embedded now.
func (p *Processor) reusable(ctx context.Context, q *dbgen.Queries, srcID uuid.UUID, doc dbgen.Document, t catalog.EmbedTarget, title string, chunks []chunk.Chunk) ([]uuid.UUID, []int, error) {
	all := func() ([]uuid.UUID, []int, error) {
		return make([]uuid.UUID, len(chunks)), allIndexes(len(chunks)), nil
	}
	if old, ok := storedEmbedRecord(doc.Metadata); !ok || old != embedRecordFor(t, title) {
		return all()
	}
	if ctxual, err := p.contextualRechunk(ctx, q, srcID, t); err != nil {
		return nil, nil, err
	} else if ctxual {
		return all()
	}
	existing, err := q.DocumentChunkKeys(ctx, dbgen.DocumentChunkKeysParams{DocumentID: doc.ID, ProfileID: t.Profile.ID})
	if err != nil {
		return nil, nil, err
	}
	reuse, fresh := matchChunks(chunks, existing)
	return reuse, fresh, nil
}

// pick is chunks at the indexes, in order.
func pick(chunks []chunk.Chunk, idx []int) []chunk.Chunk {
	out := make([]chunk.Chunk, len(idx))
	for j, i := range idx {
		out[j] = chunks[i]
	}
	return out
}

// kept lists the rows kept and their new ordinals (positions in the chunk list).
func kept(reuse []uuid.UUID) (ids []uuid.UUID, ords []int32) {
	ids, ords = []uuid.UUID{}, []int32{}
	for i, id := range reuse {
		if id != uuid.Nil {
			ids, ords = append(ids, id), append(ords, int32(i))
		}
	}
	return ids, ords
}
