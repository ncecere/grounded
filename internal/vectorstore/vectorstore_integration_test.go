package vectorstore_test

import (
	"context"
	"math"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// fixture inserts the rows a vector needs: team, connection, model,
// profile, source, document and chunks.
type fixture struct {
	pool    *pgxpool.Pool
	profile vectorstore.Profile
	team    uuid.UUID
}

func newFixture(t *testing.T, dims int) *fixture {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	f := &fixture{pool: pool, team: uuid.New()}
	conn, model, prof := uuid.New(), uuid.New(), uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO teams (id, slug, name, max_classification) VALUES ($1, $2, 'T', 'open')`, []any{f.team, "t-" + f.team.String()[:8]}},
		{`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, []any{conn}},
		{`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', $3)`, []any{model, conn, dims}},
		{`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, $3, 'halfvec', 512, 0)`, []any{prof, model, dims}},
	} {
		if _, err := pool.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	f.profile = vectorstore.Profile{ID: prof, Dimensions: dims, StorageType: "halfvec"}
	return f
}

// source creates a source with one document and returns (source, document).
func (f *fixture) source(t *testing.T, name string) (uuid.UUID, uuid.UUID) {
	src, doc := uuid.New(), uuid.New()
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, $2, $3, 'upload', 'open', $4)`, src, f.team, name, f.profile.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `INSERT INTO documents (id, source_id, team_id, external_id) VALUES ($1, $2, $3, $4)`, doc, src, f.team, name+".txt"); err != nil {
		t.Fatal(err)
	}
	return src, doc
}

func (f *fixture) chunk(t *testing.T, src, doc uuid.UUID, ord int) uuid.UUID {
	id := uuid.New()
	if _, err := f.pool.Exec(context.Background(), `INSERT INTO chunks (id, document_id, source_id, ordinal, content, token_count, content_tsv) VALUES ($1, $2, $3, $4, 'x', 1, to_tsvector('x'))`, id, doc, src, ord); err != nil {
		t.Fatal(err)
	}
	return id
}

func unit(v ...float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x * x)
	}
	for i := range v {
		v[i] /= float32(math.Sqrt(n))
	}
	return v
}

func TestPGVectorSearchIsScopedAndOrdered(t *testing.T) {
	f := newFixture(t, 3)
	store := &vectorstore.PGVector{Pool: f.pool}
	ctx := context.Background()
	if err := store.EnsureProfile(ctx, f.profile); err != nil {
		t.Fatal(err)
	}
	if err := store.EnsureProfile(ctx, f.profile); err != nil { // idempotent
		t.Fatal(err)
	}
	srcA, docA := f.source(t, "a")
	srcB, docB := f.source(t, "b")
	near, far, other := f.chunk(t, srcA, docA, 0), f.chunk(t, srcA, docA, 1), f.chunk(t, srcB, docB, 0)
	err := pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		return store.Upsert(ctx, tx, f.profile, []vectorstore.Record{
			{ChunkID: near, SourceID: srcA, Vector: unit(1, 0.1, 0)},
			{ChunkID: far, SourceID: srcA, Vector: unit(0, 1, 0)},
			{ChunkID: other, SourceID: srcB, Vector: unit(1, 0, 0)}, // closest overall, but another source
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	hits, err := store.Search(ctx, f.profile, unit(1, 0, 0), vectorstore.Filter{SourceIDs: []uuid.UUID{srcA}}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 2 || hits[0].ChunkID != near || hits[1].ChunkID != far || hits[0].Distance >= hits[1].Distance {
		t.Fatalf("hits = %+v", hits)
	}
	// The HNSW path (large estimated sets) returns the same scoped results.
	ann, err := store.Search(ctx, f.profile, unit(1, 0, 0), vectorstore.Filter{SourceIDs: []uuid.UUID{srcA}, Estimated: 1 << 40}, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(ann) != 2 || ann[0].ChunkID != near || ann[1].ChunkID != far {
		t.Fatalf("hnsw path hits = %+v", ann)
	}
	if _, err := store.Search(ctx, f.profile, unit(1, 0, 0), vectorstore.Filter{}, 5); err != vectorstore.ErrNoSources {
		t.Fatalf("unscoped search err = %v", err)
	}
	// Wrong dimensions are rejected before reaching Postgres.
	if _, err := store.Search(ctx, f.profile, []float32{1, 0}, vectorstore.Filter{SourceIDs: []uuid.UUID{srcA}}, 5); err == nil {
		t.Fatal("wrong dimension accepted")
	}

	// Deleting a document removes its vectors through the chunk cascade.
	if _, err := f.pool.Exec(ctx, `DELETE FROM documents WHERE id = $1`, docA); err != nil {
		t.Fatal(err)
	}
	hits, _ = store.Search(ctx, f.profile, unit(1, 0, 0), vectorstore.Filter{SourceIDs: []uuid.UUID{srcA, srcB}}, 5)
	if len(hits) != 1 || hits[0].ChunkID != other {
		t.Fatalf("after delete hits = %+v", hits)
	}
}

func TestSearchBeforeAnyVectorsIsEmpty(t *testing.T) {
	f := newFixture(t, 3)
	store := &vectorstore.PGVector{Pool: f.pool}
	hits, err := store.Search(context.Background(), f.profile, unit(1, 0, 0), vectorstore.Filter{SourceIDs: []uuid.UUID{uuid.New()}}, 5)
	if err != nil || len(hits) != 0 {
		t.Fatalf("hits = %v err = %v", hits, err)
	}
}
