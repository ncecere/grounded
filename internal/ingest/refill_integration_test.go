package ingest_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"github.com/ncecere/grounded/internal/ingest"
	"github.com/ncecere/grounded/internal/testutil"
)

// A finishing document refills the free slots in its own commit
// transaction: the documents are queued and their jobs inserted at once,
// with no dispatch job to wait for. (Kicks that land while a dispatch job
// runs are dropped by its uniqueness; the load test found ingest running
// in bursts of the periodic dispatch: docs/benchmarks/load.md.)
func TestRefillQueuesInTheFinishingTransaction(t *testing.T) {
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
	for i := 0; i < 6; i++ {
		exec(`INSERT INTO documents (source_id, team_id, external_id) VALUES ($1, $2, $3)`, src, team, fmt.Sprintf("d%d", i))
	}
	// One document in flight of a per-team cap of 3.
	exec(`UPDATE documents SET status = 'processing' WHERE external_id = 'd0'`)

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{})
	if err != nil {
		t.Fatal(err)
	}
	count := func(sql string) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	finish := func(p *ingest.Processor) {
		t.Helper()
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `UPDATE documents SET status = 'ready' WHERE status = 'processing'`); err != nil {
				return err
			}
			return p.RefillWith(ctx, tx, client)
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	// Without a Dispatcher: a dispatch job is kicked, nothing is queued yet.
	finish(&ingest.Processor{Pool: pool, Log: testutil.Logger()})
	if q, d := count(`SELECT count(*) FROM documents WHERE status = 'queued'`), count(`SELECT count(*) FROM river_job WHERE kind = 'ingest.dispatch'`); q != 0 || d != 1 {
		t.Fatalf("kick: %d queued, %d dispatch jobs; want 0 and 1", q, d)
	}
	exec(`DELETE FROM river_job`)

	// With one: the finishing transaction fills every free slot (3 of 3).
	exec(`UPDATE documents SET status = 'processing' WHERE external_id = 'd1'`)
	dispatch := &ingest.DispatchWorker{Pool: pool, Log: testutil.Logger(), Limits: ingest.Limits{MaxInflight: 100, MaxInflightTeam: 3}}
	finish(&ingest.Processor{Pool: pool, Log: testutil.Logger(), Dispatcher: dispatch})
	if q := count(`SELECT count(*) FROM documents WHERE status = 'queued'`); q != 3 {
		t.Fatalf("queued = %d, want 3", q)
	}
	if j, d := count(`SELECT count(*) FROM river_job WHERE kind = 'ingest.document'`), count(`SELECT count(*) FROM river_job WHERE kind = 'ingest.dispatch'`); j != 3 || d != 0 {
		t.Fatalf("%d document jobs, %d dispatch jobs; want 3 and 0", j, d)
	}
}
