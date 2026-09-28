package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"runtime"
	"sort"
	"sync"
)

// metrics are BEIR/pytrec_eval-style, as in ragbench: recall@k = |rel ∩ top
// k| / |rel|, nDCG@k with gain = grade and log2(rank+1) discount, MRR@k.
type metrics struct{ recall, ndcg, mrr float64 }

func score(ranked []string, rel map[string]int, k int) metrics {
	if len(ranked) > k {
		ranked = ranked[:k]
	}
	var grades []int
	for _, g := range rel {
		if g > 0 {
			grades = append(grades, g)
		}
	}
	if len(grades) == 0 {
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
	for i, g := range grades {
		if i >= k {
			break
		}
		idcg += float64(g) / math.Log2(float64(i+2))
	}
	m.recall = float64(hits) / float64(len(grades))
	if idcg > 0 {
		m.ndcg = dcg / idcg
	}
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

// cells formats nDCG / recall / MRR for a markdown table.
func (s summary) cells() string {
	n := float64(max(s.n, 1))
	return fmt.Sprintf("%.3f | %.3f | %.3f", s.ndcg/n, s.recall/n, s.mrr/n)
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

func mean(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	var t float64
	for _, x := range xs {
		t += x
	}
	return t / float64(len(xs))
}

// dedupe keeps the first occurrence of each document key, in rank order.
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

// prepare truncates a vector to dims (Matryoshka; 0 = keep), normalizes it
// and rounds it through float16 like Grounded's halfvec storage.
func prepare(v []float32, dims int, half bool) []float32 {
	out := append([]float32(nil), v...)
	if dims > 0 && dims < len(out) {
		out = out[:dims]
	}
	normalize(out)
	if half {
		for i, x := range out {
			out[i] = roundHalf(x)
		}
	}
	return out
}

// roundHalf rounds a float32 to the nearest IEEE 754 half-precision value
// (round to nearest even), as a halfvec cast does.
func roundHalf(f float32) float32 {
	if f == 0 || math.IsNaN(float64(f)) || math.IsInf(float64(f), 0) {
		return f
	}
	a := math.Abs(float64(f))
	if a >= 65520 {
		return float32(math.Copysign(math.Inf(1), float64(f)))
	}
	e := math.Floor(math.Log2(a))
	if e < -14 {
		e = -14 // subnormals share the smallest exponent
	}
	q := math.Ldexp(1, int(e)-10) // spacing of halves at this exponent
	r := math.RoundToEven(a/q) * q
	return float32(math.Copysign(r, float64(f)))
}

// scored is one candidate of an exact search.
type scored struct {
	i   int
	sim float32
}

// searchAll returns each query's top k corpus indices by cosine similarity
// (vectors already normalized), on all CPUs.
func searchAll(queries, corpus [][]float32, k int) [][]scored {
	out := make([][]scored, len(queries))
	var wg sync.WaitGroup
	next := make(chan int)
	for w := 0; w < runtime.NumCPU(); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for qi := range next {
				out[qi] = topK(queries[qi], corpus, k)
			}
		}()
	}
	for i := range queries {
		next <- i
	}
	close(next)
	wg.Wait()
	return out
}

func topK(q []float32, corpus [][]float32, k int) []scored {
	best := make([]scored, 0, k+1)
	for i, d := range corpus {
		var s float32
		for j := range q {
			s += q[j] * d[j]
		}
		if len(best) == k && s <= best[k-1].sim {
			continue
		}
		pos := sort.Search(len(best), func(x int) bool { return best[x].sim < s })
		best = append(best, scored{})
		copy(best[pos+1:], best[pos:])
		best[pos] = scored{i, s}
		if len(best) > k {
			best = best[:k]
		}
	}
	return best
}

func readJSONL[T any](path string, fn func(T) error) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		if len(sc.Bytes()) == 0 {
			continue
		}
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
