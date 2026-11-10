package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// Migration 00069 adds indexes only. Each foreign key it covers is ON DELETE SET NULL: without an index on the
// referencing column, deleting one referenced row scans the referencing table. The test checks every index is there and
// valid, that the migration goes down and up again, and that the planner can use an index for the lookup a delete makes.
func TestMigration00069IndexesTheDeletePaths(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	indexes := []string{"conversations_anon_session_idx", "anon_sessions_conversation_idx", "contextual_calls_document_idx",
		"source_boilerplate_blocks_canonical_idx", "set_boilerplate_blocks_canonical_idx", "audit_log_team_id_idx"}
	valid := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_index WHERE indisvalid AND indexrelid = ANY (
			SELECT to_regclass(name)::oid FROM unnest($1::text[]) AS name)`, indexes).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := valid(); n != len(indexes) {
		t.Fatalf("%d of %d indexes exist and are valid", n, len(indexes))
	}
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 68); err != nil {
		t.Fatalf("down to 68: %v", err)
	}
	if n := valid(); n != 0 {
		t.Fatalf("down left %d indexes", n)
	}
	if _, err := p.UpTo(ctx, 69); err != nil {
		t.Fatalf("up to 69: %v", err)
	}
	if n := valid(); n != len(indexes) {
		t.Fatalf("after down and up, %d of %d indexes are valid", n, len(indexes))
	}
	// The lookup a deleted anonymous session makes in conversations, with sequential scans discouraged as they are on a
	// table of real size.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SET LOCAL enable_seqscan = off`); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(ctx, `EXPLAIN SELECT 1 FROM conversations WHERE anon_session_id = gen_random_uuid()`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	if !strings.Contains(plan.String(), "conversations_anon_session_idx") {
		t.Fatalf("the lookup does not use the index:\n%s", plan.String())
	}
}
