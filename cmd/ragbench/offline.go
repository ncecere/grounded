package main

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	pgvector "github.com/pgvector/pgvector-go"
)

// benchSourceID is the source_id given to offline corpus vectors exported
// with -export-table, so vecbench can filter on it like a KB.
var benchSourceID = uuid.MustParse("00000000-0000-4000-8000-00000000f1a0")

// cmdOffline embeds the corpus and queries directly (no Grounded) and evaluates
// exact dense retrieval in memory. Embeddings are cached per model and
// prefix, so ablations only pay for what changed.
func cmdOffline(args []string) error {
	fset := flag.NewFlagSet("offline", flag.ExitOnError)
	var g gatewayFlags
	g.register(fset)
	data := fset.String("data", "/tmp/ragbench/fiqa", "BEIR dataset directory")
	split := fset.String("split", "test", "qrels split")
	k := fset.Int("k", 10, "metric cutoff")
	docPrefix := fset.String("doc-prefix", "search_document: ", "document prefix")
	queryPrefix := fset.String("query-prefix", "search_query: ", "query prefix")
	maxDocs := fset.Int("max-docs", 0, "evaluate on the same subset as upload -max-docs (0 = whole corpus)")
	idHeader := fset.Bool("id-header", false, "prepend \"<doc id>\\n\\n\" like Grounded does for .txt uploads (title from filename)")
	maxChars := fset.Int("max-chars", 8000, "truncate documents to this many characters before embedding (0 = no limit)")
	cacheDir := fset.String("cache", "/tmp/ragbench/cache", "embedding cache directory")
	queriesOut := fset.String("queries-out", "", "write query vectors as JSONL for vecbench -query-vectors")
	exportDSN := fset.String("export-dsn", "", "database for -export-table")
	exportTable := fset.String("export-table", "", "write corpus vectors to this table (chunk_id, source_id, embedding halfvec) for vecbench -real-table")
	fset.Usage = func() {
		fmt.Fprintln(fset.Output(), "usage: ragbench offline [flags]\n\nEmbeds corpus and queries through the gateway (cached) and reports exact\ndense recall@k/nDCG@k in memory. Use it for prefix ablations and to produce\nreal vectors for the HNSW gate (vecbench -real-table).")
		fset.PrintDefaults()
	}
	_ = fset.Parse(args)
	ctx := context.Background()
	qr, err := loadQrels(*data, *split)
	if err != nil {
		return err
	}
	queries, err := loadQueries(*data, qr)
	if err != nil {
		return err
	}
	all, err := loadCorpus(*data)
	if err != nil {
		return err
	}
	docs, _ := selectDocs(all, qr, *maxDocs)
	em, err := g.embedder()
	if err != nil {
		return err
	}
	texts, ids := embedTexts(docs, *docPrefix, *maxChars, *idHeader)
	variant := fmt.Sprintf("%s|%s|%v|%d", g.model, *docPrefix, *idHeader, *maxChars)
	dvecs, err := cachedEmbed(ctx, em, g, *cacheDir, "doc", variant, ids, texts)
	if err != nil {
		return err
	}
	qtexts := make([]string, len(queries))
	qids := make([]string, len(queries))
	for i, q := range queries {
		qtexts[i], qids[i] = *queryPrefix+q.Text, q.ID
	}
	qvecs, err := cachedEmbed(ctx, em, g, *cacheDir, "query", g.model+"|"+*queryPrefix, qids, qtexts)
	if err != nil {
		return err
	}
	if *queriesOut != "" {
		if err := writeVectors(*queriesOut, queries, qvecs); err != nil {
			return err
		}
	}
	for _, v := range dvecs {
		normalize(v)
	}
	var sum summary
	results := searchExact(qvecs, dvecs, ids, *k)
	for i, q := range queries {
		sum.add(score(results[i], qr[q.ID], *k))
	}
	fmt.Printf("offline dense exact: docs=%d doc-prefix=%q query-prefix=%q id-header=%v: %s @%d (gateway tokens this run: %d)\n",
		len(docs), *docPrefix, *queryPrefix, *idHeader, sum, *k, em.tokens)
	if *exportTable != "" {
		return exportVectors(ctx, *exportDSN, *exportTable, ids, dvecs)
	}
	return nil
}

// embedTexts are the documents' texts as embedded: truncated to maxChars
// (on a rune boundary), optionally with an ID header, with the prefix.
func embedTexts(docs []beirDoc, prefix string, maxChars int, idHeader bool) (texts, ids []string) {
	texts = make([]string, len(docs))
	ids = make([]string, len(docs))
	for i, d := range docs {
		t := docText(d)
		if maxChars > 0 && len(t) > maxChars {
			t = t[:maxChars]
			for !utf8.ValidString(t) {
				t = t[:len(t)-1]
			}
		}
		if idHeader {
			t = d.ID + "\n\n" + t
		}
		texts[i], ids[i] = prefix+t, d.ID
	}
	return texts, ids
}

// searchExact returns each query's top k document IDs by exact search, on
// all CPUs.
func searchExact(qvecs, dvecs [][]float32, ids []string, k int) [][]string {
	results := make([][]string, len(qvecs))
	var wg sync.WaitGroup
	next := make(chan int)
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				results[i] = topK(normalize(append([]float32(nil), qvecs[i]...)), dvecs, ids, k)
			}
		}()
	}
	for i := range qvecs {
		next <- i
	}
	close(next)
	wg.Wait()
	return results
}

