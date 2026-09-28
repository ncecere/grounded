package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// cmdSweep runs the fusion sweep on the BEIR KB created by setup.
func cmdSweep(args []string) error {
	fs := flag.NewFlagSet("sweep", flag.ExitOnError)
	var c commonFlags
	var g gatewayFlags
	c.register(fs)
	g.register(fs)
	dsn := fs.String("dsn", os.Getenv("BENCH_DATABASE_URL"), "Grounded database URL (read-only use)")
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory")
	split := fs.String("split", "test", "qrels split")
	k := fs.Int("k", 10, "topK and metric cutoff")
	qvecs := fs.String("query-vectors", "/tmp/ragbench/queries-prefix.jsonl", "query vectors (JSONL {id, vector}, from offline -queries-out) so nothing is embedded; empty = embed through the gateway")
	weights := fs.String("keyword-weights", "0,0.1,0.2,0.3,0.5,1", "keyword weights to sweep (vector weight 1)")
	variants := fs.String("keyword-variants", "all", "comma-separated keyword query variants, or all")
	limit := fs.Int("limit", 0, "evaluate only the first N queries (0 = all)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench sweep [flags]\n\nFuses Grounded's exact vector candidates with several keyword queries at several\nkeyword weights, using the application's fusion code, and prints nDCG/recall.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	st, err := loadState(c.state)
	if err != nil {
		return err
	}
	ws, err := parseFloats(*weights)
	if err != nil {
		return err
	}
	vs, err := selectVariants(*variants)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := openPool(ctx, *dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
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
	var vecs [][]float32
	if *qvecs != "" {
		byID, err := readVectors(*qvecs)
		if err != nil {
			return err
		}
		for _, q := range queries {
			v, ok := byID[q.ID]
			if !ok {
				return fmt.Errorf("%s has no vector for query %s", *qvecs, q.ID)
			}
			vecs = append(vecs, v)
		}
	} else {
		var prefix string
		if err := pool.QueryRow(ctx, "SELECT query_prefix FROM embedding_profiles WHERE id = $1", st.ProfileID).Scan(&prefix); err != nil {
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
		if vecs, err = em.embedAll(ctx, texts, g.batch, g.concurrency, "queries"); err != nil {
			return err
		}
	}
	src := uuid.MustParse(st.SourceID)
	docOf, err := loadDocKeys(ctx, pool, []uuid.UUID{src}, func(fn, _ string) string { return docIDFromFilename(fn) })
	if err != nil {
		return err
	}
	js := make([]judged, len(queries))
	for i, q := range queries {
		js[i] = judged{id: q.ID, text: q.Text, rel: qr[q.ID]}
	}
	d := sweepData{pool: pool, table: "emb_" + stripDashes(st.ProfileID), dims: len(vecs[0]), sourceIDs: []uuid.UUID{src}, docOf: docOf}
	fmt.Printf("BEIR sweep: %d queries, %d chunks\n", len(js), len(docOf))
	return runSweep(ctx, d, js, vecs, vs, ws, *k)
}

func readVectors(path string) (map[string][]float32, error) {
	out := map[string][]float32{}
	err := readJSONL(path, func(l vectorLine) error {
		out[l.ID] = l.Vector
		return nil
	})
	return out, err
}

// urlQuestion is one line of a URL-judged evaluation set (JSONL):
//
//	{"id":"q01","question":"How do I drop a class?","urls":["https://registrar.example.edu/drop-add"]}
//
// Each URL is a page of the KB that answers the question.
type urlQuestion struct {
	ID       string   `json:"id"`
	Question string   `json:"question"`
	URLs     []string `json:"urls"`
}

// cmdURLSet evaluates a URL-judged question set against a Grounded KB: offline
// (the fusion sweep over the KB's stored vectors, questions embedded once
// through the gateway and cached) or through a running Grounded's /retrieve.
func cmdURLSet(args []string) error {
	fs := flag.NewFlagSet("urlset", flag.ExitOnError)
	var g gatewayFlags
	g.register(fs)
	dsn := fs.String("dsn", os.Getenv("URLSET_DATABASE_URL"), "Grounded database holding the KB (read-only use)")
	kbID := fs.String("kb", "", "knowledge base ID")
	evalPath := fs.String("eval", "", "questions with expected page URLs (JSONL {id, question, urls}; required)")
	k := fs.Int("k", 10, "topK and metric cutoff")
	cacheDir := fs.String("cache", "/tmp/ragbench/cache", "query embedding cache directory")
	weights := fs.String("keyword-weights", "0,0.1,0.2,0.3,0.5,1", "keyword weights to sweep (vector weight 1)")
	variants := fs.String("keyword-variants", "all", "comma-separated keyword query variants, or all")
	api := fs.String("api", "", "instead of the offline sweep, run each question through this Grounded instance's /retrieve (e.g. http://localhost:8080)")
	account := fs.String("account", "alex", "dev-login account for -api")
	judge := fs.Bool("judge", false, "instead of the fusion sweep, evaluate SystemOne passage judging (docs/systemone.md §5)")
	var j judgeFlags
	j.register(fs, "/tmp/ragbench/judge-urlset.jsonl")
	team := fs.String("team", "", "team slug for -api")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench urlset -eval questions.jsonl -kb <id> [flags]\n\nEvaluates questions whose answers are known pages (by URL) against a KB.\nEach line of -eval is {\"id\", \"question\", \"urls\": [expected page URLs]}.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	if *evalPath == "" {
		return errors.New("-eval is required: a JSONL file of {id, question, urls}")
	}
	if *api != "" && *team == "" {
		return errors.New("-team is required with -api")
	}
	js, err := loadURLQuestions(*evalPath)
	if err != nil {
		return err
	}
	if *api != "" {
		return urlSetAPI(*api, *account, *team, *kbID, js, *k)
	}
	ctx := context.Background()
	pool, err := openPool(ctx, *dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	kb, err := loadKBEmbedding(ctx, pool, *kbID)
	if err != nil {
		return err
	}
	docOf, err := loadDocKeys(ctx, pool, kb.sources, func(fn, u string) string {
		if u != "" {
			return normURL(u)
		}
		return fn
	})
	if err != nil {
		return err
	}
	if err := checkJudgedDocs(js, docOf); err != nil {
		return err
	}
	ids := make([]string, len(js))
	texts := make([]string, len(js))
	for i, q := range js {
		ids[i], texts[i] = q.text, kb.prefix+q.text // keyed by text: edits re-embed
	}
	g.model = kb.upstream
	em, err := g.embedder()
	if err != nil {
		return err
	}
	vecs, err := cachedEmbed(ctx, em, g, *cacheDir, "urlset-query", kb.upstream+"|"+kb.prefix, ids, texts)
	if err != nil {
		return err
	}
	d := sweepData{pool: pool, table: "emb_" + stripDashes(kb.profileID.String()), dims: kb.dims, sourceIDs: kb.sources, docOf: docOf}
	if *judge {
		j.k = *k
		fmt.Printf("URL-set judging: %d questions, %d candidates each\n", len(js), j.candidates)
		return evaluateJudging(ctx, d, js, vecs, j)
	}
	ws, err := parseFloats(*weights)
	if err != nil {
		return err
	}
	vs, err := selectVariants(*variants)
	if err != nil {
		return err
	}
	fmt.Printf("URL-set sweep: %d questions, %d chunks, gateway tokens this run: %d\n", len(js), len(docOf), em.tokens)
	return runSweep(ctx, d, js, vecs, vs, ws, *k)
}

// loadURLQuestions reads the questions; each expected URL is a relevant
// document.
func loadURLQuestions(path string) ([]judged, error) {
	var qs []urlQuestion
	if err := readJSONL(path, func(q urlQuestion) error {
		qs = append(qs, q)
		return nil
	}); err != nil {
		return nil, err
	}
	js := make([]judged, len(qs))
	for i, q := range qs {
		rel := map[string]int{}
		for _, u := range q.URLs {
			rel[normURL(u)] = 1
		}
		js[i] = judged{id: q.ID, text: q.Question, rel: rel}
	}
	return js, nil
}

// kbEmbedding is a KB's embedding profile and sources.
type kbEmbedding struct {
	profileID        uuid.UUID
	prefix, upstream string
	dims             int
	sources          []uuid.UUID
}

func loadKBEmbedding(ctx context.Context, pool *pgxpool.Pool, kbID string) (kbEmbedding, error) {
	var kb kbEmbedding
	if err := pool.QueryRow(ctx, `SELECT p.id, p.query_prefix, p.dimensions, m.upstream_model FROM knowledge_bases kb
		JOIN embedding_profiles p ON p.id = kb.embedding_profile_id JOIN models m ON m.id = p.model_id WHERE kb.id = $1`, kbID).
		Scan(&kb.profileID, &kb.prefix, &kb.dims, &kb.upstream); err != nil {
		return kb, fmt.Errorf("kb %s: %w", kbID, err)
	}
	rows, err := pool.Query(ctx, "SELECT source_id FROM kb_sources WHERE kb_id = $1", kbID)
	if err != nil {
		return kb, err
	}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return kb, err
		}
		kb.sources = append(kb.sources, id)
	}
	return kb, rows.Err()
}

// checkJudgedDocs checks that every expected URL is a document of the KB.
func checkJudgedDocs(js []judged, docOf map[uuid.UUID]string) error {
	for _, q := range js {
		for u := range q.rel {
			if !hasDoc(docOf, u) {
				return fmt.Errorf("question %s: %s is not a document of this KB", q.id, u)
			}
		}
	}
	return nil
}

func hasDoc(docOf map[uuid.UUID]string, key string) bool {
	for _, v := range docOf {
		if v == key {
			return true
		}
	}
	return false
}

// normURL compares page URLs without a trailing slash.
func normURL(u string) string { return strings.TrimRight(strings.TrimSpace(u), "/") }

// urlSetAPI runs the questions through POST /retrieve and prints the metrics
// and each question's rank of its first relevant page.
func urlSetAPI(base, account, team, kbID string, js []judged, k int) error {
	cl, err := newClient(base, account)
	if err != nil {
		return err
	}
	var sum summary
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for _, q := range js {
		var res struct {
			Hits []struct {
				URL         string `json:"url"`
				VectorRank  *int   `json:"vectorRank"`
				LexicalRank *int   `json:"lexicalRank"`
			} `json:"hits"`
		}
		err := cl.do("POST", "/v1/teams/"+team+"/kbs/"+kbID+"/retrieve", map[string]any{"query": q.text, "topK": k}, &res)
		var ae *apiError
		if errors.As(err, &ae) && (ae.Status == 503 || ae.Status == 502) {
			err = cl.do("POST", "/v1/teams/"+team+"/kbs/"+kbID+"/retrieve", map[string]any{"query": q.text, "topK": k}, &res)
		}
		if err != nil {
			return fmt.Errorf("%s: %w", q.id, err)
		}
		urls := make([]string, len(res.Hits))
		for i, h := range res.Hits {
			urls[i] = normURL(h.URL)
		}
		docs := dedupe(urls)
		m := score(docs, q.rel, k)
		sum.add(m)
		rank := 0
		for i, u := range docs {
			if q.rel[u] > 0 {
				rank = i + 1
				break
			}
		}
		fmt.Fprintf(w, "%s rank=%d %s\n", q.id, rank, q.text)
	}
	b, _ := json.Marshal(map[string]any{"k": k})
	fmt.Fprintf(w, "api %s %s: %s\n", base, b, sum)
	return nil
}
