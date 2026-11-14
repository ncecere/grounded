package store_test

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
)

// TestDocumentCountsBench measures what #249 is about: the time to store one document in a team that already holds many
// (the upload transaction: the team's usage lock, the usage read, the insert), and the reads of the source and admin
// pages. It is a measurement, not a check: it runs only with GROUNDED_COUNTERS_BENCH set to the number of documents to
// seed (for example 100000), and logs its numbers.
func TestDocumentCountsBench(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("GROUNDED_COUNTERS_BENCH"))
	if n <= 0 {
		t.Skip("set GROUNDED_COUNTERS_BENCH to the number of documents to seed")
	}
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	b := &bench{t: t, ctx: ctx, pool: pool}
	b.seed(n)
	t.Logf("seeded %d documents", n)
	b.uploads("sequential", 1, 500)
	b.uploads("8 concurrent", 8, 100)
	q := dbgen.New(pool)
	b.timed("SourceDocumentStats (source page)", func() error {
		_, err := q.SourceDocumentStats(ctx, []uuid.UUID{b.source})
		return err
	})
	b.timed("ListSourceTags (documents table)", func() error { _, err := q.ListSourceTags(ctx, b.source); return err })
	b.timed("TeamCounts (admin team page)", func() error { _, err := q.TeamCounts(ctx, b.team); return err })
	b.timed("ListTeamsAdmin (admin teams page)", func() error {
		_, err := q.ListTeamsAdmin(ctx, dbgen.ListTeamsAdminParams{PageSize: 50})
		return err
	})
	b.timed("TeamDocumentUsage (usage check)", func() error {
		_, err := q.TeamDocumentUsage(ctx, b.team)
		return err
	})
}

// TestDocumentCountsBulkBench measures what the counters cost on large statements: the reconcile (and the backfill
// migration, which is the same statement) over every document, and one update of every document of a source with the
// triggers and without them. Like TestDocumentCountsBench it runs only with GROUNDED_COUNTERS_BENCH set.
func TestDocumentCountsBulkBench(t *testing.T) {
	n, _ := strconv.Atoi(os.Getenv("GROUNDED_COUNTERS_BENCH"))
	if n <= 0 {
		t.Skip("set GROUNDED_COUNTERS_BENCH to the number of documents to seed")
	}
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	b := &bench{t: t, ctx: ctx, pool: pool}
	b.seed(n)
	q := dbgen.New(pool)
	for _, kind := range []string{"teams", "sources", "tags"} {
		t0 := time.Now()
		if _, err := q.ReconcileDocumentCounts(ctx, kind); err != nil {
			t.Fatal(err)
		}
		t.Logf("reconcile %s over %d documents: %s", kind, n, time.Since(t0).Round(time.Millisecond))
	}
	for _, on := range []bool{false, true, false, true} {
		if !on {
			b.exec(`ALTER TABLE documents DISABLE TRIGGER documents_count_update`)
		}
		b.exec(`VACUUM documents`) // each update leaves a dead copy of every row; without this the later runs pay for it
		t0 := time.Now()
		b.exec(`UPDATE documents SET status = CASE WHEN status = 'ready' THEN 'queued' ELSE 'ready' END WHERE source_id = $1`, b.source)
		t.Logf("update of %d documents' status, triggers %v: %s", n, on, time.Since(t0).Round(time.Millisecond))
		b.exec(`ALTER TABLE documents ENABLE TRIGGER documents_count_update`)
	}
}

type bench struct {
	t            *testing.T
	ctx          context.Context
	pool         *pgxpool.Pool
	team, source uuid.UUID
}

func (b *bench) exec(sql string, args ...any) {
	b.t.Helper()
	if _, err := b.pool.Exec(b.ctx, sql, args...); err != nil {
		b.t.Fatalf("%s: %v", sql, err)
	}
}

