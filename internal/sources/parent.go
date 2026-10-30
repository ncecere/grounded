// A cited parent in the source viewer (docs/parent-child-retrieval.md): the section the model was given, shown only while it is still the text
// the model read.

package sources

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// ParentQuery names a parent a citation recorded: its ordinals in the document, the hash of the text the model was given, and the passage
// that matched (uuid.Nil when unknown).
type ParentQuery struct {
	First, Last int32
	SHA256      string
	ChunkID     uuid.UUID
}

// ParentInContext returns the passages of the parent, in order, each without the text it repeats from the one before (so they read as the
// text the model was given), all marked Cited and the matched one Matched. ErrPassageNotFound unless the document's current passages
// First..Last, from the source's current profile, make exactly the text the citation hashed: a document that changed, was cut again or whose
// passages moved never shows other text as the cited section. It does no authorization: callers decide who may see a cited passage.
func ParentInContext(ctx context.Context, q *dbgen.Queries, doc dbgen.GetViewerDocumentRow, pq ParentQuery) ([]ContextPassage, error) {
	n := int(pq.Last-pq.First) + 1
	if pq.First < 0 || n < 1 || n > chunk.MaxParentChildren {
		return nil, ErrPassageNotFound
	}
	rows, err := q.ListViewerChunks(ctx, dbgen.ListViewerChunksParams{DocumentID: doc.ID, FromOrdinal: pq.First, ToOrdinal: pq.Last})
	if err != nil {
		return nil, err
	}
	if len(rows) != n {
		return nil, ErrPassageNotFound
	}
	contents := make([]string, n)
	for i, r := range rows {
		if r.Ordinal != pq.First+int32(i) {
			return nil, ErrPassageNotFound
		}
		contents[i] = r.Content
	}
	if chunk.TextHash(chunk.ParentText(contents)) != pq.SHA256 {
		return nil, ErrPassageNotFound
	}
	out := toContext(rows, -1)
	for i, c := range chunk.TrimOverlaps(contents) {
		out[i].Content, out[i].Cited = c, true
		out[i].Matched = pq.ChunkID != uuid.Nil && rows[i].ID == pq.ChunkID
	}
	return out, nil
}
