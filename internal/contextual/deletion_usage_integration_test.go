package contextual

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Source content may disappear while a request is paid for. That must neither
// erase real usage nor permit its response to restore source/cache content.
func TestPGPaidContextAfterSourceDeletionIsStillRecordedOnce(t *testing.T) {
	f := newSettlementFixture(t)
	entry := f.cacheEntry(t, 21, "A paid description that must not survive source deletion.")
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	var notified atomic.Int64
	f.store.Recorded = func(_ uuid.UUID, _ []dbgen.InsertUsageParams) { notified.Add(1) }
	if _, err := f.pool.Exec(t.Context(), `DELETE FROM data_sources WHERE id = $1`, f.res.SourceID); err != nil {
		t.Fatal(err)
	}
	st := Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry}
	err = f.store.Settle(t.Context(), st)
	var stopped *StopError
	rows, tokens := f.ledger(t)
	if !errors.As(err, &stopped) || rows != 2 || tokens != 10 || notified.Load() != 1 {
		t.Fatalf("source deletion erased paid accounting: err=%v rows=%d tokens=%d notifications=%d", err, rows, tokens, notified.Load())
	}
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			if err := f.store.Settle(t.Context(), st); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	rows, tokens = f.ledger(t)
	if rows != 2 || tokens != 10 || notified.Load() != 1 {
		t.Fatalf("deleted-source retries duplicated usage: %d/%d/%d", rows, tokens, notified.Load())
	}
	var outcome string
	if err := f.pool.QueryRow(t.Context(), `SELECT outcome FROM contextual_calls WHERE id = $1`, id).Scan(&outcome); err != nil {
		t.Fatal(err)
	}
	if outcome != OutcomeOK {
		t.Fatalf("paid deleted-source outcome = %s", outcome)
	}
	assertNoDeletedContextContent(t, f)
	if _, err := f.store.Reserve(t.Context(), f.res); err == nil {
		t.Fatal("deleted source admitted a new request")
	}
}

func TestPGDeletedSourceConcurrentFirstSettlementRecordsOnce(t *testing.T) {
	f := newSettlementFixture(t)
	entry := f.cacheEntry(t, 23, "A paid description that must not restore deleted source content.")
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `DELETE FROM data_sources WHERE id = $1`, f.res.SourceID); err != nil {
		t.Fatal(err)
	}
	var notified, stopped atomic.Int64
	f.store.Recorded = func(_ uuid.UUID, _ []dbgen.InsertUsageParams) { notified.Add(1) }
	st := Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry}
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 12 {
		wg.Go(func() {
			<-start
			err := f.store.Settle(t.Context(), st)
			var stop *StopError
			if errors.As(err, &stop) {
				stopped.Add(1)
			} else if err != nil {
				t.Error(err)
			}
		})
	}
	close(start)
	wg.Wait()
	if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 || notified.Load() != 1 || stopped.Load() != 1 {
		t.Fatalf("deleted-source concurrent settlement duplicated/lost usage: rows=%d tokens=%d notifications=%d stopped=%d", rows, tokens, notified.Load(), stopped.Load())
	}
	assertNoDeletedContextContent(t, f)
}

// usage_events deliberately stores historical UUIDs without document/source
// FKs. Deleting a document is a control, not an invented ledger-FK failure.
func TestPGPaidContextAfterDocumentDeletionKeepsHistoricalUsage(t *testing.T) {
	f := newSettlementFixture(t)
	entry := f.cacheEntry(t, 22, "A paid description that must not survive document deletion.")
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(t.Context(), `DELETE FROM documents WHERE id = $1`, f.res.DocumentID); err != nil {
		t.Fatal(err)
	}
	err = f.store.Settle(t.Context(), Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage, Cache: &entry})
	var stopped *StopError
	if !errors.As(err, &stopped) {
		t.Fatalf("deleted document did not suppress cache: %v", err)
	}
	if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 {
		t.Fatalf("document deletion lost usage: %d/%d", rows, tokens)
	}
	assertNoDeletedContextContent(t, f)
}

func assertNoDeletedContextContent(t *testing.T, f settlementFixture) {
	t.Helper()
	var remaining int
	if err := f.pool.QueryRow(t.Context(), `SELECT (SELECT count(*) FROM contextual_cache WHERE source_id = $1)
		+ (SELECT count(*) FROM contextual_cache_plans WHERE source_id = $1)`, f.res.SourceID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("deleted work restored %d content/plan rows", remaining)
	}
}
