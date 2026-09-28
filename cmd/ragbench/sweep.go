package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"

	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// Keyword-query variants for the fusion sweep. Each takes $1 = query text,
// $2 = source IDs, $3 = limit and returns chunk IDs, best first. "grounded" is
// the application's query (kbs.LexicalSQL); "or-cd1" was Grounded's query before
// fusion tuning; the others are experiments.
const orCTE = `WITH q AS (
    SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS query
    FROM unnest(to_tsvector('english', $1)))`

func orVariant(order string) string {
	return orCTE + `
SELECT c.id FROM chunks c, q
WHERE q.query IS NOT NULL AND c.source_id = ANY($2::uuid[]) AND c.content_tsv @@ q.query
ORDER BY ` + order + ` DESC, c.id LIMIT $3`
}

// andFirst ranks chunks that match every term (tsq) before the OR matches.
func andFirst(tsq, order string) string {
	return orCTE + `, a AS (SELECT ` + tsq + ` AS query)
SELECT c.id FROM chunks c, q, a
WHERE q.query IS NOT NULL AND c.source_id = ANY($2::uuid[]) AND c.content_tsv @@ q.query
ORDER BY (numnode(a.query) > 0 AND c.content_tsv @@ a.query) DESC, ` + order + ` DESC, c.id LIMIT $3`
}

// idfSQL is a BM25-like experiment without term frequency: the sum of the
// matched lexemes' IDF, with document frequencies counted in the KB at
// query time (one GIN lookup per query lexeme). Not cheap at scale.
const idfSQL = `WITH lex AS (SELECT DISTINCT lexeme FROM unnest(to_tsvector('english', $1))),
n AS (SELECT count(*)::float8 AS n FROM chunks WHERE source_id = ANY($2::uuid[])),
df AS (SELECT l.lexeme, (SELECT count(*) FROM chunks c WHERE c.source_id = ANY($2::uuid[])
            AND c.content_tsv @@ to_tsquery('simple', quote_literal(l.lexeme)))::float8 AS df FROM lex l),
q AS (SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS query FROM lex)
SELECT c.id FROM chunks c, q
WHERE q.query IS NOT NULL AND c.source_id = ANY($2::uuid[]) AND c.content_tsv @@ q.query
ORDER BY (SELECT sum(ln(1 + (n.n - df.df + 0.5) / (df.df + 0.5))) FROM df, n
          WHERE df.lexeme = ANY(tsvector_to_array(c.content_tsv))) DESC,
         ts_rank_cd(c.content_tsv, q.query, 1) DESC, c.id
LIMIT $3`

type kwVariant struct{ name, sql string }

func keywordVariants() []kwVariant {
	return []kwVariant{
		{"grounded", fmt.Sprintf(kbs.LexicalSQL, "true")},
		{"or-cd1", orVariant("ts_rank_cd(c.content_tsv, q.query, 1)")},
		{"or-cd0", orVariant("ts_rank_cd(c.content_tsv, q.query)")},
		{"or-cd2", orVariant("ts_rank_cd(c.content_tsv, q.query, 2)")},
		{"or-rank0", orVariant("ts_rank(c.content_tsv, q.query)")},
		{"or-rank1", orVariant("ts_rank(c.content_tsv, q.query, 1)")},
		{"or-rank2", orVariant("ts_rank(c.content_tsv, q.query, 2)")},
		{"and-first-plain-cd1", andFirst("plainto_tsquery('english', $1)", "ts_rank_cd(c.content_tsv, q.query, 1)")},
		{"and-first-web-cd1", andFirst("websearch_to_tsquery('english', $1)", "ts_rank_cd(c.content_tsv, q.query, 1)")},
		{"and-first-web-rank1", andFirst("websearch_to_tsquery('english', $1)", "ts_rank(c.content_tsv, q.query, 1)")},
		{"web-and-only", `WITH q AS (SELECT websearch_to_tsquery('english', $1) AS query)
SELECT c.id FROM chunks c, q
WHERE numnode(q.query) > 0 AND c.source_id = ANY($2::uuid[]) AND c.content_tsv @@ q.query
ORDER BY ts_rank_cd(c.content_tsv, q.query, 1) DESC, c.id LIMIT $3`},
	}
}

// slowVariants are measured only when named explicitly (not in "all").
func slowVariants() []kwVariant {
	return []kwVariant{{"or-idf", idfSQL}}
}

// judged is one evaluation query with its relevant document keys.
type judged struct {
	id, text string
	rel      map[string]int
}

// sweepData is everything a fusion sweep needs from one KB.
type sweepData struct {
	pool      *pgxpool.Pool
	table     string // emb_<profile>
	dims      int
	sourceIDs []uuid.UUID
	docOf     map[uuid.UUID]string // chunk -> document key (BEIR ID or URL)
}

