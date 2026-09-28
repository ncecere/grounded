package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand/v2"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"
)

// realConfig configures the real-embedding mode (-real-table).
type realConfig struct {
	table, queryVectors, efList, parallelList string
	filler                                    int
	fillerKind                                string
	fillerCos                                 float64
	limit, partitions, maxScanTuples          int
	reuse, rebuild                            bool
	work                                      string
}

func (r *realConfig) register() {
	flag.StringVar(&r.table, "real-table", "", "real mode: existing table (chunk_id uuid, source_id uuid, embedding halfvec) to benchmark, e.g. Grounded's emb_<profile> or one from ragbench offline -export-table")
	flag.StringVar(&r.queryVectors, "query-vectors", "", "real mode: JSONL of query vectors {\"id\",\"vector\"} (ragbench dense/offline -queries-out)")
	flag.StringVar(&r.efList, "ef-list", "100,200,400,800", "real mode: hnsw.ef_search values to measure")
	flag.StringVar(&r.parallelList, "parallel-list", "0,4", "real mode: max_parallel_workers_per_gather values for exact-search latency")
	flag.IntVar(&r.filler, "filler", 500000, "real mode: rows for other sources added for the filtered scenario (0 = skip)")
	flag.StringVar(&r.fillerKind, "filler-kind", "synthetic", "real mode: synthetic (clustered random vectors, as in the default mode) or real (noisy copies of the real vectors: other teams with similar content)")
	flag.Float64Var(&r.fillerCos, "filler-cos", 0.9, "real mode, -filler-kind real: expected cosine similarity of a filler row to the real vector it copies")
	flag.IntVar(&r.limit, "limit", 40, "real mode: rows requested per search (Grounded requests max(4 x topK, 20) vector candidates)")
	flag.BoolVar(&r.reuse, "real-reuse", false, "real mode: reuse the working table from a previous -keep run (skip copy and filler)")
	flag.BoolVar(&r.rebuild, "real-rebuild", false, "real mode with -real-reuse: drop and rebuild the HNSW index with -m/-ef-construction first")
	flag.StringVar(&r.work, "real-work-table", "vecbench_real", "real mode: working table (dropped unless -keep)")
	flag.IntVar(&r.maxScanTuples, "max-scan-tuples", 0, "real mode: hnsw.max_scan_tuples for iterative scans (0 = server default, 20000; Grounded does not set it)")
	flag.IntVar(&r.partitions, "partitions", 0, "real mode: hash-partition the working table by source_id into this many partitions (gate fallback 2); the HNSW query then filters with source_id = ANY(...) so partitions are pruned")
}

type realQuery struct {
	ID     string    `json:"id"`
	Vector []float32 `json:"vector"`
}

