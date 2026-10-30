package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/kbs"
)

// Membership is checked by the reader, not a constraint that breaks old
// rechunk writers. Even agreeing, complete ranges may not expand if they
// exclude the matched child. This pins the check moved out of the schema.
func TestParentReviewExpansionRejectsRangeOutsideHit(t *testing.T) {
	env := newParentEnv(t, 512, 6)
	question := "parking3x"
	_, before := env.search(t, env.kbOn.Id, question, 1, true, kbs.MetadataFilter{})
	if len(before) != 1 || before[0].Parent == nil {
		t.Fatal("fixture has no parent hit")
	}
	ordinal := env.scalar(t, `SELECT ordinal FROM chunks WHERE id = $1`, before[0].ChunkID)
	first := int32(0)
	if ordinal <= 1 {
		first = 2
	}
	// Every row agrees and the two rows exist, but the hit is outside them.
	// This metadata can also arise from an old worker changing ordinals.
	env.sql(t, `UPDATE chunks SET parent_first = $2, parent_last = $3 WHERE document_id = $1 AND profile_id = $4`, before[0].DocumentID, first, first+1, env.profile.Id)
	kb, hits := env.search(t, env.kbOn.Id, question, 1, true, kbs.MetadataFilter{})
	if len(hits) != 1 || hits[0].ChunkID != before[0].ChunkID || hits[0].Parent == nil {
		t.Fatal("fixture did not retain its best child")
	}
	if err := env.app.Svc.KBs.ExpandParents(t.Context(), kb, kbs.MetadataFilter{}, hitPtrs(hits)); err != nil {
		t.Fatal(err)
	}
	if hits[0].Parent.Text != "" || hits[0].Parent.Skipped != kbs.SkipStale {
		t.Fatalf("range outside matched child was not refused: %+v", hits[0].Parent)
	}
}
