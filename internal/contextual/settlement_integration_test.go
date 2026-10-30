package contextual

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

type settlementFixture struct {
	pool  *pgxpool.Pool
	store *PGStore
	res   Reservation
	usage Usage
}

// No gateway is configured or called: this tests the durable attempt/usage transaction directly.
func newSettlementFixture(t *testing.T) settlementFixture {
	t.Helper()
	pool, _ := testutil.NewDB(t)
	ctx := t.Context()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	team, conn, embed, chat, profile, source, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, 'contextual', 'Contextual', 'open')`, team)
	exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://example.test/v1')`, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, embed, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification) VALUES ($1, $2, 'c', 'c', 'C', 'chat', 'open')`, chat, conn)
	exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 128, 0)`, profile, embed)
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 's', 'web', 'open', $3)`, source, team, profile)
	exec(`INSERT INTO documents (id, source_id, external_id, status, version) VALUES ($1, $2, 'https://example.edu/document', 'ready', 1)`, doc, source)
	return settlementFixture{pool: pool, store: &PGStore{Pool: pool},
		res: Reservation{SourceID: source, ProfileID: profile, DocumentID: doc, ModelID: chat, Phase: PhaseBuild, Cap: 10},
		usage: Usage{Team: uuid.NullUUID{UUID: team, Valid: true}, Source: source, Document: doc, Model: chat,
			Phase: PhaseBuild, TokensIn: 7, TokensOut: 3, Reported: true}}
}

func (f settlementFixture) ledger(t *testing.T) (rows, tokens int64) {
	t.Helper()
	if err := f.pool.QueryRow(t.Context(), `SELECT count(*), coalesce(sum(quantity), 0)::bigint FROM usage_events WHERE source_id = $1`, f.res.SourceID).Scan(&rows, &tokens); err != nil {
		t.Fatal(err)
	}
	return
}

func TestPGSettlementIsIdempotentAcrossConcurrentRetries(t *testing.T) {
	f := newSettlementFixture(t)
	var notified atomic.Int64
	f.store.Recorded = func(_ uuid.UUID, events []dbgen.InsertUsageParams) {
		if len(events) != 2 {
			t.Errorf("notification has %d events, want 2", len(events))
		}
		notified.Add(1)
	}
	id, err := f.store.Reserve(t.Context(), f.res)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.store.Settle(t.Context(), Settlement{ID: id, Outcome: OutcomeStarted, Usage: &f.usage}); err == nil {
		t.Error("nonterminal outcome was accepted as a settlement")
	}
	st := Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage}
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			if err := f.store.Settle(t.Context(), st); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 {
		t.Errorf("settlement duplicated usage: rows=%d tokens=%d, want 2/10", rows, tokens)
	}
	if notified.Load() != 1 {
		t.Errorf("settlement notified %d times, want once", notified.Load())
	}
	var before time.Time
	if err := f.pool.QueryRow(t.Context(), `SELECT finished_at FROM contextual_calls WHERE id = $1`, id).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := f.store.Settle(t.Context(), Settlement{ID: id, Outcome: OutcomeTimeout}); err != nil {
		t.Fatal(err)
	}
	var outcome string
	var after time.Time
	if err := f.pool.QueryRow(t.Context(), `SELECT outcome, finished_at FROM contextual_calls WHERE id = $1`, id).Scan(&outcome, &after); err != nil {
		t.Fatal(err)
	}
	if outcome != OutcomeOK || !before.Equal(after) {
		t.Errorf("retry overwrote terminal settlement: outcome=%s before=%v after=%v", outcome, before, after)
	}
}

func TestPGSettlementMissingReservationWritesNoUsage(t *testing.T) {
	f := newSettlementFixture(t)
	if err := f.store.Settle(t.Context(), Settlement{ID: 999999, Outcome: OutcomeOK, Usage: &f.usage}); err != nil {
		t.Fatal(err)
	}
	if rows, _ := f.ledger(t); rows != 0 {
		t.Fatalf("missing reservation wrote %d usage events", rows)
	}
}

func TestPGSettlementLedgerFailureRollsBackTerminalState(t *testing.T) {
	f := newSettlementFixture(t)
	ctx := context.Background()
	id, err := f.store.Reserve(ctx, f.res)
	if err != nil {
		t.Fatal(err)
	}
	// Fail after the attempt's UPDATE but before its usage can be committed.
	if _, err := f.pool.Exec(ctx, `ALTER TABLE usage_events ADD CONSTRAINT test_contextual_usage CHECK (quantity < 7)`); err != nil {
		t.Fatal(err)
	}
	st := Settlement{ID: id, Outcome: OutcomeOK, Usage: &f.usage}
	if err := f.store.Settle(ctx, st); err == nil {
		t.Fatal("forced ledger failure unexpectedly succeeded")
	}
	var outcome string
	if err := f.pool.QueryRow(ctx, `SELECT outcome FROM contextual_calls WHERE id = $1`, id).Scan(&outcome); err != nil {
		t.Fatal(err)
	}
	if rows, _ := f.ledger(t); rows != 0 || outcome != OutcomeStarted {
		t.Fatalf("partial settlement committed: rows=%d outcome=%s", rows, outcome)
	}
	if _, err := f.pool.Exec(ctx, `ALTER TABLE usage_events DROP CONSTRAINT test_contextual_usage`); err != nil {
		t.Fatal(err)
	}
	if err := f.store.Settle(ctx, st); err != nil {
		t.Fatal(err)
	}
	if rows, tokens := f.ledger(t); rows != 2 || tokens != 10 {
		t.Fatalf("retry did not settle exactly once: rows=%d tokens=%d", rows, tokens)
	}
}
