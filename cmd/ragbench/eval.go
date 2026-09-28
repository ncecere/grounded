package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"sync"
	"time"
)

type retrieveHit struct {
	DocumentID  string  `json:"documentId"`
	Filename    string  `json:"filename"`
	Title       string  `json:"title"`
	Score       float64 `json:"score"`
	VectorRank  *int    `json:"vectorRank"`
	LexicalRank *int    `json:"lexicalRank"`
}

type evalRecord struct {
	QueryID    string   `json:"queryId"`
	Docs       []string `json:"docs"`
	Hits       int      `json:"hits"`
	WallMs     float64  `json:"wallMs"`
	ServerMs   int64    `json:"serverMs"`
	Recall     float64  `json:"recall"`
	NDCG       float64  `json:"ndcg"`
	VectorOnly int      `json:"vectorOnlyHits"`
	LexOnly    int      `json:"lexicalOnlyHits"`
	Both       int      `json:"bothHits"`
	Error      string   `json:"error,omitempty"`
}

func cmdEval(args []string) error {
	fs := flag.NewFlagSet("eval", flag.ExitOnError)
	var c commonFlags
	c.register(fs)
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory")
	split := fs.String("split", "test", "qrels split")
	k := fs.Int("k", 10, "topK sent to /retrieve and the metric cutoff")
	conc := fs.Int("concurrency", 1, "concurrent /retrieve calls (each embeds the query through the gateway)")
	limit := fs.Int("limit", 0, "evaluate only the first N queries (0 = all)")
	rpm := fs.Int("rpm", 0, "send at most this many queries per minute (stay under the gateway key limit; 0 = no pacing)")
	tag := fs.String("tag", "run", "label written with the per-query results")
	out := fs.String("out", "", "per-query JSONL results (default /tmp/ragbench/eval-<tag>.jsonl)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench eval [flags]\n\nRuns each judged query through POST /v1/teams/{team}/kbs/{kb}/retrieve,\nmaps hits back to BEIR doc IDs via the filename, and reports recall@k,\nnDCG@k, MRR@k and client/server latency percentiles.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	if st.KBID == "" {
		return errors.New("run setup first")
	}
	qr, err := loadQrels(*data, *split)
	if err != nil {
		return err
	}
	queries, err := loadQueries(*data, qr)
	if err != nil {
		return err
	}
	if *limit > 0 && *limit < len(queries) {
		queries = queries[:*limit]
	}
	if *out == "" {
		*out = "/tmp/ragbench/eval-" + *tag + ".jsonl"
	}
	f, err := os.Create(*out)
	if err != nil {
		return err
	}
	defer f.Close()
	cl, err := newClient(c.base, "admin")
	if err != nil {
		return err
	}
	path := "/v1/teams/" + st.Team + "/kbs/" + st.KBID + "/retrieve"
	recs := make([]evalRecord, len(queries))
	runPaced(len(queries), *conc, *rpm, func(i int) {
		recs[i] = evalQuery(cl, path, queries[i], qr[queries[i].ID], *k)
	})
	reportEval(f, recs, queries, qr, *k, *tag, *out)
	return nil
}

// runPaced calls work for 0..n-1 on conc goroutines, starting at most rpm
// per minute (0 = no pacing), and logs progress every 100 items.
func runPaced(n, conc, rpm int, work func(i int)) {
	jobs := make(chan int)
	var wg sync.WaitGroup
	var mu sync.Mutex
	done := 0
	start := time.Now()
	for w := 0; w < max(conc, 1); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				work(i)
				mu.Lock()
				done++
				if done%100 == 0 {
					log.Printf("%d/%d queries (%.1f/s)", done, n, float64(done)/time.Since(start).Seconds())
				}
				mu.Unlock()
			}
		}()
	}
	var pace <-chan time.Time
	if rpm > 0 {
		t := time.NewTicker(time.Minute / time.Duration(rpm))
		defer t.Stop()
		pace = t.C
	}
	for i := 0; i < n; i++ {
		if pace != nil && i > 0 {
			<-pace
		}
		jobs <- i
	}
	close(jobs)
	wg.Wait()
}

// evalQuery runs one query through /retrieve (retrying 503 and 429) and
// scores the hits against the judged documents.
func evalQuery(cl *client, path string, q beirQuery, judged map[string]int, k int) evalRecord {
	rec := evalRecord{QueryID: q.ID}
	var res struct {
		Hits      []retrieveHit `json:"hits"`
		LatencyMs int64         `json:"latencyMs"`
	}
	t0 := time.Now()
	var err error
	for attempt := 1; attempt <= 5; attempt++ {
		err = cl.do("POST", path, map[string]any{"query": q.Text, "topK": k}, &res)
		var ae *apiError
		if err == nil || !errors.As(err, &ae) || (ae.Status != 503 && ae.Status != 429) {
			break
		}
		time.Sleep(time.Duration(attempt) * 5 * time.Second)
		t0 = time.Now()
	}
	rec.WallMs = float64(time.Since(t0).Microseconds()) / 1000
	if err != nil {
		rec.Error = err.Error()
		return rec
	}
	rec.ServerMs = res.LatencyMs
	rec.Hits = len(res.Hits)
	ids := make([]string, len(res.Hits))
	for j, h := range res.Hits {
		ids[j] = docIDFromFilename(h.Filename)
		switch {
		case h.VectorRank != nil && h.LexicalRank != nil:
			rec.Both++
		case h.VectorRank != nil:
			rec.VectorOnly++
		default:
			rec.LexOnly++
		}
	}
	rec.Docs = dedupe(ids)
	m := score(rec.Docs, judged, k)
	rec.Recall, rec.NDCG = m.recall, m.ndcg
	return rec
}

