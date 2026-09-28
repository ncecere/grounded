package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/systemone"
)

// judgeFlags configure the SystemOne passage-judging evaluation
// (docs/systemone.md §5).
type judgeFlags struct {
	url, keyEnv, model string
	candidates, k      int
	concurrency        int
	batchedLimit       int
	timeout            time.Duration
	modes, cache       string
}

func (j *judgeFlags) register(fs *flag.FlagSet, cache string) {
	fs.StringVar(&j.url, "systemone-url", os.Getenv("SPARK_SYSTEMONE_URL"), "SystemOne base URL (default $SPARK_SYSTEMONE_URL)")
	fs.StringVar(&j.keyEnv, "systemone-key-env", "SPARK_SYSTEMONE_KEY", "environment variable holding the SystemOne key (never printed)")
	fs.StringVar(&j.model, "systemone-model", envOr("SPARK_SYSTEMONE_MODEL", "openjev-latest"), "SystemOne model")
	fs.IntVar(&j.candidates, "candidates", 20, "fused candidates judged per query")
	fs.IntVar(&j.concurrency, "judge-concurrency", 4, "concurrent SystemOne requests (the connection cap)")
	fs.DurationVar(&j.timeout, "judge-timeout", 60*time.Second, "per-request timeout (long: the evaluation should not skip)")
	fs.StringVar(&j.modes, "modes", "per_passage,batched", "judging modes to run")
	fs.IntVar(&j.batchedLimit, "batched-limit", 0, "judge only the first N queries in batched mode (0 = all); the report compares on those")
	fs.StringVar(&j.cache, "judge-cache", cache, "JSONL cache of judgments (re-runs cost no requests)")
}

func (j judgeFlags) client() (*systemone.Client, error) {
	if j.url == "" {
		return nil, errors.New("set -systemone-url or $SPARK_SYSTEMONE_URL")
	}
	gw := gateway.New(j.url, os.Getenv(j.keyEnv), j.timeout)
	return systemone.NewClient(gw, j.model, uuid.Nil, uuid.New(), j.concurrency), nil
}

// judgeCand is one fused candidate of a query.
type judgeCand struct {
	chunk   uuid.UUID
	doc     string
	passage systemone.Passage
}

// judgeQuery is a query with its fused candidates, best first.
type judgeQuery struct {
	judged
	cands []judgeCand
}

// fusedCandidates is Grounded's hybrid retrieval over the stored vectors:
// exact vector search and the keyword query, fused with the default
// weights (vector 1, keyword 0.1), top n.
func (d sweepData) fusedCandidates(ctx context.Context, q judged, vec []float32, n int) ([]judgeCand, error) {
	vh, err := d.exactHits(ctx, vec, n*2)
	if err != nil {
		return nil, err
	}
	kw, err := d.keyword(ctx, fmt.Sprintf(kbs.LexicalSQL, "true"), q.text, n*2)
	if err != nil {
		return nil, err
	}
	fused := kbs.Fuse(vh, kw, kbs.Weights{Vector: 1, Keyword: 0.1})
	if len(fused) > n {
		fused = fused[:n]
	}
	ids := chunkIDs(fused)
	ps, err := d.passages(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]judgeCand, len(ids))
	for i, id := range ids {
		out[i] = judgeCand{chunk: id, doc: d.docOf[id], passage: ps[id]}
	}
	return out, nil
}

