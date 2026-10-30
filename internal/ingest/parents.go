// Parent ranges of a document's passages (parent/child retrieval, docs/parent-child-retrieval.md, ADR-0026). A parent is a range of
// consecutive passages of one document and profile, recorded on each passage as the ordinals of its first and last one. The ranges are written
// in the transaction that writes the passages, by every path that writes them, so a range never points at rows that are not there with it.

package ingest

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/chunk"
)

// setParents records the parent range of every passage of the document under the profile, from the chunks just written (in tx), when the
// profile has parents (parentTokens > 0). Without parents it writes nothing: the columns stay NULL.
func setParents(ctx context.Context, tx pgx.Tx, docID, profileID uuid.UUID, parentTokens int32, chunks []chunk.Chunk) error {
	if parentTokens <= 0 || len(chunks) == 0 {
		return nil
	}
	// Passages are stored at their position in the list (insertChunksSQL's ordinals), whatever Ordinal the chunks carry.
	ordered := make([]chunk.Chunk, len(chunks))
	copy(ordered, chunks)
	for i := range ordered {
		ordered[i].Ordinal = i
	}
	ranges := chunk.Parents(ordered, int(parentTokens))
	ords, firsts, lasts := make([]int32, len(ranges)), make([]int32, len(ranges)), make([]int32, len(ranges))
	for i, r := range ranges {
		ords[i], firsts[i], lasts[i] = int32(i), int32(r.First), int32(r.Last)
	}
	tag, err := tx.Exec(ctx, `UPDATE chunks c SET parent_first = u.f, parent_last = u.l
FROM unnest($3::int[], $4::int[], $5::int[]) AS u(o, f, l)
WHERE c.document_id = $1 AND c.profile_id = $2 AND c.ordinal = u.o`, docID, profileID, ords, firsts, lasts)
	if err != nil {
		return fmt.Errorf("set parents: %w", err)
	}
	if int(tag.RowsAffected()) != len(ranges) {
		return fmt.Errorf("set parents: %d of %d passages found", tag.RowsAffected(), len(ranges))
	}
	return nil
}