func runReal(ctx context.Context, c config) error {
	r := c.real
	pool, err := pgxpool.New(ctx, c.dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	queries, err := readQueries(r.queryVectors)
	if err != nil {
		return err
	}
	efs, err := ints(r.efList)
	if err != nil {
		return fmt.Errorf("-ef-list: %w", err)
	}
	pars, err := ints(r.parallelList)
	if err != nil {
		return fmt.Errorf("-parallel-list: %w", err)
	}
	dims := len(queries[0].Vector)
	work := pgx.Identifier{r.work}.Sanitize()
	var kb []uuid.UUID
	if err := pool.QueryRow(ctx, "SELECT array_agg(DISTINCT source_id) FROM "+pgx.Identifier{r.table}.Sanitize()).Scan(&kb); err != nil {
		return fmt.Errorf("read %s: %w", r.table, err)
	}
	if !c.keep {
		defer func() { _, _ = pool.Exec(context.Background(), "DROP TABLE IF EXISTS "+work) }()
	}
	scenario := func(title string) error {
		var all, in int64
		if err := pool.QueryRow(ctx, "SELECT count(*), count(*) FILTER (WHERE source_id = ANY($1)) FROM "+work, kb).Scan(&all, &in); err != nil {
			return err
		}
		fmt.Printf("\n### %s\n\n%d rows in table, %d in the KB filter (%d sources), %d real queries, k=%d, %d rows requested, m=%d, ef_construction=%d\n\n",
			title, all, in, len(kb), len(queries), c.k, r.limit, c.m, c.efConstruction)
		return measureReal(ctx, pool, c, work, kb, queries, efs, pars)
	}

	switch {
	case !r.reuse:
		if err := createWorkTable(ctx, pool, c, work, dims); err != nil {
			return err
		}
		if err := scenario("KB alone: the table holds only the KB's real vectors"); err != nil {
			return err
		}
		if r.filler <= 0 {
			return nil
		}
		if err := rebuildIndex(ctx, pool, c, work, func() error { return addFiller(ctx, pool, c, work, dims) }); err != nil {
			return err
		}
	case r.rebuild:
		if err := rebuildIndex(ctx, pool, c, work, nil); err != nil {
			return err
		}
	}
	title := fmt.Sprintf("Filtered KB: the KB's real vectors among %s filler rows for other sources", r.fillerKind)
	if r.reuse {
		title = "Filtered KB: reused table " + r.work
	}
	return scenario(title)
}

// createWorkTable copies the real table into the working table (hash
// partitioned by source_id when -partitions is set) and indexes it.
func createWorkTable(ctx context.Context, pool *pgxpool.Pool, c config, work string, dims int) error {
	r := c.real
	stmts := []string{
		"DROP TABLE IF EXISTS " + work,
		fmt.Sprintf("CREATE TABLE %s (chunk_id uuid PRIMARY KEY, source_id uuid NOT NULL, embedding halfvec(%d) NOT NULL)", work, dims),
	}
	if r.partitions > 0 {
		stmts[1] = fmt.Sprintf("CREATE TABLE %s (chunk_id uuid NOT NULL, source_id uuid NOT NULL, embedding halfvec(%d) NOT NULL) PARTITION BY HASH (source_id)", work, dims)
		for i := 0; i < r.partitions; i++ {
			stmts = append(stmts, fmt.Sprintf("CREATE TABLE %s PARTITION OF %s FOR VALUES WITH (MODULUS %d, REMAINDER %d)",
				pgx.Identifier{fmt.Sprintf("%s_p%d", r.work, i)}.Sanitize(), work, r.partitions, i))
		}
	}
	stmts = append(stmts, fmt.Sprintf("INSERT INTO %s SELECT chunk_id, source_id, embedding FROM %s", work, pgx.Identifier{r.table}.Sanitize()))
	for _, stmt := range stmts {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	return buildIndexes(ctx, pool, c, work)
}

// rebuildIndex drops the HNSW index, runs change (if any), and builds the
// indexes again.
func rebuildIndex(ctx context.Context, pool *pgxpool.Pool, c config, work string, change func() error) error {
	if _, err := pool.Exec(ctx, "DROP INDEX IF EXISTS "+pgx.Identifier{c.real.work + "_hnsw"}.Sanitize()); err != nil {
		return err
	}
	if change != nil {
		if err := change(); err != nil {
			return err
		}
	}
	return buildIndexes(ctx, pool, c, work)
}

func readQueries(path string) ([]realQuery, error) {
	if path == "" {
		return nil, errors.New("-query-vectors is required with -real-table")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out []realQuery
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		var q realQuery
		if err := json.Unmarshal(sc.Bytes(), &q); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("%s: no query vectors", path)
	}
	return out, sc.Err()
}

func ints(s string) ([]int, error) {
	var out []int
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

func buildIndexes(ctx context.Context, pool *pgxpool.Pool, c config, work string) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	name := strings.Trim(work, `"`)
	start := time.Now()
	for _, stmt := range []string{
		"SET maintenance_work_mem = '" + c.maintenanceWorkMem + "'",
		"SET max_parallel_maintenance_workers = " + c.parallel,
		fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON %s USING hnsw (embedding halfvec_cosine_ops) WITH (m = %d, ef_construction = %d)",
			pgx.Identifier{name + "_hnsw"}.Sanitize(), work, c.m, c.efConstruction),
	} {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	hnsw := time.Since(start)
	stmts := []string{"ANALYZE " + work}
	if c.real.partitions == 0 {
		// Partitioned tables rely on pruning instead; without this btree the
		// planner must use the per-partition HNSW indexes for ordering.
		stmts = append([]string{fmt.Sprintf("CREATE INDEX IF NOT EXISTS %s ON %s (source_id)", pgx.Identifier{name + "_source"}.Sanitize(), work)}, stmts...)
	}
	for _, stmt := range stmts {
		if _, err := conn.Exec(ctx, stmt); err != nil {
			return fmt.Errorf("%s: %w", stmt, err)
		}
	}
	var size int64
	_ = conn.QueryRow(ctx, "SELECT greatest(pg_relation_size($1::regclass), coalesce((SELECT sum(pg_relation_size(relid)) FROM pg_partition_tree($1::regclass)), 0))::bigint", name+"_hnsw").Scan(&size)
	log.Printf("HNSW index (m=%d, ef_construction=%d) built in %s, %.0f MiB", c.m, c.efConstruction, hnsw.Round(time.Second), float64(size)/(1<<20))
	fmt.Printf("\nHNSW build (m=%d, ef_construction=%d): %s, %.0f MiB\n", c.m, c.efConstruction, hnsw.Round(time.Second), float64(size)/(1<<20))
	return nil
}

// addFiller inserts rows for other sources (Zipf-sized, as in the synthetic
// mode). Synthetic rows are clustered random vectors; real rows are noisy
// copies of the table's own vectors, which puts them in the same region of
// the space as the KB (the hard case for filtered HNSW).
func addFiller(ctx context.Context, pool *pgxpool.Pool, c config, work string, dims int) error {
	r := c.real
	rng := rand.New(rand.NewPCG(42, 9))
	var seeds [][]float32
	if r.fillerKind == "real" {
		rows, err := pool.Query(ctx, "SELECT embedding FROM "+work)
		if err != nil {
			return err
		}
		seeds, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) ([]float32, error) {
			var hv pgvector.HalfVector
			err := row.Scan(&hv)
			return hv.Slice(), err
		})
		if err != nil {
			return err
		}
	} else if r.fillerKind != "synthetic" {
		return fmt.Errorf("-filler-kind must be synthetic or real")
	}
	centers := make([][]float32, c.clusters)
	for i := range centers {
		centers[i] = randomUnit(rng, dims)
	}
	// Per-dimension noise giving the requested expected cosine to the seed.
	sigma := math.Sqrt((1/(r.fillerCos*r.fillerCos) - 1) / float64(dims))
	weights := make([]float64, c.sources)
	var total float64
	for i := range weights {
		weights[i] = 1 / math.Pow(float64(i+1), 0.9)
		total += weights[i]
	}
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	start := time.Now()
	pr, pw := io.Pipe()
	go func() {
		w := bufio.NewWriterSize(pw, 1<<20)
		written := 0
		for s := 0; s < c.sources && written < r.filler; s++ {
			src := uuid.New()
			n := int(math.Round(weights[s] / total * float64(r.filler)))
			topics := []int{rng.IntN(len(centers)), rng.IntN(len(centers)), rng.IntN(len(centers))}
			for i := 0; i < n && written < r.filler; i++ {
				var v []float32
				if seeds != nil {
					seed := seeds[rng.IntN(len(seeds))]
					v = make([]float32, dims)
					for j := range v {
						v[j] = seed[j] + float32(rng.NormFloat64()*sigma)
					}
					v = normalize(v)
				} else {
					v = noisy(rng, centers[topics[rng.IntN(len(topics))]], 0.35)
				}
				fmt.Fprintf(w, "%s\t%s\t%s\n", uuid.New(), src, pgvector.NewHalfVector(v).String())
				written++
			}
		}
		_ = w.Flush()
		_ = pw.Close()
	}()
	if _, err := conn.Conn().PgConn().CopyFrom(ctx, pr, "COPY "+work+" (chunk_id, source_id, embedding) FROM STDIN"); err != nil {
		return fmt.Errorf("copy filler: %w", err)
	}
	log.Printf("added %s filler rows in %s", r.fillerKind, time.Since(start).Round(time.Second))
	return nil
}

