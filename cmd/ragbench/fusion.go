package main

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	pgvector "github.com/pgvector/pgvector-go"
)

// lexicalSQL is Grounded's full-text query before fusion tuning (OR of the
// question's stemmed lexemes, ranked by ts_rank_cd), returning filenames
// too. It is kept to reproduce the first scale-10k measurements; "ragbench
// sweep" measures the application's current query (kbs.LexicalSQL).
const lexicalSQL = `
WITH q AS (
    SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS query
    FROM unnest(to_tsvector('english', $1))
)
SELECT c.id::text, d.filename FROM chunks c JOIN documents d ON d.id = c.document_id, q
WHERE q.query IS NOT NULL AND c.source_id = $2 AND c.content_tsv @@ q.query
ORDER BY ts_rank_cd(c.content_tsv, q.query, 1) DESC, c.id
LIMIT $3`

type cand struct{ chunk, doc string }

func denseCands(ctx context.Context, pool *pgxpool.Pool, table, sourceID string, q []float32, limit int) ([]cand, error) {
	var out []cand
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SET LOCAL enable_indexscan = off"); err != nil {
			return err
		}
		sql := fmt.Sprintf(`SELECT e.chunk_id::text, d.filename FROM (
			SELECT chunk_id, embedding <=> $1::halfvec(%d) AS dist FROM %s
			WHERE source_id = $2 ORDER BY dist LIMIT $3) e
			JOIN chunks c ON c.id = e.chunk_id JOIN documents d ON d.id = c.document_id
			ORDER BY e.dist`, len(q), pgx.Identifier{table}.Sanitize())
		rows, err := tx.Query(ctx, sql, pgvector.NewHalfVector(q).String(), sourceID, limit)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (cand, error) {
			var c cand
			err := r.Scan(&c.chunk, &c.doc)
			c.doc = docIDFromFilename(c.doc)
			return c, err
		})
		return err
	})
	return out, err
}

func lexicalCands(ctx context.Context, pool *pgxpool.Pool, text, sourceID string, limit int) ([]cand, error) {
	rows, err := pool.Query(ctx, lexicalSQL, text, sourceID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (cand, error) {
		var c cand
		err := r.Scan(&c.chunk, &c.doc)
		c.doc = docIDFromFilename(c.doc)
		return c, err
	})
}

// fuse applies reciprocal rank fusion (k=60) with a weight on the lexical
// list. lexFirst breaks score ties on the lexical rank, as Grounded does.
func fuse(dense, lex []cand, wLex float64, lexFirst bool, k int) []string {
	type f struct {
		c          cand
		score      float64
		vRank, lRk int
	}
	m := map[string]*f{}
	get := func(c cand) *f {
		if x, ok := m[c.chunk]; ok {
			return x
		}
		x := &f{c: c}
		m[c.chunk] = x
		return x
	}
	for i, c := range dense {
		x := get(c)
		x.vRank = i + 1
		x.score += 1 / float64(60+i+1)
	}
	for i, c := range lex {
		x := get(c)
		x.lRk = i + 1
		x.score += wLex / float64(60+i+1)
	}
	all := make([]*f, 0, len(m))
	for _, x := range m {
		all = append(all, x)
	}
	last := func(r int) int {
		if r == 0 {
			return 1 << 30
		}
		return r
	}
	sort.Slice(all, func(i, j int) bool {
		a, b := all[i], all[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if lexFirst && a.lRk != b.lRk {
			return last(a.lRk) < last(b.lRk)
		}
		if a.vRank != b.vRank {
			return last(a.vRank) < last(b.vRank)
		}
		if a.lRk != b.lRk {
			return last(a.lRk) < last(b.lRk)
		}
		return a.c.chunk < b.c.chunk
	})
	if len(all) > k {
		all = all[:k] // Grounded trims to topK chunks, then cites documents
	}
	docs := make([]string, len(all))
	for i, x := range all {
		docs[i] = x.c.doc
	}
	return dedupe(docs)
}

func docsOf(cs []cand, k int) []string {
	if len(cs) > k {
		cs = cs[:k]
	}
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = c.doc
	}
	return dedupe(out)
}

// fusionReport compares dense-only, lexical-only and several fusion
// settings on the same candidates Grounded would fetch (4 x k from each side).
func fusionReport(ctx context.Context, pool *pgxpool.Pool, table, sourceID string, queries []beirQuery, vecs [][]float32, qr qrels, k int) error {
	type variant struct {
		name     string
		wLex     float64
		lexFirst bool
	}
	variants := []variant{
		{"RRF, equal weights, lexical tie-break (Grounded today)", 1, true},
		{"RRF, equal weights, vector tie-break", 1, false},
		{"RRF, lexical weight 0.5", 0.5, false},
		{"RRF, lexical weight 0.25", 0.25, false},
	}
	sums := make([]summary, len(variants))
	var dense, lexical summary
	var dLat, lLat []float64
	cands := max(k*4, 20)
	for i, q := range queries {
		t0 := time.Now()
		d, err := denseCands(ctx, pool, table, sourceID, vecs[i], cands)
		if err != nil {
			return err
		}
		dLat = append(dLat, float64(time.Since(t0).Microseconds())/1000)
		t0 = time.Now()
		l, err := lexicalCands(ctx, pool, q.Text, sourceID, cands)
		if err != nil {
			return err
		}
		lLat = append(lLat, float64(time.Since(t0).Microseconds())/1000)
		dense.add(score(docsOf(d, k), qr[q.ID], k))
		lexical.add(score(docsOf(l, k), qr[q.ID], k))
		for j, v := range variants {
			sums[j].add(score(fuse(d, l, v.wLex, v.lexFirst, k), qr[q.ID], k))
		}
	}
	fmt.Printf("\n| ranking | recall@%d | nDCG@%d | MRR@%d |\n|---|---:|---:|---:|\n", k, k, k)
	row := func(name string, s summary) {
		n := float64(max(s.n, 1))
		fmt.Printf("| %s | %.3f | %.3f | %.3f |\n", name, s.recall/n, s.ndcg/n, s.mrr/n)
	}
	row("dense only (exact)", dense)
	row("lexical only (Grounded full-text query)", lexical)
	for j, v := range variants {
		row(v.name, sums[j])
	}
	fmt.Printf("\ncandidate queries: dense exact p50=%.1fms p95=%.1fms; lexical p50=%.1fms p95=%.1fms p99=%.1fms\n",
		pct(dLat, 50), pct(dLat, 95), pct(lLat, 50), pct(lLat, 95), pct(lLat, 99))
	return nil
}
