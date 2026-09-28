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
func NewDB(t testing.TB) (*pgxpool.Pool, string) {
	t.Helper()
	adminURL := requireEnv(t, "GROUNDED_TEST_DATABASE_URL")
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect admin db: %v", err)
	}
	name := "grounded_test_" + randomSuffix()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatalf("create database: %v", err)
	}
	_ = admin.Close(ctx)

	u, err := url.Parse(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	dbURL := u.String()
	pool, err := store.Open(ctx, dbURL)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := store.Migrate(ctx, pool, Logger()); err != nil {
		t.Fatalf("migrate test db: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
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
	return pool, dbURL
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
