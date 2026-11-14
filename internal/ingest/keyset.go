package ingest

import "github.com/google/uuid"

// Keyset is a position in a scan of a source's documents by ID, kept for one invocation of a resumable batch loop
// (the boilerplate refresh, a profile migration's set; #250). Each step asks only for the rows after the last one it
// handled, instead of skipping every finished row from the start again, which made a run over N documents O(N²).
type Keyset struct{ after uuid.UUID }

// Done records that the rows up to id were handled.
func (k *Keyset) Done(id uuid.UUID) { k.after = id }

// NextBatch fetches the batch after k's position. When nothing is left past a position it starts once more from the
// beginning, since a row before it may have become due meanwhile (a document that became ready, a retry whose time
// came): an empty result still means a full scan found nothing, as before.
func NextBatch[T any](k *Keyset, fetch func(after uuid.UUID) ([]T, error)) ([]T, error) {
	rows, err := fetch(k.after)
	if err != nil || len(rows) > 0 || k.after == uuid.Nil {
		return rows, err
	}
	k.after = uuid.Nil
	return fetch(uuid.Nil)
}
