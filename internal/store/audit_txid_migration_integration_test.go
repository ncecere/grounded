package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/migrations"
)

// An interrupted CREATE INDEX CONCURRENTLY leaves an invalid index under its name. Migration 00066 runs again after such a
// failure (goose records it only once it finishes), and IF NOT EXISTS alone would keep the invalid index for good: the stream's
// cursor query would never use it. The migration rebuilds an invalid index and keeps a valid one.
func TestAuditTxidMigrationRebuildsAnInvalidIndex(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	p, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 65); err != nil {
		t.Fatalf("down to 65: %v", err)
	}
	// What an interrupted build leaves: the column, and an index of that name marked invalid. A unique index over two equal
	// rows fails its concurrent build the same way.
	for _, q := range []string{
		`ALTER TABLE audit_log ADD COLUMN txid xid8`,
		`INSERT INTO audit_log (actor_kind, action, target_type) VALUES ('system', 'test.one', 'test'), ('system', 'test.two', 'test')`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	if _, err := pool.Exec(ctx, `CREATE UNIQUE INDEX CONCURRENTLY audit_log_txid_idx ON audit_log ((1))`); err == nil {
		t.Fatal("the failing build succeeded")
	}
	if indexValid(t, pool) {
		t.Fatal("setup: the leftover index is valid")
	}
	if _, err := p.UpTo(ctx, 66); err != nil {
		t.Fatalf("up to 66: %v", err)
	}
	if !indexValid(t, pool) {
		t.Fatal("00066 kept the invalid audit_log_txid_idx")
	}
	var def string
	if err := pool.QueryRow(ctx, `SELECT pg_get_indexdef('audit_log_txid_idx'::regclass)`).Scan(&def); err != nil {
		t.Fatal(err)
	}
	if want := "CREATE INDEX audit_log_txid_idx ON public.audit_log USING btree (txid, id) WHERE (txid IS NOT NULL)"; def != want {
		t.Fatalf("index after 00066:\n got %s\nwant %s", def, want)
	}
	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("up: %v", err)
	}
}

func indexValid(t *testing.T, pool *pgxpool.Pool) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(context.Background(), `SELECT indisvalid FROM pg_index WHERE indexrelid = 'audit_log_txid_idx'::regclass`).Scan(&ok); err != nil {
		t.Fatal(err)
	}
	return ok
}
