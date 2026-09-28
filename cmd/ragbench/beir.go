package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// BEIR layout: corpus.jsonl, queries.jsonl, qrels/<split>.tsv.
type beirDoc struct {
	ID    string `json:"_id"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

type beirQuery struct {
	ID   string `json:"_id"`
	Text string `json:"text"`
}

// qrels maps query ID -> doc ID -> graded relevance.
type qrels map[string]map[string]int

func readJSONL[T any](path string, fn func(T) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		var v T
		if err := json.Unmarshal(sc.Bytes(), &v); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		if err := fn(v); err != nil {
			return err
		}
	}
	return sc.Err()
}

func loadCorpus(dir string) ([]beirDoc, error) {
	var docs []beirDoc
	err := readJSONL(filepath.Join(dir, "corpus.jsonl"), func(d beirDoc) error {
		docs = append(docs, d)
		return nil
	})
	return docs, err
}

func loadQrels(dir, split string) (qrels, error) {
	f, err := os.Open(filepath.Join(dir, "qrels", split+".tsv"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	q := qrels{}
	sc := bufio.NewScanner(f)
	first := true
	for sc.Scan() {
		parts := strings.Split(sc.Text(), "\t")
		if first {
			first = false
			if len(parts) > 0 && parts[0] == "query-id" {
				continue
			}
		}
		if len(parts) < 3 {
			continue
		}
		score, err := strconv.Atoi(strings.TrimSpace(parts[2]))
		if err != nil {
			return nil, fmt.Errorf("qrels: %q: %w", sc.Text(), err)
		}
		if q[parts[0]] == nil {
			q[parts[0]] = map[string]int{}
		}
		q[parts[0]][parts[1]] = score
	}
	return q, sc.Err()
}

// loadQueries returns the queries that have judgments in qr, sorted by ID.
func loadQueries(dir string, qr qrels) ([]beirQuery, error) {
	var out []beirQuery
	err := readJSONL(filepath.Join(dir, "queries.jsonl"), func(q beirQuery) error {
		if _, ok := qr[q.ID]; ok {
			out = append(out, q)
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, err
}

// docText is what gets uploaded or embedded for a corpus entry.
func docText(d beirDoc) string {
	if t := strings.TrimSpace(d.Title); t != "" {
		return t + "\n\n" + d.Text
	}
	return d.Text
}

// selectDocs drops empty entries and, when max > 0, keeps every document
// judged in qr plus seeded random distractors up to max documents.
func selectDocs(docs []beirDoc, qr qrels, max int) (kept []beirDoc, empty int) {
	nonEmpty := docs[:0:0]
	for _, d := range docs {
		if strings.TrimSpace(docText(d)) == "" {
			empty++
			continue
		}
		nonEmpty = append(nonEmpty, d)
	}
	if max <= 0 || max >= len(nonEmpty) {
		return nonEmpty, empty
	}
	judged := map[string]bool{}
	for _, rel := range qr {
		for id := range rel {
			judged[id] = true
		}
	}
	var others []beirDoc
	for _, d := range nonEmpty {
		if judged[d.ID] {
			kept = append(kept, d)
		} else {
			others = append(others, d)
		}
	}
	rng := rand.New(rand.NewPCG(1, 2))
	rng.Shuffle(len(others), func(i, j int) { others[i], others[j] = others[j], others[i] })
	for _, d := range others {
		if len(kept) >= max {
			break
		}
		kept = append(kept, d)
	}
	return kept, empty
}

// Filenames carry the BEIR doc ID so citations map back to judgments.
func docFilename(id string) string { return id + ".txt" }

func docIDFromFilename(name string) string { return strings.TrimSuffix(name, ".txt") }

// dedupe keeps the first occurrence of each doc ID (several chunks of one
// document can be retrieved), preserving rank order.
func dedupe(ids []string) []string {
	seen := map[string]bool{}
	out := ids[:0:0]
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

// metrics are BEIR/pytrec_eval-style: recall@k = |rel ∩ top k| / |rel|,
// nDCG@k with gain = relevance grade and log2(rank+1) discount.
type metrics struct{ recall, ndcg, mrr float64 }

func score(ranked []string, rel map[string]int, k int) metrics {
	if len(ranked) > k {
		ranked = ranked[:k]
	}
	nRel := 0
	var grades []int
	for _, g := range rel {
		if g > 0 {
			nRel++
			grades = append(grades, g)
		}
	}
	if nRel == 0 {
		return metrics{}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(grades)))
	var m metrics
	var dcg, idcg float64
	hits := 0
	for i, id := range ranked {
		if g := rel[id]; g > 0 {
			hits++
			dcg += float64(g) / math.Log2(float64(i+2))
			if m.mrr == 0 {
				m.mrr = 1 / float64(i+1)
			}
		}
	}
	for i := 0; i < min(k, len(grades)); i++ {
		idcg += float64(grades[i]) / math.Log2(float64(i+2))
	}
	m.recall = float64(hits) / float64(nRel)
	m.ndcg = dcg / idcg
	return m
}

type summary struct {
	n                 int
	recall, ndcg, mrr float64
}

func (s *summary) add(m metrics) {
	s.n++
	s.recall += m.recall
	s.ndcg += m.ndcg
	s.mrr += m.mrr
}

func (s summary) String() string {
	if s.n == 0 {
		return "no queries"
	}
	n := float64(s.n)
	return fmt.Sprintf("queries=%d recall=%.4f nDCG=%.4f MRR=%.4f", s.n, s.recall/n, s.ndcg/n, s.mrr/n)
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