type exactResult struct {
	ids   []uuid.UUID
	dists []float64
}

// measureReal compares Grounded's HNSW search path with exact search for every
// query at each ef_search, and reports exact-search latency.
func measureReal(ctx context.Context, pool *pgxpool.Pool, c config, work string, kb []uuid.UUID, queries []realQuery, efs, pars []int) error {
	limit := max(c.real.limit, c.k)
	exact := make([]exactResult, len(queries))
	fmt.Println("| search | setting | recall@10 (IDs) | recall@10 (distance) | recall@40 | p50 ms | p95 ms | p99 ms |")
	fmt.Println("|---|---|---:|---:|---:|---:|---:|---:|")
	for pi, par := range pars {
		var lat []float64
		for i, q := range queries {
			res, ms, err := exactSearch(ctx, pool, work, kb, q, par, limit)
			lat = append(lat, ms)
			if err != nil {
				return err
			}
			if pi == 0 {
				exact[i] = res
			}
		}
		fmt.Printf("| exact | %d parallel workers | 1.000 | 1.000 | 1.000 | %.1f | %.1f | %.1f |\n", par, pct(lat, 50), pct(lat, 95), pct(lat, 99))
	}
	for _, ef := range efs {
		var lat []float64
		var rc recallCounts
		for i, q := range queries {
			res, ms, err := hnswSearch(ctx, pool, c, work, kb, q, ef, limit)
			lat = append(lat, ms)
			if err != nil {
				return err
			}
			// relaxed_order can return rows slightly out of order; Grounded sorts.
			sortResult(&res)
			rc.add(res, exact[i], c.k)
		}
		label := "HNSW (Grounded path)"
		if c.real.partitions > 0 {
			label = fmt.Sprintf("HNSW (%d hash partitions)", c.real.partitions)
		}
		fmt.Printf("| %s | ef_search %d | %.3f | %.3f | %.3f | %.1f | %.1f | %.1f |\n", label, ef,
			ratio(rc.idHits, rc.possible), ratio(rc.distHits, rc.possible), ratio(rc.candHits, rc.candPossible), pct(lat, 50), pct(lat, 95), pct(lat, 99))
	}
	return nil
}

