package store_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// InsertUsage writes the rows dbgen's single-row InsertUsage would: the same
// columns, NULL for an unset ID, in order.
func TestInsertUsageMatchesSingleRows(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	q := dbgen.New(pool)
	model := uuid.NullUUID{UUID: uuid.New(), Valid: true}
	rows := []dbgen.InsertUsageParams{
		{Kind: "query", Quantity: 1, Metadata: json.RawMessage(`{"hits": 3}`)},
		{Kind: "chat_tokens_in", Quantity: 120, ModelID: model, Metadata: json.RawMessage(`{"channel": "app"}`)},
		{Kind: "chat_tokens_out", Quantity: 45, ModelID: model, Metadata: json.RawMessage(`{}`)},
	}
	for _, r := range rows {
		if err := q.InsertUsage(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.InsertUsage(ctx, pool, rows); err != nil {
		t.Fatal(err)
	}
	if err := store.InsertUsage(ctx, pool, nil); err != nil {
		t.Fatalf("no rows: %v", err)
	}
	read := func(offset int) []string {
		t.Helper()
		r, err := pool.Query(ctx, `SELECT (to_jsonb(u) - 'id' - 'occurred_at')::text FROM usage_events u ORDER BY id OFFSET $1 LIMIT 3`, offset)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Close()
		var out []string
		for r.Next() {
			var s string
			if err := r.Scan(&s); err != nil {
				t.Fatal(err)
			}
			out = append(out, s)
		}
		return out
	}
	single, batch := read(0), read(3)
	if len(single) != 3 || len(batch) != 3 {
		t.Fatalf("rows: %d single, %d in one statement", len(single), len(batch))
	}
	for i := range single {
		if single[i] != batch[i] {
			t.Errorf("row %d differs:\n single %s\n batch  %s", i, single[i], batch[i])
		}
	}
	// A row without metadata is refused, as a single row is.
	if err := store.InsertUsage(ctx, pool, []dbgen.InsertUsageParams{{Kind: "query", Quantity: 1}}); err == nil {
		t.Error("a row with no metadata was accepted")
	}
}
