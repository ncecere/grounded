// Command vecbench runs the vector-store benchmark gate (ADR-0004).
//
// It loads clustered synthetic vectors into a pgvector table shaped like the
// application's (halfvec, HNSW cosine, source_id filter), then measures
// recall@k against exact search and latency for KB filters of different
// selectivity. The Phase 1 gate is 20M x 768 on production-like hardware:
//
//	go run ./cmd/vecbench -dsn "$DATABASE_URL" -n 20000000 -sources 20000
//
// It creates and drops its own table (vecbench_<n>); use a scratch database.
//
// With -real-table it benchmarks real embeddings instead: it copies an
// existing table shaped like Grounded's emb_<profile> tables (for example one
// written by "ragbench offline -export-table"), runs real query vectors
// (-query-vectors, JSONL from ragbench) through Grounded's HNSW path at each
// -ef-list value, compares with exact search, then adds -filler rows for
// other sources and repeats the measurement as a filtered KB:
//
//	go run ./cmd/vecbench -dsn "$DSN" -real-table fiqa_nomic \
//	    -query-vectors /tmp/ragbench/queries.jsonl -filler 500000
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand/v2"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"
)

type config struct {
	dsn                          string
	n, dims, sources, clusters   int
	queries, k, efSearch         int
	m, efConstruction            int
	keep, skipLoad               bool
	strategy                     string
	exactThreshold               int64
	maintenanceWorkMem, parallel string
	real                         realConfig
}

