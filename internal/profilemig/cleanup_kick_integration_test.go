package profilemig_test

import (
	"context"
	"testing"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/ncecere/grounded/internal/profilemig"
	"github.com/ncecere/grounded/internal/testutil"
)

// A request for cleanup is dropped as a duplicate only while an earlier one has not finished. One that already completed in the same 10
// seconds must not swallow the next: a discard right after a cleanup run would otherwise wait for the periodic run (up to ten minutes).
func TestCleanupKickIsNotDroppedByAFinishedJob(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	insert := func() (skipped bool) {
		t.Helper()
		res, err := client.Insert(ctx, profilemig.CleanupArgs{}, nil)
		if err != nil {
			t.Fatal(err)
		}
		return res.UniqueSkippedAsDuplicate
	}
	count := func() (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM river_job WHERE kind = 'profile_migration.cleanup'`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if insert() {
		t.Fatal("the first request was dropped")
	}
	if !insert() || count() != 1 {
		t.Fatalf("a second request while the first waits was queued (%d jobs); bursts should coalesce", count())
	}
	if _, err := pool.Exec(ctx, `UPDATE river_job SET state = 'completed', finalized_at = now() WHERE kind = 'profile_migration.cleanup'`); err != nil {
		t.Fatal(err)
	}
	if insert() {
		t.Fatal("a request right after a finished cleanup was dropped as its duplicate")
	}
	if count() != 2 {
		t.Fatalf("jobs = %d, want 2", count())
	}
}
