package ingest

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

// A keyset scan asks for the rows after the last one handled, and starts once more from the beginning before it says
// nothing is left (#250).
func TestKeysetResumesAndWrapsOnce(t *testing.T) {
	ids := []uuid.UUID{{1}, {2}, {3}, {4}, {5}}
	pending := map[uuid.UUID]bool{ids[0]: true, ids[1]: true, ids[2]: true, ids[3]: true, ids[4]: true}
	var asked []uuid.UUID
	fetch := func(after uuid.UUID) ([]uuid.UUID, error) {
		asked = append(asked, after)
		var out []uuid.UUID
		for _, id := range ids {
			if pending[id] && slices.Compare(id[:], after[:]) > 0 && len(out) < 2 {
				out = append(out, id)
			}
		}
		return out, nil
	}
	var k Keyset
	var seen []uuid.UUID
	for {
		rows, _ := NextBatch(&k, fetch)
		if len(rows) == 0 {
			break
		}
		for _, id := range rows {
			seen = append(seen, id)
			if id != ids[1] { // ids[1] stays due: a retry later in the run
				delete(pending, id)
			} else if len(seen) > 3 {
				delete(pending, id)
			}
		}
		k.Done(rows[len(rows)-1])
	}
	want := []uuid.UUID{ids[0], ids[1], ids[2], ids[3], ids[4], ids[1]}
	if !slices.Equal(seen, want) {
		t.Errorf("seen %v", seen)
	}
	// From the start, after 2, after 4, after 5 (nothing), from the start again (ids[1]), after 2 (nothing), from the start (nothing).
	want = []uuid.UUID{uuid.Nil, ids[1], ids[3], ids[4], uuid.Nil, ids[1], uuid.Nil}
	if !slices.Equal(asked, want) {
		t.Errorf("asked after %v", asked)
	}
}
