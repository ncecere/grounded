package ingest

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/chunk"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/testutil"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// A re-chunk of a document of a profile with parents moves the passages it keeps, and every passage ends with the parent range of the new
// list (parent/child retrieval, docs/parent-child-retrieval.md §3). Fail-before: reorderChunks moves kept rows to negative ordinals on the way,
// which a row that still carries its old range refuses (chunks_parent_range_check); and without setParents the kept row would keep a range that
// belongs to the old list.
func TestCommitRechunkRewritesParentRanges(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	conn, model, profID, src, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, conn)
	exec(`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, model, conn)
	exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap, parent_tokens) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 128, 0, 256)`, profID, model)
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, NULL, 's', 'web', 'open', $2)`, src, profID)
	exec(`INSERT INTO documents (id, source_id, external_id, status, version) VALUES ($1, $2, 'https://a.example/', 'ready', 1)`, doc, src)

	vs := &vectorstore.PGVector{Pool: pool}
	prof := vectorstore.Profile{ID: profID, Dimensions: 4, StorageType: "halfvec"}
	if err := vs.EnsureProfile(ctx, prof); err != nil {
		t.Fatal(err)
	}
	keep, drop := uuid.New(), uuid.New()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, insertChunksSQL, doc, src, []uuid.UUID{keep, drop}, []int32{0, 1},
			[]string{"Real content", "Footer"}, []string{"Guide", "Guide"}, []int32{0, 0}, []int32{0, 0}, []int32{60, 60}, profID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE chunks SET parent_first = 0, parent_last = 1 WHERE document_id = $1`, doc); err != nil {
			return err
		}
		return vs.Upsert(ctx, tx, prof, []vectorstore.Record{
			{ChunkID: keep, SourceID: src, Vector: []float32{1, 0, 0, 0}},
			{ChunkID: drop, SourceID: src, Vector: []float32{0, 1, 0, 0}},
		})
	})
	if err != nil {
		t.Fatal(err)
	}

	var p Processor
	p.Pool, p.Vectors = pool, vs
	var profile dbgen.EmbeddingProfile
	profile.ID, profile.Dimensions, profile.StorageType, profile.ParentTokens = profID, 4, "halfvec", 256
	target := catalog.EmbedTarget{Profile: profile, Model: dbgen.Model{ID: model}}
	// The new list: the kept passage moves to the end of three, in the same section as its new neighbour but not the first.
	guide := []string{"Guide"}
	rc := rechunked{
		chunks: []chunk.Chunk{
			{Ordinal: 0, Content: "New intro", HeadingPath: guide, Tokens: 60},
			{Ordinal: 1, Content: "More", HeadingPath: guide, Tokens: 60},
			{Ordinal: 2, Content: "Real content", HeadingPath: guide, Tokens: 60},
			{Ordinal: 3, Content: "Other section", HeadingPath: []string{"Other"}, Tokens: 60},
		},
		reuse:   []uuid.UUID{uuid.Nil, uuid.Nil, keep, uuid.Nil},
		fresh:   []int{0, 1, 3},
		vectors: [][]float32{{0, 0, 1, 0}, {0, 0, 0, 1}, {1, 1, 0, 0}},
		usage:   EmbedUsage{Requests: 1, Counted: 3},
	}
	row := dbgen.StaleDocumentBlocksRow{DocumentID: doc, Version: 1}
	tctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := p.commitRechunk(tctx, dbgen.DataSource{ID: src}, row, target, bpPlan{hashes: []int64{1}, rev: 2}, rc); err != nil {
		t.Fatalf("commitRechunk: %v", err)
	}
	got := map[int32][2]int32{}
	rows, err := pool.Query(ctx, `SELECT ordinal, parent_first, parent_last, id FROM chunks WHERE document_id = $1 ORDER BY ordinal`, doc)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var o int32
		var f, l *int32
		var id uuid.UUID
		if err := rows.Scan(&o, &f, &l, &id); err != nil {
			t.Fatal(err)
		}
		if f == nil || l == nil {
			t.Fatalf("passage %d has no parent range", o)
		}
		got[o] = [2]int32{*f, *l}
		if id == keep && o != 2 {
			t.Errorf("the kept passage is at ordinal %d, want 2", o)
		}
	}
	// 60-token passages and a size of 256: the section's three passages (180) are one parent; the next section is another.
	want := map[int32][2]int32{0: {0, 2}, 1: {0, 2}, 2: {0, 2}, 3: {3, 3}}
	if len(got) != 4 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] || got[3] != want[3] {
		t.Errorf("ranges = %v, want %v", got, want)
	}
}

// A profile without parents writes no range: setParents is then a no-op that touches nothing (the default, and every profile that exists).
func TestSetParentsIsANoOpWithoutParents(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return setParents(ctx, tx, uuid.New(), uuid.New(), 0, []chunk.Chunk{{Ordinal: 0, Tokens: 1}})
	})
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM chunks WHERE parent_first IS NOT NULL OR parent_last IS NOT NULL`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("ranges = %d, %v", n, err)
	}
}

// The database refuses a range that does not hold its own passage, one with only one end, and one wider than a parent can be.
func TestParentRangeCheckConstraint(t *testing.T) {
	pool, _ := testutil.NewDB(t)
	ctx := context.Background()
	conn, model, profID, src, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO model_connections (id, name, base_url) VALUES ($1, 'c', 'http://x/v1')`, []any{conn}},
		{`INSERT INTO models (id, connection_id, key, upstream_model, display_name, kind, max_classification, dimensions) VALUES ($1, $2, 'e', 'e', 'E', 'embedding', 'open', 4)`, []any{model, conn}},
		{`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap, parent_tokens) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 128, 0, 256)`, []any{profID, model}},
		{`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, NULL, 's', 'web', 'open', $2)`, []any{src, profID}},
		{`INSERT INTO documents (id, source_id, external_id, status, version) VALUES ($1, $2, 'https://a.example/', 'ready', 1)`, []any{doc, src}},
		{`INSERT INTO chunks (document_id, source_id, profile_id, ordinal, content, token_count, content_tsv) VALUES ($1, $2, $3, 5, 'x', 1, to_tsvector('x'))`, []any{doc, src, profID}},
	} {
		if _, err := pool.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	for name, set := range map[string]string{
		"the range does not hold the passage (before)": "parent_first = 6, parent_last = 8",
		"the range does not hold the passage (after)":  "parent_first = 1, parent_last = 4",
		"only the first":        "parent_first = 5",
		"only the last":         "parent_last = 5",
		"more than 64 passages": "parent_first = 0, parent_last = 64",
		"a negative first":      "parent_first = -1, parent_last = 5",
	} {
		if _, err := pool.Exec(ctx, `UPDATE chunks SET `+set+` WHERE document_id = $1`, doc); err == nil {
			t.Errorf("%s: the database accepted it", name)
		}
	}
	for name, set := range map[string]string{"its own passage": "parent_first = 5, parent_last = 5", "64 passages": "parent_first = 2, parent_last = 65", "none": "parent_first = NULL, parent_last = NULL"} {
		if _, err := pool.Exec(ctx, `UPDATE chunks SET `+set+` WHERE document_id = $1`, doc); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}