func main() {
	var c config
	flag.StringVar(&c.dsn, "dsn", os.Getenv("DATABASE_URL"), "Postgres URL (scratch database)")
	flag.IntVar(&c.n, "n", 1_000_000, "vectors to load")
	flag.IntVar(&c.dims, "dims", 768, "dimensions")
	flag.IntVar(&c.sources, "sources", 2000, "data sources (Zipf-distributed sizes)")
	flag.IntVar(&c.clusters, "clusters", 2000, "topic clusters in the synthetic data")
	flag.IntVar(&c.queries, "queries", 100, "queries per scenario")
	flag.IntVar(&c.k, "k", 10, "results per query")
	flag.IntVar(&c.efSearch, "ef-search", 100, "hnsw.ef_search")
	flag.IntVar(&c.m, "m", 16, "HNSW m")
	flag.IntVar(&c.efConstruction, "ef-construction", 64, "HNSW ef_construction")
	flag.StringVar(&c.maintenanceWorkMem, "maintenance-work-mem", "2GB", "maintenance_work_mem for the index build")
	flag.StringVar(&c.parallel, "parallel-workers", "4", "max_parallel_maintenance_workers for the index build")
	flag.StringVar(&c.strategy, "strategy", "auto", "planner (let Postgres choose) or auto (exact below -exact-threshold, forced HNSW above)")
	flag.Int64Var(&c.exactThreshold, "exact-threshold", 20000, "auto: largest filtered set searched exactly")
	flag.BoolVar(&c.keep, "keep", false, "keep the table afterwards (to re-run with -skip-load)")
	flag.BoolVar(&c.skipLoad, "skip-load", false, "reuse an existing table from -keep")
	c.real.register()
	flag.Parse()
	if c.dsn == "" {
		log.Fatal("set -dsn or DATABASE_URL")
	}
	if c.real.table != "" {
		if err := runReal(context.Background(), c); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := run(context.Background(), c); err != nil {
		log.Fatal(err)
	}
}

func table(c config) string { return fmt.Sprintf("vecbench_%d_%d", c.n, c.dims) }

func run(ctx context.Context, c config) error {
	pool, err := pgxpool.New(ctx, c.dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	rng := rand.New(rand.NewPCG(42, 7))
	centers := make([][]float32, c.clusters)
	for i := range centers {
		centers[i] = randomUnit(rng, c.dims)
	}
	// Zipf-like source sizes: a few very large sources, many small ones.
	weights := make([]float64, c.sources)
	var total float64
	for i := range weights {
		weights[i] = 1 / math.Pow(float64(i+1), 0.9)
		total += weights[i]
	}
	sourceIDs := make([]uuid.UUID, c.sources)
	counts := make([]int, c.sources)
	for i := range sourceIDs {
		sourceIDs[i] = uuid.New()
		counts[i] = int(math.Round(weights[i] / total * float64(c.n)))
	}

	if !c.skipLoad {
		if err := load(ctx, pool, c, rng, centers, sourceIDs, counts); err != nil {
			return err
		}
	} else if err := pool.QueryRow(ctx, "SELECT array_agg(source_id ORDER BY cnt DESC) FROM (SELECT source_id, count(*) cnt FROM "+table(c)+" GROUP BY source_id) s").Scan(&sourceIDs); err != nil {
		return err
	}
	if !c.keep {
		defer func() { _, _ = pool.Exec(context.Background(), "DROP TABLE IF EXISTS "+table(c)) }()
	}

	// Scenarios: KBs of different selectivity. Sources are sorted largest first.
	var size int64
	_ = pool.QueryRow(ctx, "SELECT pg_total_relation_size($1)", table(c)).Scan(&size)
	fmt.Printf("\ntable %s: %d vectors x %d dims, %d sources, %.1f GiB with indexes\n\n", table(c), c.n, c.dims, len(sourceIDs), float64(size)/(1<<30))
	scenarios := []struct {
		name string
		ids  []uuid.UUID
	}{
		{"small KB (5 small sources)", sourceIDs[len(sourceIDs)-5:]},
		{"medium KB (20 mid sources)", sourceIDs[len(sourceIDs)/4 : len(sourceIDs)/4+20]},
		{"large KB (largest source)", sourceIDs[:1]},
		{"very large KB (10% of sources)", sourceIDs[:max(1, len(sourceIDs)/10)]},
	}
	fmt.Printf("strategy=%s (exact threshold %d), ef_search=%d, iterative_scan=relaxed_order, k=%d, %d queries per row\n\n", c.strategy, c.exactThreshold, c.efSearch, c.k, c.queries)
	fmt.Println("| scenario | queries | vectors in filter | recall@k | p50 ms | p95 ms | p99 ms |")
	fmt.Println("|---|---|---:|---:|---:|---:|---:|")
	for _, sc := range scenarios {
		var inFilter int64
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM "+table(c)+" WHERE source_id = ANY($1)", sc.ids).Scan(&inFilter); err != nil {
			return err
		}
		for _, onTopic := range []bool{true, false} {
			recall, lat, err := measure(ctx, pool, c, rng, centers, sc.ids, onTopic, inFilter)
			if err != nil {
				return err
			}
			kind := "on-topic"
			if !onTopic {
				kind = "off-topic"
			}
			fmt.Printf("| %s | %s | %d | %.3f | %.1f | %.1f | %.1f |\n", sc.name, kind, inFilter, recall, pct(lat, 50), pct(lat, 95), pct(lat, 99))
		}
	}
	return nil
}

func load(ctx context.Context, pool *pgxpool.Pool, c config, rng *rand.Rand, centers [][]float32, sourceIDs []uuid.UUID, counts []int) error {
	t := table(c)
	for _, stmt := range []string{
		"CREATE EXTENSION IF NOT EXISTS vector",
		"DROP TABLE IF EXISTS " + t,
		fmt.Sprintf("CREATE TABLE %s (chunk_id uuid PRIMARY KEY, source_id uuid NOT NULL, embedding halfvec(%d) NOT NULL)", t, c.dims),
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	start := time.Now()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	pr, pw := io.Pipe()
	go func() {
		w := bufio.NewWriterSize(pw, 1<<20)
		loaded := 0
		for s, n := range counts {
			// Each source concentrates on a few topics, like real collections.
			topics := []int{rng.IntN(len(centers)), rng.IntN(len(centers)), rng.IntN(len(centers))}
			for i := 0; i < n; i++ {
				v := noisy(rng, centers[topics[rng.IntN(len(topics))]], 0.35)
				fmt.Fprintf(w, "%s\t%s\t%s\n", uuid.New(), sourceIDs[s], pgvector.NewHalfVector(v).String())
				loaded++
				if loaded%250_000 == 0 {
					log.Printf("generated %d/%d vectors", loaded, c.n)
				}
			}
		}
		_ = w.Flush()
		_ = pw.Close()
	}()
	if _, err := conn.Conn().PgConn().CopyFrom(ctx, pr, "COPY "+t+" (chunk_id, source_id, embedding) FROM STDIN"); err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	log.Printf("loaded in %s", time.Since(start).Round(time.Second))
	start = time.Now()
	for _, stmt := range []string{
		"SET maintenance_work_mem = '" + c.maintenanceWorkMem + "'",
		"SET max_parallel_maintenance_workers = " + c.parallel,
		fmt.Sprintf("CREATE INDEX ON %s USING hnsw (embedding halfvec_cosine_ops) WITH (m = %d, ef_construction = %d)", t, c.m, c.efConstruction),
		fmt.Sprintf("CREATE INDEX ON %s (source_id)", t),
		"ANALYZE " + t,
	} {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	log.Printf("indexed in %s", time.Since(start).Round(time.Second))
	return nil
}

// measure runs queries with the production search settings and compares
// them with exact (sequential) search.
// On-topic queries are perturbed copies of vectors inside the filter (users
// ask a KB about its content); off-topic queries come from random topics
// (the worst case for filtered HNSW search).
func measure(ctx context.Context, pool *pgxpool.Pool, c config, rng *rand.Rand, centers [][]float32, ids []uuid.UUID, onTopic bool, inFilter int64) (float64, []float64, error) {
	var lat []float64
	found, possible := 0, 0
	exactQ := fmt.Sprintf("SELECT chunk_id FROM %s WHERE source_id = ANY($2) ORDER BY embedding <=> $1::halfvec(%d) LIMIT $3", table(c), c.dims)
	q, forceANN := exactQ, false
	if c.strategy == "auto" && inFilter > c.exactThreshold {
		// The CASE hides the filter from the source_id btree so the planner
		// walks the HNSW index; seq/bitmap scans are disabled for the query.
		q = fmt.Sprintf("SELECT chunk_id FROM %s WHERE CASE WHEN source_id = ANY($2) THEN true END ORDER BY embedding <=> $1::halfvec(%d) LIMIT $3", table(c), c.dims)
		forceANN = true
	}
	for i := 0; i < c.queries; i++ {
		base := centers[rng.IntN(len(centers))]
		if onTopic {
			var hv pgvector.HalfVector
			if err := pool.QueryRow(ctx, "SELECT embedding FROM "+table(c)+" WHERE source_id = ANY($1) OFFSET floor(random() * least(1000, (SELECT count(*) FROM "+table(c)+" WHERE source_id = ANY($1)))) LIMIT 1", ids).Scan(&hv); err != nil {
				return 0, nil, err
			}
			base = hv.Slice()
		}
		vec := pgvector.NewHalfVector(noisy(rng, base, 0.35)).String()
		var approx, exact []uuid.UUID
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'relaxed_order', true)", strconv.Itoa(c.efSearch)); err != nil {
				return err
			}
			switch {
			case forceANN:
				if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off; SET LOCAL enable_bitmapscan = off"); err != nil {
					return err
				}
			case c.strategy == "auto":
				// Exact: read the filtered rows via the source_id index and sort.
				if _, err := tx.Exec(ctx, "SET LOCAL enable_indexscan = off"); err != nil {
					return err
				}
			}
			start := time.Now()
			rows, err := tx.Query(ctx, q, vec, ids, c.k)
			if err != nil {
				return err
			}
			approx, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
			lat = append(lat, float64(time.Since(start).Microseconds())/1000)
			return err
		})
		if err != nil {
			return 0, nil, err
		}
		err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, "SET LOCAL enable_indexscan = off"); err != nil {
				return err
			}
			rows, err := tx.Query(ctx, exactQ, vec, ids, c.k)
			if err != nil {
				return err
			}
			exact, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
			return err
		})
		if err != nil {
			return 0, nil, err
		}
		set := map[uuid.UUID]bool{}
		for _, id := range approx {
			set[id] = true
		}
		for _, id := range exact {
			if set[id] {
				found++
			}
		}
		possible += len(exact)
	}
	if possible == 0 {
		return 1, lat, nil
	}
	return float64(found) / float64(possible), lat, nil
}

func randomUnit(rng *rand.Rand, dims int) []float32 {
	v := make([]float32, dims)
	for i := range v {
		v[i] = float32(rng.NormFloat64())
	}
	return normalize(v)
}

func noisy(rng *rand.Rand, center []float32, scale float64) []float32 {
	v := make([]float32, len(center))
	for i := range v {
		v[i] = center[i] + float32(rng.NormFloat64()*scale/math.Sqrt(float64(len(center)))*4)
	}
	return normalize(v)
}

func normalize(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	n = math.Sqrt(n)
	for i := range v {
		v[i] = float32(float64(v[i]) / n)
	}
	return v
}

func pct(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	s := append([]float64(nil), xs...)
	sort.Float64s(s)
	idx := int(math.Ceil(p/100*float64(len(s)))) - 1
	return s[min(max(idx, 0), len(s)-1)]
}
