// Package testutil provides real-infrastructure helpers for integration tests.
//
// Tests needing PostgreSQL or Valkey call NewDB / NewKV. They are skipped when
// GROUNDED_TEST_DATABASE_URL / GROUNDED_TEST_VALKEY_URL are unset, except in CI
// (CI=true), where a missing dependency fails the test instead of silently
// skipping it.
package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/kv"
	"github.com/ncecere/grounded/internal/store"
)

func requireEnv(t testing.TB, name string) string {
	t.Helper()
	v := os.Getenv(name)
	if v == "" {
		if os.Getenv("CI") == "true" {
			t.Fatalf("%s must be set in CI", name)
		}
		t.Skipf("%s not set; skipping integration test (run `make deps-up` and `make test-integration`)", name)
	}
	return v
}

func randomSuffix() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Logger discards output unless GROUNDED_TEST_LOG=1.
func Logger() *slog.Logger {
	if os.Getenv("GROUNDED_TEST_LOG") == "1" {
		return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	}
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// NewDB creates a fresh, fully migrated database for one test and drops it
// afterwards. GROUNDED_TEST_DATABASE_URL must point at a role allowed to create
// databases (the compose superuser is fine).
//
// The database is a copy of a template that is migrated once per schema (see
// template.go), so a test does not pay for every migration. Set
// GROUNDED_TEST_NO_TEMPLATE=1 to migrate each database instead.
func NewDB(t testing.TB) (*pgxpool.Pool, string) {
	t.Helper()
	dbURL := NewDBURL(t)
	return openPool(t, dbURL), dbURL
}

// NewDBURL is NewDB for a test that opens its own pool: it returns the
// database's URL only.
func NewDBURL(t testing.TB) string {
	t.Helper()
	adminURL := requireEnv(t, "GROUNDED_TEST_DATABASE_URL")
	if os.Getenv("GROUNDED_TEST_NO_TEMPLATE") == "1" {
		return migratedDB(t, adminURL, "")
	}
	tmpl, err := templateDB(adminURL)
	if err != nil {
		t.Fatalf("template database: %v", err)
	}
	return createDB(t, adminURL, " TEMPLATE "+tmpl)
}

// NewDBInCLocale is NewDB with a database whose collation and character classes are "C" (as a cluster initialised with --locale=C
// has): lower() and upper() then change ASCII letters only, so a test can see what a case-insensitive index does not catch.
func NewDBInCLocale(t testing.TB) (*pgxpool.Pool, string) {
	t.Helper()
	adminURL := requireEnv(t, "GROUNDED_TEST_DATABASE_URL")
	dbURL := migratedDB(t, adminURL, " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'")
	return openPool(t, dbURL), dbURL
}

// migratedDB creates a database and applies every migration to it.
func migratedDB(t testing.TB, adminURL, createOptions string) string {
	t.Helper()
	dbURL := createDB(t, adminURL, createOptions)
	ctx := context.Background()
	pool, err := store.Open(ctx, dbURL)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool, Logger()); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
	return dbURL
}

// createDB creates a database for one test, dropped when the test ends, and returns its URL.
func createDB(t testing.TB, adminURL, createOptions string) string {
	t.Helper()
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect admin db: %v", err)
	}
	name := "grounded_test_" + randomSuffix()
	err = createDatabase(ctx, admin, name, createOptions)
	_ = admin.Close(ctx)
	if err != nil {
		t.Fatalf("create database: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		admin, err := pgx.Connect(ctx, adminURL)
		if err != nil {
			t.Logf("cleanup connect: %v", err)
			return
		}
		defer admin.Close(ctx)
		if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Logf("drop test database: %v", err)
		}
	})
	dbURL, err := databaseURL(adminURL, name)
	if err != nil {
		t.Fatal(err)
	}
	return dbURL
}

// databaseURL is adminURL pointed at the database name.
func databaseURL(adminURL, name string) (string, error) {
	u, err := url.Parse(adminURL)
	if err != nil {
		return "", err
	}
	u.Path = "/" + name
	// GROUNDED_TEST_POOL_MAX_CONNS sets the pool size, e.g. 4 to match a
	// 2-CPU CI runner (pgxpool's default is max(4, CPUs)).
	if n := os.Getenv("GROUNDED_TEST_POOL_MAX_CONNS"); n != "" {
		q := u.Query()
		q.Set("pool_max_conns", n)
		u.RawQuery = q.Encode()
	}
	return u.String(), nil
}

// openPool opens a pool closed when the test ends (before its database is dropped: cleanups run last in, first out).
func openPool(t testing.TB, dbURL string) *pgxpool.Pool {
	t.Helper()
	pool, err := store.Open(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// NewKV connects to Valkey with a unique key prefix so parallel tests never
// share state. Keys expire on their own; no cleanup is needed.
func NewKV(t testing.TB) *kv.Store {
	t.Helper()
	rawURL := requireEnv(t, "GROUNDED_TEST_VALKEY_URL")
	s, err := kv.Open(context.Background(), rawURL, "groundedtest:"+randomSuffix()+":")
	if err != nil {
		t.Fatalf("open valkey: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}
