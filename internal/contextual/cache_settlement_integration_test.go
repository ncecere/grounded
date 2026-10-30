package contextual

import "testing"

func TestPGCacheFailureRollsBackUsageAndSettlement(t *testing.T) {
	f := newSettlementFixture(t)
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	entry := CacheEntry{DocumentID: f.res.DocumentID, SourceID: f.res.SourceID, Key: [32]byte{3}}
	st := Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry}
	// Empty cache text violates the real database constraint, after usage was inserted.
	if err := f.store.Settle(t.Context(), st); err == nil {
		t.Fatal("invalid cache publication unexpectedly succeeded")
	}
	var outcome string
	if err := f.pool.QueryRow(t.Context(), `SELECT outcome FROM contextual_calls WHERE id = $1`, id).Scan(&outcome); err != nil {
		t.Fatal(err)
	}
	if rows, _ := f.ledger(t); rows != 0 || outcome != OutcomeStarted {
		t.Fatalf("cache failure committed usage or settlement: rows=%d outcome=%s", rows, outcome)
	}
	entry.Text = "A context describing the student registration section."
	if err := f.store.Settle(t.Context(), st); err != nil {
		t.Fatal(err)
	}
	cached, err := f.store.CacheFor(t.Context(), entry.DocumentID, [][32]byte{entry.Key})
	if err != nil || cached[entry.Key] != entry.Text {
		t.Fatalf("retry failed to publish context: %v %v", cached, err)
	}
	if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 {
		t.Fatalf("retry failed to account exactly once: rows=%d tokens=%d", rows, tokens)
	}
}

func TestCacheRequiresSuccessfulMatchingUsage(t *testing.T) {
	for _, name := range []string{"no usage", "wrong document", "wrong source", "failed outcome"} {
		t.Run(name, func(t *testing.T) {
			f := newSettlementFixture(t)
			id, err := f.store.Reserve(t.Context(), f.res)
			if err != nil {
				t.Fatal(err)
			}
			entry := CacheEntry{DocumentID: f.res.DocumentID, SourceID: f.res.SourceID, Key: [32]byte{4}, Text: "An otherwise valid context about registration."}
			st := Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry}
			switch name {
			case "no usage":
				st.Usage = nil
			case "wrong document":
				entry.DocumentID[0] ^= 1
			case "wrong source":
				entry.SourceID[0] ^= 1
			case "failed outcome":
				st.Outcome = OutcomeError
			}
			if err := f.store.Settle(t.Context(), st); err == nil {
				t.Fatal("inconsistent cache settlement was accepted")
			}
			if rows, _ := f.ledger(t); rows != 0 {
				t.Fatalf("inconsistent cache settlement wrote %d usage events", rows)
			}
		})
	}
}
