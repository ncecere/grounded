package vectorstore_test

import (
	"context"
	"math/rand"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/vectorstore"
)

func TestVersionAtLeast(t *testing.T) {
	for v, want := range map[string]bool{"0.8.0": true, "0.8.6": true, "0.10": true, "1.0.0": true, "0.7.4": false, "0.5": false, "x": false, "": false} {
		if got := vectorstore.VersionAtLeast(v, 0, 8); got != want {
			t.Errorf("%q: %v", v, got)
		}
	}
}

func TestDocFilterSQL(t *testing.T) {
	after := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	f := vectorstore.DocFilter{Kinds: []string{"pdf"}, Tags: []string{"a"}, URLPrefixes: []string{"https://x/"}, UpdatedAfter: &after}
	sql, args := f.SQL("d", 4)
	want := "d.kind = ANY($4::text[]) AND d.tags && $5::text[] AND EXISTS (SELECT 1 FROM unnest($6::text[]) p WHERE left(d.url, length(p)) = p) AND d.updated_at >= $7"
	if sql != want || len(args) != 4 {
		t.Fatalf("sql = %s (%d args)", sql, len(args))
	}
	if sql, args := (vectorstore.DocFilter{}).SQL("d", 1); sql != "true" || args != nil {
		t.Fatalf("empty = %s %v", sql, args)
	}
}

// TestFilteredSearchRecall measures recall@10 of metadata-filtered search on
// the HNSW path against exact search (the ground truth), for pgvector's
// iterative index scans and for the over-fetch fallback used before 0.8.
// Every returned hit must match the filter.
func TestFilteredSearchRecall(t *testing.T) {
	const (
		dims    = 16
		docs    = 200
		perDoc  = 20 // 4,000 vectors
		k       = 10
		queries = 25
	)
	f := newFixture(t, dims)
	ctx := context.Background()
	exact := &vectorstore.PGVector{Pool: f.pool}
	if err := exact.EnsureProfile(ctx, f.profile); err != nil {
		t.Fatal(err)
	}
	src := uuid.New()
	if _, err := f.pool.Exec(ctx, `INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, 'recall', 'upload', 'open', $3)`, src, f.team, f.profile.ID); err != nil {
		t.Fatal(err)
	}
	rng := rand.New(rand.NewSource(42))
	var recs []vectorstore.Record
	for d := 0; d < docs; d++ {
		doc := uuid.New()
		var tags []string
		switch {
		case d%10 == 0: // 10% of documents
			tags = []string{"ten"}
		case d%50 == 1: // 2%
			tags = []string{"two"}
		default:
			tags = []string{}
		}
		if _, err := f.pool.Exec(ctx, `INSERT INTO documents (id, source_id, team_id, external_id, tags) VALUES ($1, $2, $3, $4, $5)`,
			doc, src, f.team, doc.String(), tags); err != nil {
			t.Fatal(err)
		}
		ids := make([]uuid.UUID, perDoc)
		for i := range ids {
			ids[i] = uuid.New()
			v := make([]float32, dims)
			for j := range v {
				v[j] = float32(rng.NormFloat64())
			}
			recs = append(recs, vectorstore.Record{ChunkID: ids[i], SourceID: src, Vector: unit(v...)})
		}
		if _, err := f.pool.Exec(ctx, `INSERT INTO chunks (id, document_id, source_id, ordinal, content, token_count, content_tsv)
			SELECT id, $2, $3, ord, 'x', 1, to_tsvector('x') FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, ord)`, ids, doc, src); err != nil {
			t.Fatal(err)
		}
	}
	if err := pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error { return exact.Upsert(ctx, tx, f.profile, recs) }); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `ANALYZE`); err != nil {
		t.Fatal(err)
	}
	var version string
	_ = f.pool.QueryRow(ctx, `SELECT extversion FROM pg_extension WHERE extname = 'vector'`).Scan(&version)

	no := false
	iterative := &vectorstore.PGVector{Pool: f.pool}
	fallback := &vectorstore.PGVector{Pool: f.pool, IterativeScan: &no}
	tagged := map[string]map[uuid.UUID]bool{}
	rows, err := f.pool.Query(ctx, `SELECT c.id, t FROM chunks c JOIN documents d ON d.id = c.document_id, unnest(d.tags) t WHERE c.source_id = $1`, src)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id uuid.UUID
		var tag string
		_ = rows.Scan(&id, &tag)
		if tagged[tag] == nil {
			tagged[tag] = map[uuid.UUID]bool{}
		}
		tagged[tag][id] = true
	}
	rows.Close()

	recall := func(store *vectorstore.PGVector, tag string) float64 {
		t.Helper()
		qr := rand.New(rand.NewSource(7))
		found, total := 0, 0
		for i := 0; i < queries; i++ {
			q := make([]float32, dims)
			for j := range q {
				q[j] = float32(qr.NormFloat64())
			}
			q = unit(q...)
			filter := vectorstore.Filter{SourceIDs: []uuid.UUID{src}, Docs: vectorstore.DocFilter{Tags: []string{tag}}}
			truth, err := exact.Search(ctx, f.profile, q, filter, k) // Estimated 0: exact
			if err != nil {
				t.Fatal(err)
			}
			filter.Estimated = 1 << 40 // force the HNSW path
			got, err := store.Search(ctx, f.profile, q, filter, k)
			if err != nil {
				t.Fatal(err)
			}
			want := map[uuid.UUID]bool{}
			for _, h := range truth {
				want[h.ChunkID] = true
				if !tagged[tag][h.ChunkID] {
					t.Fatalf("exact search returned an unfiltered chunk")
				}
			}
			for _, h := range got {
				if !tagged[tag][h.ChunkID] {
					t.Fatalf("filtered search returned a chunk without tag %q", tag)
				}
				if want[h.ChunkID] {
					found++
				}
			}
			total += len(truth)
		}
		return float64(found) / float64(total)
	}
	for _, tag := range []string{"ten", "two"} {
		it, fb := recall(iterative, tag), recall(fallback, tag)
		t.Logf("pgvector %s, %d vectors, tag %q (%d chunks): recall@%d iterative=%.3f over-fetch=%.3f",
			version, docs*perDoc, tag, len(tagged[tag]), k, it, fb)
		if vectorstore.VersionAtLeast(version, 0, 8) && it < 0.9 {
			t.Errorf("iterative recall for %q = %.3f", tag, it)
		}
		if tag == "ten" && fb < 0.5 {
			t.Errorf("over-fetch recall for %q = %.3f", tag, fb)
		}
	}
}
