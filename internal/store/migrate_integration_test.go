package store_test

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/testutil"
)

// Replicas and the migration Job may start at the same time; migrations must
// be serialised and re-running them must be a no-op.
func TestConcurrentMigrationsAreSafe(t *testing.T) {
	pool, _ := testutil.NewDB(t) // already migrated once
	// A pool smaller than the number of concurrent callers: waiting for the
	// migration lock must not use pool connections (it deadlocked on 2-CPU
	// CI runners, where pgxpool defaults to 4 connections).
	cfg := pool.Config().Copy()
	cfg.MaxConns = 2
	small, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(small.Close)
	pool = small
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- store.Migrate(context.Background(), pool, testutil.Logger())
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent migrate: %v", err)
		}
	}
}

// Pods migrating a fresh database at the same time finish: a pod waiting for the migration lock holds no snapshot, so the
// concurrent index build of migration 00066 (which waits for every older snapshot) is not blocked by it. With a blocking
// pg_advisory_lock they deadlocked (the k8s smoke test's API and worker init containers).
func TestConcurrentMigrationsOfAFreshDatabase(t *testing.T) {
	adminURL := os.Getenv("GROUNDED_TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("GROUNDED_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("grounded_test_fresh_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		_ = admin.Close(context.Background())
	})
	u, _ := url.Parse(adminURL)
	u.Path = "/" + name
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	var wg sync.WaitGroup
	errs := make(chan error, 3)
	for range 3 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pool, err := store.Open(ctx, u.String())
			if err != nil {
				errs <- err
				return
			}
			defer pool.Close()
			errs <- store.Migrate(ctx, pool, testutil.Logger())
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent migrate of a fresh database: %v", err)
		}
	}
	var valid bool
	pool, err := store.Open(context.Background(), u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.QueryRow(context.Background(), `SELECT indisvalid FROM pg_index WHERE indexrelid = 'audit_log_txid_idx'::regclass`).Scan(&valid); err != nil || !valid {
		t.Fatalf("audit_log_txid_idx valid = %v (%v)", valid, err)
	}
}