// exactSearch runs the app's exact path (bitmap scan on source_id, then
// sort) with par parallel workers. ms is the query latency.
func exactSearch(ctx context.Context, pool *pgxpool.Pool, work string, kb []uuid.UUID, q realQuery, par, limit int) (res exactResult, ms float64, err error) {
	vec := pgvector.NewHalfVector(q.Vector).String()
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL enable_indexscan = off; SET LOCAL max_parallel_workers_per_gather = "+strconv.Itoa(par)); err != nil {
			return err
		}
		start := time.Now()
		var err error
		res, err = search(ctx, tx, fmt.Sprintf("SELECT chunk_id, embedding <=> $1::halfvec(%d) AS d FROM %s WHERE source_id = ANY($2) ORDER BY d LIMIT $3", len(q.Vector), work), vec, kb, limit)
		ms = float64(time.Since(start).Microseconds()) / 1000
		return err
	})
	return res, ms, err
}

// hnswSearch runs the HNSW path with the same settings and SQL shape as
// internal/vectorstore for KBs above VECTOR_EXACT_THRESHOLD.
func hnswSearch(ctx context.Context, pool *pgxpool.Pool, c config, work string, kb []uuid.UUID, q realQuery, ef, limit int) (res exactResult, ms float64, err error) {
	vec := pgvector.NewHalfVector(q.Vector).String()
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT set_config('hnsw.ef_search', $1, true), set_config('hnsw.iterative_scan', 'relaxed_order', true)", strconv.Itoa(max(ef, limit))); err != nil {
			return err
		}
		if c.real.maxScanTuples > 0 {
			if _, err := tx.Exec(ctx, "SELECT set_config('hnsw.max_scan_tuples', $1, true)", strconv.Itoa(c.real.maxScanTuples)); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off; SET LOCAL enable_bitmapscan = off"); err != nil {
			return err
		}
		start := time.Now()
		var err error
		filter := "CASE WHEN source_id = ANY($2) THEN true END"
		if c.real.partitions > 0 {
			filter = "source_id = ANY($2)" // prunes partitions
		}
		res, err = search(ctx, tx, fmt.Sprintf("SELECT chunk_id, embedding <=> $1::halfvec(%d) AS d FROM %s WHERE %s ORDER BY d LIMIT $3", len(q.Vector), work, filter), vec, kb, limit)
		ms = float64(time.Since(start).Microseconds()) / 1000
		return err
	})
	return res, ms, err
}

// recallCounts accumulates HNSW recall against exact search.
type recallCounts struct {
	idHits, distHits, candHits, possible, candPossible int
}

// add counts one query: ID recall and distance recall at k (ties with the
// k-th exact neighbour count as hits), and candidate recall over all rows.
func (rc *recallCounts) add(res, ex exactResult, k int) {
	kk := min(k, len(ex.ids))
	top := map[uuid.UUID]bool{}
	for _, id := range res.ids[:min(k, len(res.ids))] {
		top[id] = true
	}
	for _, id := range ex.ids[:kk] {
		if top[id] {
			rc.idHits++
		}
	}
	if kk > 0 {
		kth := ex.dists[kk-1] + 1e-6
		n := 0
		for _, d := range res.dists[:min(k, len(res.dists))] {
			if d <= kth {
				n++
			}
		}
		rc.distHits += min(n, kk)
	}
	rc.possible += kk
	cand := map[uuid.UUID]bool{}
	for _, id := range res.ids {
		cand[id] = true
	}
	for _, id := range ex.ids {
		if cand[id] {
			rc.candHits++
		}
	}
	rc.candPossible += len(ex.ids)
}

func ratio(a, b int) float64 {
	if b == 0 {
		return 1
	}
	return float64(a) / float64(b)
}

func search(ctx context.Context, tx pgx.Tx, sql, vec string, kb []uuid.UUID, limit int) (exactResult, error) {
	var res exactResult
	rows, err := tx.Query(ctx, sql, vec, kb, limit)
	if err != nil {
		return res, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var d float64
		if err := rows.Scan(&id, &d); err != nil {
			return res, err
		}
		res.ids = append(res.ids, id)
		res.dists = append(res.dists, d)
	}
	return res, rows.Err()
}

func sortResult(r *exactResult) {
	idx := make([]int, len(r.ids))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return r.dists[idx[a]] < r.dists[idx[b]] })
	ids := make([]uuid.UUID, len(idx))
	ds := make([]float64, len(idx))
	for i, j := range idx {
		ids[i], ds[i] = r.ids[j], r.dists[j]
	}
	r.ids, r.dists = ids, ds
}
