package web_test

import (
	"context"
	"testing"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/web"
)

// CRAWL_ALLOWLIST_SEED is applied once: after an admin deletes every
// pattern, a restart does not bring them back.
func TestSeedAllowlistOnce(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx, log := context.Background(), testutil.Logger()
	patterns := func() []string {
		t.Helper()
		rows, err := pool.Query(ctx, "SELECT pattern FROM crawl_allowlist ORDER BY pattern")
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var p string
			if err := rows.Scan(&p); err != nil {
				t.Fatal(err)
			}
			out = append(out, p)
		}
		return out
	}
	audits := func() int {
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM audit_log WHERE action = 'crawl.allowlist_seed' AND actor_kind = 'system'").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Migrations seed nothing.
	if got := patterns(); len(got) != 0 {
		t.Fatalf("fresh allowlist = %v", got)
	}
	// An empty seed records nothing, so a later seed still applies.
	if n, err := web.SeedAllowlist(ctx, pool, nil, log); err != nil || n != 0 {
		t.Fatalf("empty seed = %d %v", n, err)
	}
	if _, err := pool.Exec(ctx, "INSERT INTO crawl_allowlist (pattern, note) VALUES ('example.org', 'added by an admin')"); err != nil {
		t.Fatal(err)
	}
	n, err := web.SeedAllowlist(ctx, pool, []string{"*.Example.edu", "example.org"}, log)
	if err != nil || n != 1 {
		t.Fatalf("first seed = %d %v", n, err)
	}
	if got := patterns(); len(got) != 2 || got[0] != "*.example.edu" || got[1] != "example.org" {
		t.Fatalf("seeded allowlist = %v", got)
	}
	if audits() != 1 {
		t.Errorf("seed audits = %d, want 1 (existing patterns are skipped)", audits())
	}

	// Delete everything, then "restart" (with the same or a new seed).
	if _, err := pool.Exec(ctx, "DELETE FROM crawl_allowlist"); err != nil {
		t.Fatal(err)
	}
	for _, seed := range [][]string{{"*.example.edu"}, {"*.other.example"}} {
		if n, err := web.SeedAllowlist(ctx, pool, seed, log); err != nil || n != 0 {
			t.Fatalf("restart seed %v = %d %v", seed, n, err)
		}
	}
	if got := patterns(); len(got) != 0 {
		t.Errorf("allowlist re-seeded: %v", got)
	}
	if audits() != 1 {
		t.Errorf("seed audits = %d after restart", audits())
	}

	if _, err := web.SeedAllowlist(ctx, pool, []string{"not a host"}, log); err == nil {
		t.Error("invalid seed pattern accepted")
	}
}

// Replicas start together; only one applies the seed.
func TestSeedAllowlistConcurrent(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	results := make(chan int, 4)
	for range 4 {
		go func() {
			n, err := web.SeedAllowlist(ctx, pool, []string{"*.example.edu", "example.org"}, testutil.Logger())
			if err != nil {
				t.Error(err)
			}
			results <- n
		}()
	}
	total := 0
	for range 4 {
		total += <-results
	}
	if total != 2 {
		t.Errorf("patterns added across replicas = %d, want 2", total)
	}
}