// seed makes a team with one upload source holding n documents: mostly ready, some failed or processing, a few with
// tags and a few flagged for a personal-data review, in batches of 100,000.
func (b *bench) seed(n int) {
	b.team, b.source = uuid.New(), uuid.New()
	conn, model, prof := uuid.New(), uuid.New(), uuid.New()
	b.exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	b.exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions)
		VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	b.exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap)
		VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 512, 0)`, prof, model)
	b.exec(`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, 'bench', 'Bench', 'restricted')`, b.team)
	b.exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 'Files', 'upload', 'open', $3)`,
		b.source, b.team, prof)
	for from := 0; from < n; from += 100_000 {
		to := min(from+100_000, n)
		b.exec(`INSERT INTO documents (source_id, team_id, external_id, title, filename, size_bytes, status, chunk_count, tags, metadata)
			SELECT $1, $2, 'file-' || i || '.pdf', 'File ' || i, 'file-' || i || '.pdf', 20000 + i % 5000,
			       CASE WHEN i % 50 = 0 THEN 'failed' WHEN i % 97 = 0 THEN 'processing' ELSE 'ready' END, 10 + i % 30,
			       CASE WHEN i % 10 = 0 THEN ARRAY['tag-' || (i % 40)] ELSE '{}' END,
			       CASE WHEN i % 200 = 0 THEN '{"pii": {"state": "flagged"}}'::jsonb ELSE '{"parser": "pdf", "pages": 3}'::jsonb END
			FROM generate_series($3::int, $4::int - 1) AS i`, b.source, b.team, from, to)
	}
	b.exec(`VACUUM ANALYZE documents`)
}

// uploads stores per×workers new documents the way an upload does, and logs the time per document.
func (b *bench) uploads(label string, workers, per int) {
	var wg sync.WaitGroup
	errs := make(chan error, workers)
	durations := make([][]time.Duration, workers)
	start := time.Now()
	for w := range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range per {
				t0 := time.Now()
				if err := b.upload(fmt.Sprintf("new-%s-%d-%d.pdf", label, w, i)); err != nil {
					errs <- err
					return
				}
				durations[w] = append(durations[w], time.Since(t0))
			}
		}()
	}
	wg.Wait()
	close(errs)
	if err := <-errs; err != nil {
		b.t.Fatal(err)
	}
	wall := time.Since(start)
	var all []time.Duration
	for _, d := range durations {
		all = append(all, d...)
	}
	b.t.Logf("upload, %s: %d documents in %s: %.2f ms per document (wall), p50 %s, p95 %s", label, len(all), wall.Round(time.Millisecond),
		float64(wall.Microseconds())/1000/float64(len(all)), pct(all, 50), pct(all, 95))
}

func (b *bench) upload(name string) error {
	return pgx.BeginFunc(b.ctx, b.pool, func(tx pgx.Tx) error {
		q := dbgen.New(tx)
		if err := q.LockTeamUsage(b.ctx, b.team); err != nil {
			return err
		}
		if _, err := q.TeamDocumentUsage(b.ctx, b.team); err != nil {
			return err
		}
		_, err := q.UpsertUploadedDocument(b.ctx, dbgen.UpsertUploadedDocumentParams{
			ID: uuid.New(), SourceID: b.source, TeamID: uuid.NullUUID{UUID: b.team, Valid: true}, ExternalID: name,
			Filename: name, ContentType: "application/pdf", SizeBytes: 12345, Sha256: "x", BlobKey: "k/" + name,
		})
		return err
	})
}

// timed runs f 20 times and logs the median and the slowest.
func (b *bench) timed(label string, f func() error) {
	var all []time.Duration
	for range 20 {
		t0 := time.Now()
		if err := f(); err != nil {
			b.t.Fatalf("%s: %v", label, err)
		}
		all = append(all, time.Since(t0))
	}
	b.t.Logf("%s: p50 %s, max %s", label, pct(all, 50), pct(all, 100))
}

func pct(d []time.Duration, p int) time.Duration {
	s := append([]time.Duration(nil), d...)
	sort.Slice(s, func(i, j int) bool { return s[i] < s[j] })
	i := (len(s) - 1) * p / 100
	return s[i].Round(10 * time.Microsecond)
}
