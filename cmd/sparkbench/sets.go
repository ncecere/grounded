package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"

	"github.com/ncecere/grounded/internal/chunk"
)

// loadChunks reads the chunks of the sources with their stored vectors and
// the text Grounded embedded for them.
func loadChunks(ctx context.Context, pool *pgxpool.Pool, table string, sourceIDs []uuid.UUID, key func(filename, url string) string) ([]evalChunk, error) {
	rows, err := pool.Query(ctx, fmt.Sprintf(`SELECT c.id, d.filename, d.url, d.title, c.heading_path, c.content, e.embedding
		FROM chunks c JOIN documents d ON d.id = c.document_id JOIN %s e ON e.chunk_id = c.id
		WHERE c.source_id = ANY($1::uuid[]) ORDER BY c.id`, pgx.Identifier{table}.Sanitize()), sourceIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []evalChunk
	for rows.Next() {
		var c evalChunk
		var fn, url, title, content string
		var path []string
		var hv pgvector.HalfVector
		if err := rows.Scan(&c.id, &fn, &url, &title, &path, &content, &hv); err != nil {
			return nil, err
		}
		c.doc = key(fn, url)
		c.embedText = chunk.EmbedText(title, chunk.Chunk{Content: content, HeadingPath: path})
		c.nomic = hv.Slice()
		out = append(out, c)
	}
	return out, rows.Err()
}

func loadFiQA(ctx context.Context, dsn, source, profile, data, nomicQueries string) (*evalSet, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	src := uuid.MustParse(source)
	es := &evalSet{name: "fiqa-10k", pool: pool, sourceIDs: []uuid.UUID{src}, table: "emb_" + strings.ReplaceAll(profile, "-", ""), task: taskFiQA}
	es.chunks, err = loadChunks(ctx, pool, es.table, es.sourceIDs, func(fn, _ string) string { return strings.TrimSuffix(fn, ".txt") })
	if err != nil {
		return nil, err
	}
	qr, err := loadQrels(filepath.Join(data, "qrels", "test.tsv"))
	if err != nil {
		return nil, err
	}
	nv := map[string][]float32{}
	if err := readJSONL(nomicQueries, func(l struct {
		ID     string    `json:"id"`
		Vector []float32 `json:"vector"`
	}) error {
		nv[l.ID] = l.Vector
		return nil
	}); err != nil {
		return nil, err
	}
	err = readJSONL(filepath.Join(data, "queries.jsonl"), func(q struct {
		ID   string `json:"_id"`
		Text string `json:"text"`
	}) error {
		if rel, ok := qr[q.ID]; ok {
			if nv[q.ID] == nil {
				return fmt.Errorf("no nomic vector for query %s", q.ID)
			}
			es.queries = append(es.queries, evalQuery{id: q.ID, text: q.Text, rel: rel, nomic: nv[q.ID]})
		}
		return nil
	})
	return es, err
}

func loadQrels(path string) (map[string]map[string]int, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := map[string]map[string]int{}
	for i, line := range strings.Split(string(raw), "\n") {
		f := strings.Split(strings.TrimSpace(line), "\t")
		if i == 0 || len(f) != 3 {
			continue
		}
		g, err := strconv.Atoi(f[2])
		if err != nil {
			return nil, err
		}
		if out[f[0]] == nil {
			out[f[0]] = map[string]int{}
		}
		out[f[0]][f[1]] = g
	}
	return out, nil
}

// urlQuestion is one line of a URL-judged evaluation set (JSONL), as in
// ragbench urlset: {"id", "question", "urls": [expected page URLs]}.
type urlQuestion struct {
	ID       string   `json:"id"`
	Question string   `json:"question"`
	URLs     []string `json:"urls"`
}

func normURL(u string) string { return strings.TrimRight(strings.TrimSpace(u), "/") }

// urlSetKB is the evaluated dev KB's profile and sources.
type urlSetKB struct {
	id, profile       uuid.UUID
	queryPrefix, name string
	sources           []uuid.UUID
}

func loadURLSetKB(ctx context.Context, pool *pgxpool.Pool, name string) (urlSetKB, error) {
	kb := urlSetKB{name: name}
	if err := pool.QueryRow(ctx, `SELECT kb.id, p.id, p.query_prefix FROM knowledge_bases kb
		JOIN embedding_profiles p ON p.id = kb.embedding_profile_id WHERE kb.name = $1`, name).
		Scan(&kb.id, &kb.profile, &kb.queryPrefix); err != nil {
		return kb, fmt.Errorf("kb %q: %w", name, err)
	}
	rows, err := pool.Query(ctx, "SELECT source_id FROM kb_sources WHERE kb_id = $1", kb.id)
	if err != nil {
		return kb, err
	}
	kb.sources, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	return kb, err
}

func (kb urlSetKB) table() string { return "emb_" + strings.ReplaceAll(kb.profile.String(), "-", "") }

func loadURLQuestions(path string) ([]urlQuestion, error) {
	var qs []urlQuestion
	err := readJSONL(path, func(q urlQuestion) error {
		qs = append(qs, q)
		return nil
	})
	return qs, err
}

// nomicURLSetVectors returns the nomic vectors of the questions: from
// ragbench's cache (ragbench urlset keys them by question text), else
// embedded through the gateway (one request) and cached in sparkbench's cache.
func nomicURLSetVectors(ctx context.Context, ragbenchCache, prefix string, qs []urlQuestion) ([][]float32, error) {
	// ragbench's cache file name: kind "urlset-query" + sha1(model|prefix)[:6].
	p := cachePath(ragbenchCache, "nomic-embed-text-v1.5|"+prefix)
	p = filepath.Join(filepath.Dir(p), "urlset-query-"+strings.TrimPrefix(filepath.Base(p), "emb-"))
	cache, err := readCache(p)
	if err != nil {
		return nil, err
	}
	out := make([][]float32, len(qs))
	var missing []int
	for i, q := range qs {
		if out[i] = cache[q.Question]; out[i] == nil {
			missing = append(missing, i)
		}
	}
	if len(missing) == 0 {
		return out, nil
	}
	nav, err := newEndpoint("gateway-embed", 100)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(missing))
	texts := make([]string, len(missing))
	for j, i := range missing {
		ids[j], texts[j] = qs[i].Question, prefix+qs[i].Question
	}
	vecs, err := cachedEmbed(ctx, nav, "/tmp/sparkbench/cache", "urlset-query|"+prefix, ids, texts, 64, 1)
	if err != nil {
		return nil, err
	}
	for j, i := range missing {
		out[i] = vecs[j]
	}
	return out, nil
}