func loadDocKeys(ctx context.Context, pool *pgxpool.Pool, sourceIDs []uuid.UUID, key func(filename, url string) string) (map[uuid.UUID]string, error) {
	rows, err := pool.Query(ctx, `SELECT c.id, d.filename, d.url FROM chunks c JOIN documents d ON d.id = c.document_id WHERE c.source_id = ANY($1::uuid[])`, sourceIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var id uuid.UUID
		var fn, u string
		if err := rows.Scan(&id, &fn, &u); err != nil {
			return nil, err
		}
		out[id] = key(fn, u)
	}
	return out, rows.Err()
}

// exactHits is Grounded's exact vector search (KBs under VECTOR_EXACT_THRESHOLD).
func (d sweepData) exactHits(ctx context.Context, q []float32, limit int) ([]vectorstore.Hit, error) {
	var out []vectorstore.Hit
	err := pgx.BeginFunc(ctx, d.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL enable_indexscan = off"); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, fmt.Sprintf(`SELECT chunk_id, embedding <=> $1::halfvec(%d) AS dist FROM %s
			WHERE source_id = ANY($2::uuid[]) ORDER BY dist LIMIT $3`, d.dims, pgx.Identifier{d.table}.Sanitize()),
			pgvector.NewHalfVector(q).String(), d.sourceIDs, limit)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (vectorstore.Hit, error) {
			var h vectorstore.Hit
			return h, r.Scan(&h.ChunkID, &h.Distance)
		})
		return err
	})
	return out, err
}

func (d sweepData) keyword(ctx context.Context, sql, text string, limit int) ([]uuid.UUID, error) {
	rows, err := d.pool.Query(ctx, sql, text, d.sourceIDs, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

func (d sweepData) docs(ids []uuid.UUID, k int) []string {
	if len(ids) > k {
		ids = ids[:k]
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, d.docOf[id])
	}
	return dedupe(out)
}

func parseFloats(s string) ([]float64, error) {
	var out []float64
	for _, f := range strings.Split(s, ",") {
		if f = strings.TrimSpace(f); f == "" {
			continue
		}
		v, err := strconv.ParseFloat(f, 64)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func selectVariants(names string) ([]kwVariant, error) {
	all := keywordVariants()
	if names == "all" {
		return all, nil
	}
	all = append(all, slowVariants()...)
	var out []kwVariant
	for _, n := range strings.Split(names, ",") {
		found := false
		for _, v := range all {
			if v.name == strings.TrimSpace(n) {
				out = append(out, v)
				found = true
			}
		}
		if !found {
			return nil, fmt.Errorf("unknown keyword variant %q", n)
		}
	}
	return out, nil
}

// runSweep fuses Grounded's vector candidates with each keyword variant at each
// keyword weight (vector weight 1) and prints a markdown table. It uses the
// application's fusion (kbs.Fuse) and Grounded's candidate count (4 x k, >= 20).
func runSweep(ctx context.Context, d sweepData, queries []judged, vecs [][]float32, variants []kwVariant, weights []float64, k int) error {
	if len(queries) != len(vecs) {
		return errors.New("query/vector count mismatch")
	}
	res := &sweepResult{
		lexOnly: make([]summary, len(variants)), lexLat: make([][]float64, len(variants)), grid: make([][]summary, len(variants)),
	}
	for i := range res.grid {
		res.grid[i] = make([]summary, len(weights))
	}
	for qi, q := range queries {
		if err := res.addQuery(ctx, d, q, vecs[qi], variants, weights, k); err != nil {
			return err
		}
	}
	res.print(variants, weights, k)
	return nil
}

// sweepResult accumulates the sweep's metrics and latencies.
type sweepResult struct {
	dense    summary
	denseLat []float64
	before   summary // Grounded before tuning: equal weights, keyword tie-break
	lexOnly  []summary
	lexLat   [][]float64
	grid     [][]summary // by variant, then weight
}

// addQuery scores one query: vector only, each keyword variant alone and
// fused at each weight.
func (res *sweepResult) addQuery(ctx context.Context, d sweepData, q judged, vec []float32, variants []kwVariant, weights []float64, k int) error {
	cands := max(k*4, 20)
	t0 := time.Now()
	vh, err := d.exactHits(ctx, vec, cands)
	if err != nil {
		return err
	}
	res.denseLat = append(res.denseLat, float64(time.Since(t0).Microseconds())/1000)
	vids := make([]uuid.UUID, len(vh))
	for i, h := range vh {
		vids[i] = h.ChunkID
	}
	res.dense.add(score(d.docs(vids, k), q.rel, k))
	for vi, v := range variants {
		t0 := time.Now()
		kw, err := d.keyword(ctx, v.sql, q.text, cands)
		if err != nil {
			return fmt.Errorf("%s: %w", v.name, err)
		}
		res.lexLat[vi] = append(res.lexLat[vi], float64(time.Since(t0).Microseconds())/1000)
		res.lexOnly[vi].add(score(d.docs(kw, k), q.rel, k))
		if v.name == "or-cd1" { // Grounded's query before tuning
			ids := beforeTuning(vh, kw)
			res.before.add(score(d.docs(ids, k), q.rel, k))
			if os.Getenv("RAGBENCH_DEBUG") != "" {
				fmt.Printf("%s before=%v vector=%v\n", q.id, firstRel(d.docs(ids, k), q.rel), firstRel(d.docs(vids, k), q.rel))
			}
		}
		for wi, w := range weights {
			ids := chunkIDs(kbs.Fuse(vh, kw, kbs.Weights{Vector: 1, Keyword: w}))
			res.grid[vi][wi].add(score(d.docs(ids, k), q.rel, k))
		}
	}
	return nil
}

// beforeTuning ranks like Grounded before tuning: equal weights, ties broken by
// the keyword rank.
func beforeTuning(vh []vectorstore.Hit, kw []uuid.UUID) []uuid.UUID {
	fused := kbs.Fuse(vh, kw, kbs.Weights{Vector: 1, Keyword: 1})
	sort.SliceStable(fused, func(i, j int) bool {
		a, b := fused[i], fused[j]
		if a.Score != b.Score {
			return a.Score > b.Score
		}
		return lastRank(a.LexicalRank) < lastRank(b.LexicalRank)
	})
	return chunkIDs(fused)
}

func chunkIDs(hits []*kbs.Hit) []uuid.UUID {
	ids := make([]uuid.UUID, len(hits))
	for i, h := range hits {
		ids[i] = h.ChunkID
	}
	return ids
}

// means returns a summary's mean nDCG, recall and MRR.
func means(s summary) (float64, float64, float64) {
	n := float64(max(s.n, 1))
	return s.ndcg / n, s.recall / n, s.mrr / n
}

// print writes the baselines, the markdown table and the best settings.
func (res *sweepResult) print(variants []kwVariant, weights []float64, k int) {
	nd, rc, mr := means(res.dense)
	fmt.Printf("\nvector only (exact): nDCG@%d %.3f recall@%d %.3f MRR %.3f; p50 %.1f ms\n", k, nd, k, rc, mr, pct(res.denseLat, 50))
	if res.before.n > 0 {
		nd, rc, mr := means(res.before)
		fmt.Printf("Grounded before tuning (or-cd1, equal weights, keyword tie-break): nDCG@%d %.3f recall@%d %.3f MRR %.3f\n", k, nd, k, rc, mr)
	}
	fmt.Printf("\nnDCG@%d / recall@%d by keyword query (rows) and keyword weight (columns; vector weight 1):\n\n", k, k)
	fmt.Printf("| keyword query | keyword only | p50 / p95 ms |")
	for _, w := range weights {
		fmt.Printf(" wk=%g |", w)
	}
	fmt.Printf("\n|---|---:|---:|%s\n", strings.Repeat("---:|", len(weights)))
	for vi, v := range variants {
		nd, rc, _ := means(res.lexOnly[vi])
		fmt.Printf("| %s | %.3f / %.3f | %.1f / %.1f |", v.name, nd, rc, pct(res.lexLat[vi], 50), pct(res.lexLat[vi], 95))
		for wi := range weights {
			nd, rc, _ := means(res.grid[vi][wi])
			fmt.Printf(" %.3f / %.3f |", nd, rc)
		}
		fmt.Println()
	}
	res.printBest(variants, weights, k)
}

// printBest lists the five best settings by nDCG.
func (res *sweepResult) printBest(variants []kwVariant, weights []float64, k int) {
	type best struct {
		name string
		w    float64
		nd   float64
	}
	var all []best
	for vi, v := range variants {
		for wi, w := range weights {
			nd, _, _ := means(res.grid[vi][wi])
			all = append(all, best{v.name, w, nd})
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].nd > all[j].nd })
	fmt.Printf("\ntop settings by nDCG@%d:", k)
	for _, b := range all[:min(5, len(all))] {
		fmt.Printf(" %s wk=%g (%.3f);", b.name, b.w, b.nd)
	}
	fmt.Println()
}

func firstRel(docs []string, rel map[string]int) int {
	for i, d := range docs {
		if rel[d] > 0 {
			return i + 1
		}
	}
	return 0
}

func lastRank(r int) int {
	if r == 0 {
		return 1 << 30
	}
	return r
}
