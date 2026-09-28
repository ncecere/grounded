package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/vectorstore"
)

// Query instructions for Qwen3-Embedding (model card: queries get
// "Instruct: {task}\nQuery:{query}", documents nothing).
const (
	qwenFormat      = "Instruct: %s\nQuery:%s"
	taskGeneric     = "Given a web search query, retrieve relevant passages that answer the query"
	taskFiQA        = "Given a financial question, retrieve user replies that best answer the question" // MTEB's FiQA2018 instruction
	taskURLSet      = "Given a university student's question, retrieve passages from the university registrar's website that answer the question"
	defaultBenchDSN = "postgres://grounded:grounded-dev-only@127.0.0.1:55432/grounded_bench?sslmode=disable"
	defaultDevDSN   = "postgres://grounded:grounded-dev-only@127.0.0.1:55432/grounded?sslmode=disable"
)

// evalChunk is one chunk of the evaluated KB.
type evalChunk struct {
	id        uuid.UUID
	doc       string // document key: BEIR ID or page URL
	embedText string // chunk.EmbedText(title, chunk), what Grounded embeds (before the profile prefix)
	nomic     []float32
}

type evalQuery struct {
	id, text string
	rel      map[string]int
	nomic    []float32 // stored nomic query vector (search_query: prefix)
}

// evalSet is a KB (read from a Grounded database) with judged questions.
type evalSet struct {
	name      string
	pool      *pgxpool.Pool
	sourceIDs []uuid.UUID
	table     string
	chunks    []evalChunk
	queries   []evalQuery
	task      string // set-specific Qwen3 instruction
	docOf     map[uuid.UUID]string
}

// retrievalFlags are the flags of the retrieval command.
type retrievalFlags struct {
	set, dsn, source, profile, kbName, data, nomicQueries, nomicCache, evalPath string
	cacheDir, dims, formats                                                     string
	wk                                                                          float64
	k, batch, conc                                                              int
}

func (f *retrievalFlags) register(fs *flag.FlagSet) {
	fs.StringVar(&f.set, "set", "fiqa", "evaluation set: fiqa (grounded_bench 10k-document KB) or urlset (a dev KB named by -kb-name with a URL-judged -eval set)")
	fs.StringVar(&f.dsn, "dsn", "", "Grounded database (read-only use; default grounded_bench for fiqa, grounded for urlset)")
	fs.StringVar(&f.source, "source", "99417050-a92f-4f65-84ca-4d77379d2c05", "fiqa: the benchmark upload source ID (ragbench state.json)")
	fs.StringVar(&f.profile, "profile", "01744571-9c90-4c15-80aa-f08a74ce47bf", "fiqa: the benchmark embedding profile ID")
	fs.StringVar(&f.kbName, "kb-name", "", "urlset: knowledge base name (required)")
	fs.StringVar(&f.data, "data", "/tmp/ragbench/fiqa", "fiqa: BEIR dataset directory (queries, qrels)")
	fs.StringVar(&f.nomicQueries, "nomic-query-vectors", "/tmp/ragbench/queries-prefix.jsonl", "fiqa: stored nomic query vectors (ragbench offline -queries-out)")
	fs.StringVar(&f.nomicCache, "nomic-cache", "/tmp/ragbench/cache", "urlset: ragbench cache dir holding the nomic question vectors (ragbench urlset); missing ones are embedded through the gateway")
	fs.StringVar(&f.evalPath, "eval", "", "urlset: questions with expected URLs (JSONL {id, question, urls}; required)")
	fs.StringVar(&f.cacheDir, "cache", "/tmp/sparkbench/cache", "qwen3 embedding cache directory")
	fs.StringVar(&f.dims, "dims", "0,1024,768", "qwen3 dimensions to evaluate (0 = full; others are Matryoshka truncations, renormalized)")
	fs.StringVar(&f.formats, "query-formats", "none,generic,set", "qwen3 query formats: none (raw question), generic (model card's web-search instruction), set (task-specific instruction)")
	fs.Float64Var(&f.wk, "keyword-weight", 0.1, "keyword weight of the hybrid rows (vector weight 1; Grounded's default)")
	fs.IntVar(&f.k, "k", 10, "metric cutoff (Grounded asks 4 x k vector and keyword candidates)")
	fs.IntVar(&f.batch, "batch", 32, "inputs per Spark embedding request")
	fs.IntVar(&f.conc, "concurrency", 4, "concurrent Spark embedding requests (the Spark is one machine: at most 4)")
}

