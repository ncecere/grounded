package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"
)

func cmdStorage(args []string) error {
	fs := flag.NewFlagSet("storage", flag.ExitOnError)
	dsn := fs.String("dsn", defaultBenchDSN, "benchmark database: scratch tables sparkbench_* are created (and dropped unless -keep); Grounded's tables are only read")
	source := fs.String("source", "99417050-a92f-4f65-84ca-4d77379d2c05", "the benchmark upload source ID")
	profile := fs.String("profile", "01744571-9c90-4c15-80aa-f08a74ce47bf", "the benchmark embedding profile ID")
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory")
	nomicQueries := fs.String("nomic-query-vectors", "/tmp/ragbench/queries-prefix.jsonl", "stored nomic query vectors")
	cacheDir := fs.String("cache", "/tmp/sparkbench/cache", "qwen3 cache written by \"retrieval -set fiqa\"")
	nq := fs.Int("queries", 200, "queries timed per table")
	ef := fs.Int("ef-search", 400, "hnsw.ef_search (Grounded's default)")
	keep := fs.Bool("keep", false, "keep the scratch tables")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: sparkbench storage [flags]\n\nCopies the FiQA KB's vectors into scratch tables shaped like Grounded's\nemb_<profile> tables (halfvec, storage external, source_id btree, HNSW m=16\nef_construction=64): nomic 768 dims, qwen3 2560 and 1024 dims (Matryoshka\ntruncation). Reports table, TOAST and index sizes, HNSW build time, and exact\nand HNSW search latency (Grounded's SQL) with HNSW recall@10 against exact.\nRun \"retrieval -set fiqa\" first so the qwen3 vectors are cached.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	ctx := context.Background()
	es, err := loadFiQA(ctx, *dsn, *source, *profile, *data, *nomicQueries)
	if err != nil {
		return err
	}
	defer es.pool.Close()
	model := envOr("SPARK_EMBEDDING_MODEL", "qwen3-embedding-4b")
	docs, err := readCache(cachePath(*cacheDir, model+"|"+es.name+"|chunks|"))
	if err != nil {
		return err
	}
	queries, err := readCache(cachePath(*cacheDir, model+"|"+es.name+"|query|set|"+es.task))
	if err != nil {
		return err
	}
	if len(docs) < len(es.chunks) || len(queries) < len(es.queries) {
		return fmt.Errorf("qwen3 cache incomplete (%d/%d chunks, %d/%d queries): run retrieval -set fiqa first", len(docs), len(es.chunks), len(queries), len(es.queries))
	}
	n := min(*nq, len(es.queries))
	type variant struct {
		name string
		dims int
		doc  func(evalChunk) []float32
		qry  func(evalQuery) []float32
	}
	vs := []variant{
		{"nomic", 768, func(c evalChunk) []float32 { return c.nomic }, func(q evalQuery) []float32 { return q.nomic }},
		{"qwen3_2560", 2560, func(c evalChunk) []float32 { return docs[c.id.String()] }, func(q evalQuery) []float32 { return queries[q.id+"|"+q.text] }},
		{"qwen3_1024", 1024, func(c evalChunk) []float32 { return prepare(docs[c.id.String()], 1024, false) }, func(q evalQuery) []float32 { return prepare(queries[q.id+"|"+q.text], 1024, false) }},
	}
	src := uuid.MustParse(*source)
	fmt.Printf("%d vectors per table, %d timed queries, ef_search %d\n\n", len(es.chunks), n, *ef)
	fmt.Println("| table | dims | heap | TOAST | btree indexes | HNSW index | HNSW build | exact p50 / p95 ms | ms per 1k vectors | HNSW p50 / p95 ms | HNSW recall@10 |")
	fmt.Println("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
	for _, v := range vs {
		t := "sparkbench_" + v.name
		row, err := measureTable(ctx, es, t, v.dims, src, n, *ef, v.doc, v.qry)
		if err != nil {
			return err
		}
		fmt.Println(row)
		if !*keep {
			if _, err := es.pool.Exec(ctx, "DROP TABLE "+t); err != nil {
				return err
			}
		}
	}
	return nil
}

// measureTable builds one scratch table and its HNSW index and returns its
// markdown row: sizes, build time, exact and HNSW latency, HNSW recall@10.
func measureTable(ctx context.Context, es *evalSet, t string, dims int, src uuid.UUID, n, ef int,
	doc func(evalChunk) []float32, qry func(evalQuery) []float32) (string, error) {
	if err := createTable(ctx, es.pool, t, dims, es.chunks, src, doc); err != nil {
		return "", err
	}
	t0 := time.Now()
	if _, err := es.pool.Exec(ctx, fmt.Sprintf("CREATE INDEX %s_hnsw ON %s USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)", t, t)); err != nil {
		return "", err
	}
	build := time.Since(t0)
	if _, err := es.pool.Exec(ctx, "VACUUM ANALYZE "+t); err != nil {
		return "", err
	}
	var heap, toast, btree, hnsw int64
	if err := es.pool.QueryRow(ctx, `SELECT pg_relation_size(c.oid), COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0),
		pg_relation_size($2::regclass) + pg_relation_size($3::regclass), pg_relation_size($4::regclass)
		FROM pg_class c WHERE c.oid = $1::regclass`, t, t+"_pkey", t+"_source", t+"_hnsw").Scan(&heap, &toast, &btree, &hnsw); err != nil {
		return "", err
	}
	for i := 0; i < 3; i++ { // warm the cache
		_, _ = searchSQL(ctx, es.pool, t, dims, qry(es.queries[i]), src, false, ef)
	}
	exact, approx, recall, err := timeSearches(ctx, es, t, dims, src, n, ef, qry)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("| %s | %d | %s | %s | %s | %s | %s | %.1f / %.1f | %.2f | %.1f / %.1f | %.3f |", t, dims, mib(heap), mib(toast), mib(btree), mib(hnsw),
		build.Round(10*time.Millisecond), pct(exact, 50), pct(exact, 95), pct(exact, 50)/float64(len(es.chunks))*1000, pct(approx, 50), pct(approx, 95), recall), nil
}

// timeSearches runs the first n queries exactly and through HNSW; it
// returns both latencies (ms) and the mean HNSW recall@10 against exact.
func timeSearches(ctx context.Context, es *evalSet, t string, dims int, src uuid.UUID, n, ef int, qry func(evalQuery) []float32) (exact, approx []float64, recall float64, err error) {
	for _, q := range es.queries[:n] {
		qv := qry(q)
		t0 := time.Now()
		ex, err := searchSQL(ctx, es.pool, t, dims, qv, src, false, ef)
		if err != nil {
			return nil, nil, 0, err
		}
		exact = append(exact, float64(time.Since(t0).Microseconds())/1000)
		t0 = time.Now()
		ap, err := searchSQL(ctx, es.pool, t, dims, qv, src, true, ef)
		if err != nil {
			return nil, nil, 0, err
		}
		approx = append(approx, float64(time.Since(t0).Microseconds())/1000)
		want := map[uuid.UUID]bool{}
		for _, id := range ex[:min(10, len(ex))] {
			want[id] = true
		}
		got := 0
		for _, id := range ap[:min(10, len(ap))] {
			if want[id] {
				got++
			}
		}
		recall += float64(got) / float64(max(len(want), 1))
	}
	return exact, approx, recall / float64(n), nil
}

func mib(b int64) string { return fmt.Sprintf("%.1f MiB", float64(b)/(1<<20)) }

func envOr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

// createTable creates a table shaped like Grounded's emb_<profile> tables
// (without the chunks foreign key) and copies the vectors in.
func createTable(ctx context.Context, pool *pgxpool.Pool, t string, dims int, chunks []evalChunk, src uuid.UUID, vec func(evalChunk) []float32) error {
	for _, stmt := range []string{
		"DROP TABLE IF EXISTS " + t,
		fmt.Sprintf("CREATE TABLE %s (chunk_id uuid PRIMARY KEY, source_id uuid NOT NULL, embedding halfvec(%d) NOT NULL)", t, dims),
		fmt.Sprintf("ALTER TABLE %s ALTER COLUMN embedding SET STORAGE EXTERNAL", t),
		fmt.Sprintf("CREATE INDEX %s_source ON %s (source_id)", t, t),
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	pr, pw := io.Pipe()
	go func() {
		w := bufio.NewWriterSize(pw, 1<<20)
		for _, c := range chunks {
			fmt.Fprintf(w, "%s\t%s\t%s\n", c.id, src, pgvector.NewHalfVector(vec(c)).String())
		}
		_ = w.Flush()
		_ = pw.Close()
	}()
	if _, err := conn.Conn().PgConn().CopyFrom(ctx, pr, "COPY "+t+" (chunk_id, source_id, embedding) FROM STDIN"); err != nil {
		return fmt.Errorf("copy %s: %w", t, err)
	}
	log.Printf("%s: %d rows", t, len(chunks))
	return nil
}

// searchSQL runs Grounded's exact path (source_id index, sort) or its HNSW path
// (filter hidden from the btree, iterative scan) and returns 40 chunk IDs.
func searchSQL(ctx context.Context, pool *pgxpool.Pool, t string, dims int, q []float32, src uuid.UUID, hnsw bool, ef int) ([]uuid.UUID, error) {
	var out []uuid.UUID
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var stmts []string
		var sql string
		if hnsw {
			stmts = []string{"SET LOCAL enable_seqscan = off", "SET LOCAL enable_bitmapscan = off",
				fmt.Sprintf("SET LOCAL hnsw.ef_search = %d", ef), "SET LOCAL hnsw.iterative_scan = relaxed_order"}
			sql = fmt.Sprintf(`SELECT chunk_id FROM (SELECT chunk_id, embedding <=> $1::halfvec(%d) AS dist FROM %s
				WHERE CASE WHEN source_id = ANY($2::uuid[]) THEN true ELSE false END ORDER BY dist LIMIT 40) s ORDER BY dist`, dims, t)
		} else {
			stmts = []string{"SET LOCAL enable_indexscan = off"}
			sql = fmt.Sprintf(`SELECT chunk_id FROM %s WHERE source_id = ANY($2::uuid[]) ORDER BY embedding <=> $1::halfvec(%d) LIMIT 40`, t, dims)
		}
		for _, s := range stmts {
			if _, err := tx.Exec(ctx, s); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx, sql, pgvector.NewHalfVector(q).String(), []uuid.UUID{src})
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		return err
	})
	return out, err
}