func normalize(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	if n = math.Sqrt(n); n > 0 {
		for i := range v {
			v[i] = float32(float64(v[i]) / n)
		}
	}
	return v
}

func topK(q []float32, docs [][]float32, ids []string, k int) []string {
	type sc struct {
		i int
		s float32
	}
	best := make([]sc, 0, k+1)
	for i, d := range docs {
		var s float32
		for j := range q {
			s += q[j] * d[j]
		}
		if len(best) < k || s > best[len(best)-1].s {
			best = append(best, sc{i, s})
			sort.Slice(best, func(a, b int) bool { return best[a].s > best[b].s })
			if len(best) > k {
				best = best[:k]
			}
		}
	}
	out := make([]string, len(best))
	for i, b := range best {
		out[i] = ids[b.i]
	}
	return out
}

// cachedEmbed returns vectors for ids, embedding only those missing from the
// cache file for this variant. The cache is append-only binary records:
// uint16 id length, id, uint16 dims, dims x float32.
func cachedEmbed(ctx context.Context, em *embedder, g gatewayFlags, dir, kind, variant string, ids, texts []string) ([][]float32, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	h := sha1.Sum([]byte(variant))
	path := filepath.Join(dir, kind+"-"+hex.EncodeToString(h[:6])+".bin")
	cache := map[string][]float32{}
	if f, err := os.Open(path); err == nil {
		r := bufio.NewReader(f)
		for {
			v, id, err := readRecord(r)
			if errors.Is(err, io.EOF) {
				break
			} else if err != nil {
				f.Close()
				return nil, fmt.Errorf("%s: %w", path, err)
			}
			cache[id] = v
		}
		f.Close()
	}
	var missIdx []int
	for i, id := range ids {
		if _, ok := cache[id]; !ok {
			missIdx = append(missIdx, i)
		}
	}
	if len(missIdx) > 0 {
		log.Printf("%s: %d cached, embedding %d (%s)", kind, len(ids)-len(missIdx), len(missIdx), path)
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		// Embed in slices so progress survives interruptions.
		const slice = 2048
		for s := 0; s < len(missIdx); s += slice {
			part := missIdx[s:min(s+slice, len(missIdx))]
			in := make([]string, len(part))
			for j, i := range part {
				in[j] = texts[i]
			}
			vecs, err := em.embedAll(ctx, in, g.batch, g.concurrency, kind)
			if err != nil {
				return nil, err
			}
			w := bufio.NewWriter(f)
			for j, i := range part {
				cache[ids[i]] = vecs[j]
				if err := writeRecord(w, ids[i], vecs[j]); err != nil {
					return nil, err
				}
			}
			if err := w.Flush(); err != nil {
				return nil, err
			}
			log.Printf("%s: %d/%d embedded", kind, min(s+slice, len(missIdx)), len(missIdx))
		}
	}
	out := make([][]float32, len(ids))
	for i, id := range ids {
		out[i] = append([]float32(nil), cache[id]...)
	}
	return out, nil
}

func writeRecord(w io.Writer, id string, v []float32) error {
	if err := binary.Write(w, binary.LittleEndian, uint16(len(id))); err != nil {
		return err
	}
	if _, err := io.WriteString(w, id); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(len(v))); err != nil {
		return err
	}
	return binary.Write(w, binary.LittleEndian, v)
}

func readRecord(r io.Reader) ([]float32, string, error) {
	var n uint16
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return nil, "", err
	}
	id := make([]byte, n)
	if _, err := io.ReadFull(r, id); err != nil {
		return nil, "", err
	}
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		return nil, "", err
	}
	v := make([]float32, n)
	if err := binary.Read(r, binary.LittleEndian, v); err != nil {
		return nil, "", err
	}
	return v, string(id), nil
}

// exportVectors writes corpus vectors to a scratch table shaped like Grounded's
// profile tables (without the chunks foreign key).
func exportVectors(ctx context.Context, dsn, table string, ids []string, vecs [][]float32) error {
	pool, err := openPool(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	t := pgx.Identifier{table}.Sanitize()
	dims := len(vecs[0])
	for _, stmt := range []string{
		"CREATE EXTENSION IF NOT EXISTS vector",
		"DROP TABLE IF EXISTS " + t,
		fmt.Sprintf("CREATE TABLE %s (chunk_id uuid PRIMARY KEY, source_id uuid NOT NULL, embedding halfvec(%d) NOT NULL)", t, dims),
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	ns := uuid.MustParse("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	pr, pw := io.Pipe()
	go func() {
		w := bufio.NewWriterSize(pw, 1<<20)
		for i, id := range ids {
			fmt.Fprintf(w, "%s\t%s\t%s\n", uuid.NewSHA1(ns, []byte(id)), benchSourceID, pgvector.NewHalfVector(vecs[i]).String())
		}
		_ = w.Flush()
		_ = pw.Close()
	}()
	if _, err := conn.Conn().PgConn().CopyFrom(ctx, pr, "COPY "+t+" (chunk_id, source_id, embedding) FROM STDIN"); err != nil {
		return fmt.Errorf("copy: %w", err)
	}
	log.Printf("exported %d vectors to %s (source_id %s)", len(ids), table, benchSourceID)
	return nil
}
