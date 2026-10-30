package ingest

import (
	"context"
	"fmt"
	"log/slog"
	"math/rand"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/boilerplate"
	"github.com/ncecere/grounded/internal/testutil"
)

// fuzzySource makes a web source and returns its id.
func fuzzySource(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	conn, model, prof, src := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, []any{conn}},
		{`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, []any{model, conn}},
		{`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 512, 0)`, []any{prof, model}},
		{`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, NULL, 's', 'web', 'open', $2)`, []any{src, prof}},
	} {
		if _, err := pool.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	return src
}

func packSketches(blocks map[int64]string) ([]int64, []byte) {
	var hashes []int64
	var packed []byte
	for h, text := range blocks {
		s, _ := boilerplate.SketchOf(text)
		hashes, packed = append(hashes, h), append(packed, s[:]...)
	}
	return hashes, packed
}

// The stream a refresh clusters from: ready documents with sketches of the current version, shortest URL first, the
// document that keeps a cluster's copy.
func TestFuzzyClustersFromPostgres(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	src := fuzzySource(t, pool)
	p := &Processor{Pool: pool, Log: slog.Default()}
	a := "Last updated March 3, 2026 by the Office of the Test Registrar, 101 Main Hall."
	b := "Last updated October 17, 2025 by the Office of the Test Registrar, 101 Main Hall."
	type doc struct {
		url, status string
		version     int
		hash        int64
		text        string
		corrupt     bool
	}
	docs := []doc{
		{"https://example.edu/a/long/page", "ready", 1, 1, a, false},
		{"https://example.edu/", "ready", 1, 2, b, false}, // the shortest URL: keeps the copy
		{"https://example.edu/c", "ready", 1, 3, a, false},
		{"https://example.edu/d", "failed", 1, 4, a, false},      // not ready
		{"https://example.edu/e", "ready", 0, 5, a, false},       // no sketches of this version yet
		{"https://example.edu/f", "ready", 1, 6, a, true},        // inconsistent record: skipped, not fatal
		{"https://example.edu/g", "ready", 1, 7, "short", false}, // no eligible block
	}
	ids := make([]uuid.UUID, len(docs))
	for i, d := range docs {
		ids[i] = uuid.New()
		if _, err := pool.Exec(ctx, `INSERT INTO documents (id, source_id, external_id, status, version) VALUES ($1, $2, $3, $4, 1)`, ids[i], src, d.url, d.status); err != nil {
			t.Fatal(err)
		}
		var hashes []int64
		var packed []byte
		if _, ok := boilerplate.SketchOf(d.text); ok {
			hashes, packed = packSketches(map[int64]string{d.hash: d.text})
		}
		if d.corrupt {
			packed = packed[:5]
		}
		if hashes == nil {
			hashes, packed = []int64{}, []byte{}
		}
		if _, err := pool.Exec(ctx, `INSERT INTO document_blocks (document_id, source_id, hashes, rev, sketch_version, fuzzy_hashes, sketches) VALUES ($1, $2, $3, 0, $4, $3, $5)`,
			ids[i], src, hashes, int16(d.version), packed); err != nil {
			t.Fatal(err)
		}
	}
	clusters, got, exceeded, err := p.fuzzyClusters(ctx, src, 2)
	if err != nil || exceeded {
		t.Fatalf("err %v, exceeded %v", err, exceeded)
	}
	if len(clusters) != 1 || len(clusters[0].Members) != 3 || clusters[0].Docs != 3 {
		t.Fatalf("clusters = %+v, want one of the three footer variants in the three documents that count", clusters)
	}
	if first := got[clusters[0].First]; first != ids[1] {
		t.Errorf("the copy stays in %s, want the shortest URL %s", first, ids[1])
	}
	if fmt.Sprint(clusters[0].Members) != "[1 2 3]" {
		t.Errorf("members = %v", clusters[0].Members)
	}
}

// TestFuzzyAtScalePostgres measures the whole classification of a source of 100,000 documents of 30 eligible blocks each
// in Postgres: GROUNDED_FUZZY_SCALE=1 RUN_ID=... bash /tmp/grounded-test-with-deps.sh go test ./internal/ingest -run AtScale -v.
func TestFuzzyAtScalePostgres(t *testing.T) {
	if os.Getenv("GROUNDED_FUZZY_SCALE") == "" {
		t.Skip("set GROUNDED_FUZZY_SCALE=1 to measure 100,000 documents")
	}
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	src := fuzzySource(t, pool)
	p := &Processor{Pool: pool, Log: slog.Default()}
	const n = 100_000
	menu := make([]byte, 0, 32)
	for i := 0; i < 32; i++ {
		menu = append(menu, byte(i*7))
	}
	r := rand.New(rand.NewSource(1))
	start := time.Now()
	docRows := make([][]any, 0, n)
	blockRows := make([][]any, 0, n)
	for i := 0; i < n; i++ {
		id := uuid.New()
		hashes := make([]int64, 30)
		packed := make([]byte, 0, 30*boilerplate.SketchValues)
		for j := range hashes {
			hashes[j] = int64(i)*100 + int64(j) + 1000
			s := make([]byte, boilerplate.SketchValues)
			if j == 0 {
				copy(s, menu) // the same menu sketch on every page
				hashes[j] = int64(i % 12)
			} else {
				r.Read(s)
			}
			packed = append(packed, s...)
		}
		docRows = append(docRows, []any{id, src, fmt.Sprintf("https://example.edu/p/%d", i), "ready"})
		blockRows = append(blockRows, []any{id, src, hashes, int16(boilerplate.SketchVersion), hashes, packed})
	}
	if _, err := pool.CopyFrom(ctx, pgx.Identifier{"documents"}, []string{"id", "source_id", "external_id", "status"}, pgx.CopyFromRows(docRows)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.CopyFrom(ctx, pgx.Identifier{"document_blocks"}, []string{"document_id", "source_id", "hashes", "sketch_version", "fuzzy_hashes", "sketches"}, pgx.CopyFromRows(blockRows)); err != nil {
		t.Fatal(err)
	}
	docRows, blockRows = nil, nil
	loading := time.Since(start)
	if _, err := pool.Exec(ctx, `VACUUM ANALYZE document_blocks`); err != nil {
		t.Fatal(err)
	}
	var size int64
	if err := pool.QueryRow(ctx, `SELECT pg_total_relation_size('document_blocks')`).Scan(&size); err != nil {
		t.Fatal(err)
	}

	var peak uint64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		var m runtime.MemStats
		for {
			runtime.ReadMemStats(&m)
			peak = max(peak, m.HeapAlloc)
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
	}()
	runtime.GC()
	begin := time.Now()
	clusters, _, exceeded, err := p.fuzzyClusters(ctx, src, 20_000)
	took := time.Since(begin)
	close(stop)
	<-done
	if err != nil || exceeded || len(clusters) != 1 || clusters[0].Docs != n {
		t.Fatalf("clusters = %d, exceeded %v, err %v", len(clusters), exceeded, err)
	}
	t.Logf("%d documents of 30 blocks: loaded in %s; document_blocks is %d MB; classified in %s (three passes over Postgres); peak heap %d MB",
		n, loading.Round(time.Second), size>>20, took.Round(100*time.Millisecond), peak>>20)
}