// loadSet opens the chosen evaluation set.
func (f *retrievalFlags) loadSet(ctx context.Context) (*evalSet, error) {
	switch f.set {
	case "fiqa":
		if f.dsn == "" {
			f.dsn = defaultBenchDSN
		}
		return loadFiQA(ctx, f.dsn, f.source, f.profile, f.data, f.nomicQueries)
	case "urlset":
		if f.evalPath == "" || f.kbName == "" {
			return nil, errors.New("-set urlset needs -eval and -kb-name")
		}
		if f.dsn == "" {
			f.dsn = defaultDevDSN
		}
		return loadURLSet(ctx, f.dsn, f.kbName, f.evalPath, f.nomicCache)
	}
	return nil, fmt.Errorf("unknown set %q", f.set)
}

func cmdRetrieval(args []string) error {
	fs := flag.NewFlagSet("retrieval", flag.ExitOnError)
	var f retrievalFlags
	f.register(fs)
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), `usage: sparkbench retrieval [flags]

Embeds every chunk of the KB (chunk.EmbedText, as Grounded does, no document
prefix) and the questions with the Spark's qwen3-embedding-4b (cached), and
compares it with the KB's stored nomic-embed-text-v1.5 vectors: exact
vector-only search and Grounded's hybrid fusion (kbs.Fuse over 4 x k vector
candidates and kbs.LexicalSQL keyword candidates). Vectors are rounded to
float16 like Grounded's halfvec. Prints markdown tables.`)
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	ctx := context.Background()
	es, err := f.loadSet(ctx)
	if err != nil {
		return err
	}
	defer es.pool.Close()
	spark, err := newEndpoint("spark-embed", 0)
	if err != nil {
		return err
	}
	dims, err := parseInts(f.dims)
	if err != nil {
		return err
	}
	fmt.Printf("%s: %d chunks, %d questions\n", es.name, len(es.chunks), len(es.queries))
	t0 := time.Now()
	qdocs, err := es.embedChunks(ctx, spark, f)
	if err != nil {
		return err
	}
	fmt.Printf("qwen3 chunk vectors ready in %s\n", time.Since(t0).Round(time.Millisecond))
	kw, err := es.keywordCandidates(ctx, max(f.k*4, 20))
	if err != nil {
		return err
	}
	var kwOnly summary
	for i, q := range es.queries {
		kwOnly.add(score(es.docKeys(kw[i]), q.rel, f.k))
	}
	k := f.k
	fmt.Printf("\n| model | query format | dims | vector nDCG@%d | recall@%d | MRR@%d | hybrid (wk=%g) nDCG@%d | recall@%d | MRR@%d |\n", k, k, k, f.wk, k, k, k)
	fmt.Println("|---|---|---:|---:|---:|---:|---:|---:|---:|")
	fmt.Printf("| (keyword only, Grounded's query) | | | %s | | | |\n", kwOnly.cells())
	v, h := es.evaluateNomic(kw, f.k, f.wk)
	fmt.Printf("| nomic-embed-text-v1.5 (stored) | `search_query: ` | 768 | %s | %s |\n", v.cells(), h.cells())
	for _, format := range strings.Split(f.formats, ",") {
		if err := es.evaluateQwen(ctx, spark, f, format, qdocs, dims, kw); err != nil {
			return err
		}
	}
	return nil
}

// embedChunks embeds the chunks with the Spark (cached).
func (es *evalSet) embedChunks(ctx context.Context, spark *endpoint, f retrievalFlags) ([][]float32, error) {
	ids := make([]string, len(es.chunks))
	texts := make([]string, len(es.chunks))
	for i, c := range es.chunks {
		ids[i], texts[i] = c.id.String(), c.embedText
	}
	return cachedEmbed(ctx, spark, f.cacheDir, es.name+"|chunks|", ids, texts, f.batch, f.conc)
}

// keywordCandidates runs Grounded's keyword query once per question.
func (es *evalSet) keywordCandidates(ctx context.Context, cands int) ([][]uuid.UUID, error) {
	kw := make([][]uuid.UUID, len(es.queries))
	lexSQL := fmt.Sprintf(kbs.LexicalSQL, "true")
	for i, q := range es.queries {
		rows, err := es.pool.Query(ctx, lexSQL, q.text, es.sourceIDs, cands)
		if err != nil {
			return nil, err
		}
		if kw[i], err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
			return nil, err
		}
	}
	return kw, nil
}