// passages loads the chunks as the pipeline sends them.
func (d sweepData) passages(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]systemone.Passage, error) {
	rows, err := d.pool.Query(ctx, `SELECT c.id, c.content, c.heading_path, d.title, d.url FROM chunks c
		JOIN documents d ON d.id = c.document_id WHERE c.id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]systemone.Passage{}
	for rows.Next() {
		var id uuid.UUID
		var content, title, url string
		var heading []string
		if err := rows.Scan(&id, &content, &heading, &title, &url); err != nil {
			return nil, err
		}
		out[id] = systemone.Passage{Title: title, Section: strings.Join(heading, " › "),
			SourceType: sourceType(url), Text: content}
	}
	return out, rows.Err()
}

// sourceType is what the chat pipeline reports (agents.passageOf).
func sourceType(url string) string {
	if url != "" {
		return "web_page"
	}
	return "document"
}

// buildJudgeQueries fetches the fused candidates of every query.
func buildJudgeQueries(ctx context.Context, d sweepData, qs []judged, vecs [][]float32, n int) ([]judgeQuery, error) {
	out := make([]judgeQuery, len(qs))
	for i, q := range qs {
		cands, err := d.fusedCandidates(ctx, q, vecs[i], n)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", q.id, err)
		}
		out[i] = judgeQuery{judged: q, cands: cands}
	}
	return out, nil
}

// sample picks n queries deterministically (seeded shuffle, then the
// original order).
func sample[T any](xs []T, n int, seed uint64) []T {
	if n <= 0 || n >= len(xs) {
		return xs
	}
	idx := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15)).Perm(len(xs))[:n]
	keep := make([]bool, len(xs))
	for _, i := range idx {
		keep[i] = true
	}
	out := make([]T, 0, n)
	for i, x := range xs {
		if keep[i] {
			out = append(out, x)
		}
	}
	return out
}

// judgeRecord is one query's judgments in one mode (cached as JSONL).
type judgeRecord struct {
	Mode      string             `json:"mode"`
	Query     string             `json:"query"`
	Chunks    []string           `json:"chunks"`
	Scores    []systemone.Scores `json:"scores"`
	Skipped   []bool             `json:"skipped"`
	LatencyMs int64              `json:"latencyMs"`
	Requests  int                `json:"requests"`
}

func recordKey(mode, query string, chunks []string) string {
	return mode + "|" + query + "|" + strings.Join(chunks, ",")
}

func readJudgeCache(path string) map[string]judgeRecord {
	out := map[string]judgeRecord{}
	_ = readJSONL(path, func(r judgeRecord) error {
		out[recordKey(r.Mode, r.Query, r.Chunks)] = r
		return nil
	})
	return out
}

// runJudging judges every query's candidates in mode, one query at a time
// (so the latency is what one chat would add), reusing cached records.
func runJudging(ctx context.Context, cl *systemone.Client, qs []judgeQuery, mode, cachePath string, timeout time.Duration) ([]judgeRecord, error) {
	cache := readJudgeCache(cachePath)
	f, err := os.OpenFile(cachePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	defer w.Flush()
	out := make([]judgeRecord, len(qs))
	fresh := 0
	for i, q := range qs {
		chunks := make([]string, len(q.cands))
		ps := make([]systemone.Passage, len(q.cands))
		for j, c := range q.cands {
			chunks[j], ps[j] = c.chunk.String(), c.passage
		}
		if r, ok := cache[recordKey(mode, q.text, chunks)]; ok {
			out[i] = r
			continue
		}
		js, st := cl.Judge(ctx, q.text, ps, systemone.JudgeOptions{Mode: mode, Timeout: timeout, Thresholds: systemone.DefaultThresholds})
		r := judgeRecord{Mode: mode, Query: q.text, Chunks: chunks, LatencyMs: st.Latency.Milliseconds(), Requests: st.Requests}
		for _, j := range js {
			r.Scores, r.Skipped = append(r.Scores, j.Scores), append(r.Skipped, j.Skipped)
			if j.Skipped {
				log.Printf("%s %s: skipped: %v", mode, q.id, j.Err)
			}
		}
		b, _ := json.Marshal(r)
		if _, err := w.Write(append(b, '\n')); err != nil {
			return nil, err
		}
		_ = w.Flush()
		out[i] = r
		if fresh++; fresh%10 == 0 {
			log.Printf("%s: %d/%d queries judged (last %d ms)", mode, i+1, len(qs), r.LatencyMs)
		}
	}
	return out, nil
}

// cmdJudge evaluates passage judging on the BEIR KB created by setup.
func cmdJudge(args []string) error {
	fs := flag.NewFlagSet("judge", flag.ExitOnError)
	var c commonFlags
	var j judgeFlags
	c.register(fs)
	j.register(fs, "/tmp/ragbench/judge-fiqa.jsonl")
	dsn := fs.String("dsn", os.Getenv("BENCH_DATABASE_URL"), "Grounded database URL (read-only use)")
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory")
	qvecs := fs.String("query-vectors", "/tmp/ragbench/queries-prefix.jsonl", "cached query vectors (JSONL {id, vector})")
	n := fs.Int("queries", 150, "queries to sample (0 = all)")
	seed := fs.Uint64("seed", 20260926, "sampling seed")
	fs.IntVar(&j.k, "k", 10, "metric cutoff")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench judge [flags]\n\nJudges the fused candidates of sampled BEIR queries with a SystemOne model and\ncompares fused, re-ranked, routed and batched rankings (docs/systemone.md §5).")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := openPool(ctx, *dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	qr, err := loadQrels(*data, "test")
	if err != nil {
		return err
	}
	queries, err := loadQueries(*data, qr)
	if err != nil {
		return err
	}
	queries = sample(queries, *n, *seed)
	byID, err := readVectors(*qvecs)
	if err != nil {
		return err
	}
	js := make([]judged, len(queries))
	vecs := make([][]float32, len(queries))
	for i, q := range queries {
		if vecs[i] = byID[q.ID]; vecs[i] == nil {
			return fmt.Errorf("no cached vector for query %s", q.ID)
		}
		js[i] = judged{id: q.ID, text: q.Text, rel: qr[q.ID]}
	}
	src := uuid.MustParse(st.SourceID)
	docOf, err := loadDocKeys(ctx, pool, []uuid.UUID{src}, func(fn, _ string) string { return docIDFromFilename(fn) })
	if err != nil {
		return err
	}
	d := sweepData{pool: pool, table: "emb_" + stripDashes(st.ProfileID), dims: len(vecs[0]), sourceIDs: []uuid.UUID{src}, docOf: docOf}
	fmt.Printf("FiQA judging: %d sampled queries, %d candidates each\n", len(js), j.candidates)
	return evaluateJudging(ctx, d, js, vecs, j)
}

// evaluateJudging builds the candidates, judges them in each mode and
// prints the report.
func evaluateJudging(ctx context.Context, d sweepData, js []judged, vecs [][]float32, j judgeFlags) error {
	qs, err := buildJudgeQueries(ctx, d, js, vecs, j.candidates)
	if err != nil {
		return err
	}
	cl, err := j.client()
	if err != nil {
		return err
	}
	recs := map[string][]judgeRecord{}
	for _, mode := range strings.Split(j.modes, ",") {
		mode = strings.TrimSpace(mode)
		if mode != systemone.ModePerPassage && mode != systemone.ModeBatched {
			return fmt.Errorf("unknown mode %q", mode)
		}
		sub := qs
		if mode == systemone.ModeBatched && j.batchedLimit > 0 && j.batchedLimit < len(qs) {
			sub = qs[:j.batchedLimit]
		}
		if recs[mode], err = runJudging(ctx, cl, sub, mode, j.cache, j.timeout); err != nil {
			return err
		}
	}
	reportJudging(qs, recs, j.k)
	return nil
}
