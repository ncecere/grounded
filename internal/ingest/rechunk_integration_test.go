package ingest

import (
	"context"
	"strings"
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

// A re-chunk by a process that has not yet ensured the profile's vector
// table (e.g. just after a restart) must not wait on its own transaction:
// CREATE INDEX IF NOT EXISTS locks the table before checking, and the
// transaction already deleted vector rows. Unchanged chunks keep their rows.
func TestCommitRechunkFreshProcess(t *testing.T) {
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
	exec(`INSERT INTO embedding_profiles (id, key, name, model_id, dimensions, storage_type, chunk_size, chunk_overlap) VALUES ($1, 'p', 'P', $2, 4, 'halfvec', 512, 0)`, profID, model)
	exec(`INSERT INTO data_sources (id, team_id, name, type, classification, embedding_profile_id) VALUES ($1, NULL, 's', 'web', 'open', $2)`, src, profID)
	exec(`INSERT INTO documents (id, source_id, external_id, status, version) VALUES ($1, $2, 'https://a.example/', 'ready', 1)`, doc, src)

	vs := &vectorstore.PGVector{Pool: pool}
	prof := vectorstore.Profile{ID: profID, Dimensions: 4, StorageType: "halfvec"}
	if err := vs.EnsureProfile(ctx, prof); err != nil { // an earlier process created the table
		t.Fatal(err)
	}
	keep, drop := uuid.New(), uuid.New()
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, insertChunksSQL, doc, src, []uuid.UUID{keep, drop}, []int32{0, 1},
			[]string{"Real content", "Footer"}, []string{"", ""}, []int32{0, 0}, []int32{0, 0}, []int32{2, 1}, profID); err != nil {
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

	var p Processor // fresh: nothing ensured yet
	p.Pool, p.Vectors = pool, vs
	var profile dbgen.EmbeddingProfile
	profile.ID, profile.Dimensions, profile.StorageType = profID, 4, "halfvec"
	target := catalog.EmbedTarget{Profile: profile, Model: dbgen.Model{ID: model}}
	rc := rechunked{
		chunks:  []chunk.Chunk{{Content: "New intro", Tokens: 2}, {Content: "Real content", Tokens: 2}},
		reuse:   []uuid.UUID{uuid.Nil, keep},
		fresh:   []int{0},
		vectors: [][]float32{{0, 0, 1, 0}},
		usage:   EmbedUsage{Requests: 1, Counted: 2},
	}
	row := dbgen.StaleDocumentBlocksRow{DocumentID: doc, Version: 1}
	tctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := p.commitRechunk(tctx, dbgen.DataSource{ID: src}, row, target, bpPlan{hashes: []int64{1, 2}, dropped: []int64{2}, rev: 3}, rc); err != nil {
		t.Fatalf("commitRechunk: %v", err)
	}

	rows, err := pool.Query(ctx, `SELECT c.id, c.ordinal, c.content FROM chunks c WHERE c.document_id = $1 ORDER BY c.ordinal`, doc)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	var kept bool
	for rows.Next() {
		var id uuid.UUID
		var ord int
		var content string
		if err := rows.Scan(&id, &ord, &content); err != nil {
			t.Fatal(err)
		}
		got = append(got, content)
		kept = kept || (id == keep && ord == 1)
	}
	if len(got) != 2 || got[0] != "New intro" || got[1] != "Real content" || !kept {
		t.Fatalf("chunks = %v (unchanged chunk kept at ordinal 1: %v)", got, kept)
	}
	var vectors, rev int
	var chunkCount int32
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM `+pgx.Identifier{"emb_" + strings.ReplaceAll(profID.String(), "-", "")}.Sanitize()+`),
		(SELECT rev FROM document_blocks WHERE document_id = $1), (SELECT chunk_count FROM documents WHERE id = $1)`, doc).Scan(&vectors, &rev, &chunkCount); err != nil {
		t.Fatal(err)
	}
	if vectors != 2 || rev != 3 || chunkCount != 2 {
		t.Fatalf("vectors = %d, rev = %d, chunk_count = %d", vectors, rev, chunkCount)
	}
}
