package ingest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// A refresh waits for the source's documents in flight before every count, not only before its first: a request made while
// it runs (another upload batch) is handled in the same job, and counting before that batch is indexed left its documents
// out of the counts for good (TestBoilerplateFuzzyIsOrderIndependent saw 10 of 12 documents counted).
func TestRefreshWaitsForDocumentsInFlightBeforeEachCount(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	conn, model, prof, team, src := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 512, 0)`, prof, model)
	exec(`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, 't', 't', 'open')`, team)
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 's', 'upload', 'open', $3)`, src, team, prof)
	// The boilerplate setting is off: a refresh only counts (classify), nothing to backfill or re-chunk.
	exec(`INSERT INTO documents (source_id, team_id, external_id, status) VALUES ($1, $2, 'ready', 'ready')`, src, team)
	exec(`INSERT INTO source_boilerplate (source_id, requested_at) VALUES ($1, now())`, src)

	q := dbgen.New(pool)
	source, err := q.GetSource(ctx, src)
	if err != nil {
		t.Fatal(err)
	}
	r := &refresh{p: &Processor{Pool: pool, Log: testutil.Logger()}, q: q, src: source, settleUntil: time.Now().Add(time.Hour)}
	refreshed := func() *time.Time {
		t.Helper()
		var at *time.Time
		if err := pool.QueryRow(ctx, `SELECT refreshed_at FROM source_boilerplate WHERE source_id = $1`, src).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}

	// Settled: the first count runs.
	if _, err := r.step(ctx); err != nil {
		t.Fatal(err)
	}
	first := refreshed()
	if first == nil {
		t.Fatal("the first count did not run")
	}
	// A new batch is uploaded while the job still runs: a request, and a document in flight. The next count waits for it.
	time.Sleep(10 * time.Millisecond)
	exec(`UPDATE source_boilerplate SET requested_at = now() WHERE source_id = $1`, src)
	exec(`INSERT INTO documents (source_id, team_id, external_id, status) VALUES ($1, $2, 'new', 'processing')`, src, team)
	if _, err := r.step(ctx); !errors.Is(err, errUnsettled) {
		t.Fatalf("count with a document in flight: err = %v, want errUnsettled", err)
	}
	if at := refreshed(); !at.Equal(*first) {
		t.Fatal("counted while a document was in flight")
	}
	// Indexed: the count runs and covers it.
	exec(`UPDATE documents SET status = 'ready' WHERE external_id = 'new'`)
	if _, err := r.step(ctx); err != nil {
		t.Fatal(err)
	}
	if at := refreshed(); at.Equal(*first) {
		t.Fatal("the request made while the job ran was not counted")
	}

	// Past the settle deadline a count no longer waits (a stuck document can't block the source for ever).
	exec(`UPDATE source_boilerplate SET requested_at = now() WHERE source_id = $1`, src)
	exec(`UPDATE documents SET status = 'processing' WHERE external_id = 'new'`)
	r.settleUntil = time.Now().Add(-time.Second)
	if _, err := r.step(ctx); err != nil {
		t.Fatalf("past the deadline: %v", err)
	}
}