func loadURLSet(ctx context.Context, dsn, kbName, evalPath, ragbenchCache string) (*evalSet, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	kb, err := loadURLSetKB(ctx, pool, kbName)
	if err != nil {
		return nil, err
	}
	es := &evalSet{name: "urlset", pool: pool, sourceIDs: kb.sources, table: kb.table(), task: taskURLSet}
	es.chunks, err = loadChunks(ctx, pool, es.table, es.sourceIDs, func(fn, u string) string {
		if u != "" {
			return normURL(u)
		}
		return fn
	})
	if err != nil {
		return nil, err
	}
	qs, err := loadURLQuestions(evalPath)
	if err != nil {
		return nil, err
	}
	nv, err := nomicURLSetVectors(ctx, ragbenchCache, kb.queryPrefix, qs)
	if err != nil {
		return nil, err
	}
	docs := map[string]bool{}
	for _, c := range es.chunks {
		docs[c.doc] = true
	}
	for i, q := range qs {
		rel := map[string]int{}
		for _, u := range q.URLs {
			if !docs[normURL(u)] {
				return nil, fmt.Errorf("question %s: %s is not a page of the KB", q.ID, u)
			}
			rel[normURL(u)] = 1
		}
		es.queries = append(es.queries, evalQuery{id: q.ID, text: q.Question, rel: rel, nomic: nv[i]})
	}
	if len(es.queries) == 0 {
		return nil, errors.New("no questions")
	}
	return es, nil
}