// reportEval writes the per-query records and prints the summary.
func reportEval(f *os.File, recs []evalRecord, queries []beirQuery, qr qrels, k int, tag, out string) {
	var sum summary
	var wall, server []float64
	failed := 0
	var vOnly, lOnly, both int
	enc := json.NewEncoder(f)
	for i, rec := range recs {
		_ = enc.Encode(rec)
		if rec.Error != "" {
			failed++
			log.Printf("query %s: %s", rec.QueryID, rec.Error)
			continue
		}
		sum.add(score(rec.Docs, qr[queries[i].ID], k))
		wall = append(wall, rec.WallMs)
		server = append(server, float64(rec.ServerMs))
		vOnly += rec.VectorOnly
		lOnly += rec.LexOnly
		both += rec.Both
	}
	fmt.Printf("eval %s: %s @%d, failed=%d\n", tag, sum, k, failed)
	fmt.Printf("  latency client p50=%.0fms p95=%.0fms p99=%.0fms; server p50=%.0fms p95=%.0fms\n",
		pct(wall, 50), pct(wall, 95), pct(wall, 99), pct(server, 50), pct(server, 95))
	fmt.Printf("  hits by origin: vector+lexical=%d vector-only=%d lexical-only=%d\n", both, vOnly, lOnly)
	fmt.Printf("  per-query results: %s\n", out)
}

// cmdDense evaluates dense-only retrieval with exact search over Grounded's
// stored vectors, and exports the query vectors for vecbench -real-table.
func cmdDense(args []string) error {
	fs := flag.NewFlagSet("dense", flag.ExitOnError)
	var c commonFlags
	var g gatewayFlags
	c.register(fs)
	g.register(fs)
	dsn := fs.String("dsn", os.Getenv("BENCH_DATABASE_URL"), "Grounded database URL (read-only use)")
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory")
	split := fs.String("split", "test", "qrels split")
	k := fs.Int("k", 10, "metric cutoff")
	qp := fs.String("query-prefix", "@profile", "query prefix; @profile uses the embedding profile's")
	vecOut := fs.String("vectors-out", "", "write query vectors as JSONL {id, vector} for vecbench -query-vectors")
	fusion := fs.Bool("fusion", false, "also run Grounded's lexical query and compare dense-only, lexical-only and RRF variants on the same candidates")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench dense [flags]\n\nEmbeds the judged queries through the gateway and runs exact cosine search\nover the KB source's rows in Grounded's emb_<profile> table (no lexical search,\nno fusion), so the embedding quality can be compared with published numbers.")
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
	prefix := *qp
	if prefix == "@profile" {
		if err := pool.QueryRow(ctx, "SELECT query_prefix FROM embedding_profiles WHERE id = $1", st.ProfileID).Scan(&prefix); err != nil {
			return err
		}
	}
	qr, err := loadQrels(*data, *split)
	if err != nil {
		return err
	}
	queries, err := loadQueries(*data, qr)
	if err != nil {
		return err
	}
	em, err := g.embedder()
	if err != nil {
		return err
	}
	texts := make([]string, len(queries))
	for i, q := range queries {
		texts[i] = prefix + q.Text
	}
	vecs, err := em.embedAll(ctx, texts, g.batch, g.concurrency, "queries")
	if err != nil {
		return err
	}
	if *vecOut != "" {
		if err := writeVectors(*vecOut, queries, vecs); err != nil {
			return err
		}
	}
	table := "emb_" + stripDashes(st.ProfileID)
	var sum summary
	var lat []float64
	for i, q := range queries {
		t0 := time.Now()
		ids, err := exactDocs(ctx, pool, table, st.SourceID, vecs[i], *k*4)
		if err != nil {
			return err
		}
		lat = append(lat, float64(time.Since(t0).Microseconds())/1000)
		sum.add(score(dedupe(ids), qr[q.ID], *k))
	}
	fmt.Printf("dense exact (query prefix %q): %s @%d; exact search p50=%.1fms p95=%.1fms\n", prefix, sum, *k, pct(lat, 50), pct(lat, 95))
	if *fusion {
		return fusionReport(ctx, pool, table, st.SourceID, queries, vecs, qr, *k)
	}
	return nil
}