// evaluateNomic scores the stored nomic vectors (already halfvec) with the
// stored query vectors.
func (es *evalSet) evaluateNomic(kw [][]uuid.UUID, k int, wk float64) (summary, summary) {
	nd := make([][]float32, len(es.chunks))
	for i, c := range es.chunks {
		nd[i] = prepare(c.nomic, 0, false)
	}
	nq := make([][]float32, len(es.queries))
	for i, q := range es.queries {
		nq[i] = prepare(q.nomic, 0, true)
	}
	return es.evaluate(nq, nd, kw, k, wk)
}

// queryTexts are the questions in one qwen3 query format, and its label.
func (es *evalSet) queryTexts(format string) ([]string, string, error) {
	out := make([]string, len(es.queries))
	for i, q := range es.queries {
		switch format {
		case "none":
			out[i] = q.text
		case "generic":
			out[i] = fmt.Sprintf(qwenFormat, taskGeneric, q.text)
		case "set":
			out[i] = fmt.Sprintf(qwenFormat, es.task, q.text)
		default:
			return nil, "", fmt.Errorf("unknown query format %q", format)
		}
	}
	label := map[string]string{"none": "none", "generic": "Instruct: web search", "set": "Instruct: task-specific"}[format]
	return out, label, nil
}

// evaluateQwen prints one row per dimension for a query format.
func (es *evalSet) evaluateQwen(ctx context.Context, spark *endpoint, f retrievalFlags, format string, qdocs [][]float32, dims []int, kw [][]uuid.UUID) error {
	qtexts, label, err := es.queryTexts(format)
	if err != nil {
		return err
	}
	qids := make([]string, len(es.queries))
	for i, q := range es.queries {
		qids[i] = q.id + "|" + q.text
	}
	qvecs, err := cachedEmbed(ctx, spark, f.cacheDir, es.name+"|query|"+format+"|"+es.task, qids, qtexts, f.batch, f.conc)
	if err != nil {
		return err
	}
	for _, d := range dims {
		docs := make([][]float32, len(qdocs))
		for i, x := range qdocs {
			docs[i] = prepare(x, d, true)
		}
		qs := make([][]float32, len(qvecs))
		for i, x := range qvecs {
			qs[i] = prepare(x, d, true)
		}
		v, h := es.evaluate(qs, docs, kw, f.k, f.wk)
		fmt.Printf("| qwen3-embedding-4b | %s | %s | %s | %s |\n", label, strconv.Itoa(len(docs[0])), v.cells(), h.cells())
	}
	return nil
}

// evaluate scores vector-only and fused retrieval for one model's vectors.
func (es *evalSet) evaluate(qvecs, docs [][]float32, kw [][]uuid.UUID, k int, wk float64) (vec, hyb summary) {
	cands := max(k*4, 20)
	res := searchAll(qvecs, docs, cands)
	for qi, q := range es.queries {
		hits := make([]vectorstore.Hit, len(res[qi]))
		ids := make([]uuid.UUID, len(res[qi]))
		for i, s := range res[qi] {
			hits[i] = vectorstore.Hit{ChunkID: es.chunks[s.i].id, Distance: 1 - float64(s.sim)}
			ids[i] = hits[i].ChunkID
		}
		vec.add(score(es.docKeys(ids), q.rel, k))
		fused := kbs.Fuse(hits, kw[qi], kbs.Weights{Vector: 1, Keyword: wk})
		fids := make([]uuid.UUID, len(fused))
		for i, f := range fused {
			fids[i] = f.ChunkID
		}
		hyb.add(score(es.docKeys(fids), q.rel, k))
	}
	return vec, hyb
}

func (es *evalSet) docKeys(ids []uuid.UUID) []string {
	if es.docOf == nil {
		es.docOf = make(map[uuid.UUID]string, len(es.chunks))
		for _, c := range es.chunks {
			es.docOf[c.id] = c.doc
		}
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if d, ok := es.docOf[id]; ok {
			out = append(out, d)
		}
	}
	return dedupe(out)
}

func parseInts(s string) ([]int, error) {
	var out []int
	for _, f := range strings.Split(s, ",") {
		if f = strings.TrimSpace(f); f == "" {
			continue
		}
		n, err := strconv.Atoi(f)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}
