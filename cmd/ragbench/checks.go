package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/systemone"
)

// SystemOne citation checks and the scope check on labelled sets
// (docs/systemone.md §3-§5): accuracy per class, confidence and latency.
// Answers are cached, so threshold sweeps cost no requests.

// s1Flags are the SystemOne connection flags.
type s1Flags struct {
	url, keyEnv, model string
	concurrency        int
	timeout            time.Duration
}

func (f *s1Flags) register(fs *flag.FlagSet) {
	fs.StringVar(&f.url, "systemone-url", os.Getenv("SPARK_SYSTEMONE_URL"), "SystemOne base URL (default $SPARK_SYSTEMONE_URL)")
	fs.StringVar(&f.keyEnv, "systemone-key-env", "SPARK_SYSTEMONE_KEY", "environment variable holding the SystemOne key (never printed)")
	fs.StringVar(&f.model, "systemone-model", envOr("SPARK_SYSTEMONE_MODEL", "openjev-latest"), "SystemOne model")
	fs.IntVar(&f.concurrency, "concurrency", 4, "concurrent SystemOne requests (the connection cap)")
	fs.DurationVar(&f.timeout, "timeout", 60*time.Second, "per-request timeout")
}

func (f s1Flags) client() (*systemone.Client, error) {
	if f.url == "" {
		return nil, errors.New("set -systemone-url or $SPARK_SYSTEMONE_URL")
	}
	return systemone.NewClient(gateway.New(f.url, os.Getenv(f.keyEnv), f.timeout), f.model, uuid.Nil, uuid.New(), f.concurrency), nil
}

// ---- citation checks ---------------------------------------------------------------

// citeItem is one labelled claim of a citation evaluation set (JSONL): the
// claim and the chunk (page URL, ordinal) of the KB it is checked against:
//
//	{"id":"s01","class":"supported","claim":"Transcripts cost $10.","url":"https://registrar.example.edu/transcripts","chunk":4}
type citeItem struct {
	ID    string `json:"id"`
	Class string `json:"class"` // supported, paraphrase, contradicted, unsupported
	Claim string `json:"claim"`
	URL   string `json:"url"`
	Chunk int    `json:"chunk"`
}

// citeResult is one cached check.
type citeResult struct {
	ID         string  `json:"id"`
	Verdict    string  `json:"verdict"`
	Confidence float64 `json:"confidence"`
	LatencyMs  int64   `json:"latencyMs"`
	Error      string  `json:"error,omitempty"`
}

// expectedVerdict is the right verdict for a class.
func expectedVerdict(class string) string {
	switch class {
	case "contradicted":
		return systemone.Contradicted
	case "unsupported":
		return systemone.Unsupported
	}
	return systemone.Verified
}

func cmdCitations(args []string) error {
	fs := flag.NewFlagSet("citations", flag.ExitOnError)
	var s1 s1Flags
	s1.register(fs)
	evalPath := fs.String("eval", "", "labelled claims (JSONL {id, class, claim, url, chunk}; required)")
	dsn := fs.String("dsn", "", "Grounded database with the pages (read-only)")
	kb := fs.String("kb", "", "knowledge base ID holding the pages")
	cache := fs.String("cache", "/tmp/ragbench/citations.jsonl", "results cache")
	burst := fs.Bool("burst", false, "also check every claim at once (the connection cap queues them) and report the wall time")
	_ = fs.Parse(args)
	if *evalPath == "" {
		return errors.New("-eval is required: a JSONL file of {id, class, claim, url, chunk}")
	}
	var items []citeItem
	if err := readJSONL(*evalPath, func(it citeItem) error { items = append(items, it); return nil }); err != nil {
		return err
	}
	ctx := context.Background()
	sources, err := citeSources(ctx, *dsn, *kb, items)
	if err != nil {
		return err
	}
	cl, err := s1.client()
	if err != nil {
		return err
	}
	results, err := runCitations(ctx, cl, items, sources, *cache)
	if err != nil {
		return err
	}
	reportCitations(items, results)
	if *burst {
		pairs := make([]systemone.ClaimPair, len(items))
		for i, it := range items {
			pairs[i] = systemone.ClaimPair{Claim: it.Claim, Source: sources[it.ID]}
		}
		_, st := cl.CheckClaims(ctx, pairs, s1.timeout)
		fmt.Printf("\nburst: %d claims at once (cap %d): %.1f s wall, %.2f s per claim\n", len(pairs), s1.concurrency,
			st.Latency.Seconds(), st.Latency.Seconds()/float64(len(pairs)))
	}
	return nil
}

// citeSources reads each item's chunk as the chat pipeline gives it to the
// check: the page title, a blank line and the chunk.
func citeSources(ctx context.Context, dsn, kb string, items []citeItem) (map[string]string, error) {
	if dsn == "" || kb == "" {
		return nil, errors.New("set -dsn and -kb")
	}
	pool, err := openPool(ctx, dsn)
	if err != nil {
		return nil, err
	}
	defer pool.Close()
	out := map[string]string{}
	for _, it := range items {
		var title, content string
		err := pool.QueryRow(ctx, `SELECT d.title, c.content FROM chunks c JOIN documents d ON d.id = c.document_id
			JOIN kb_sources k ON k.source_id = d.source_id
			WHERE k.kb_id = $1 AND d.url = $2 AND c.ordinal = $3 AND d.status = 'ready'`, kb, it.URL, it.Chunk).Scan(&title, &content)
		if err != nil {
			return nil, fmt.Errorf("%s: chunk %d of %s: %w", it.ID, it.Chunk, it.URL, err)
		}
		out[it.ID] = strings.TrimSpace(title) + "\n\n" + content
	}
	return out, nil
}

// runCitations checks each claim once, one at a time (so latency is one
// request's), appending new results to the cache.
func runCitations(ctx context.Context, cl *systemone.Client, items []citeItem, sources map[string]string, path string) ([]citeResult, error) {
	cached := map[string]citeResult{}
	_ = readJSONL(path, func(r citeResult) error { cached[r.ID] = r; return nil })
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := make([]citeResult, len(items))
	for i, it := range items {
		if r, ok := cached[it.ID]; ok && r.Error == "" {
			out[i] = r
			continue
		}
		start := time.Now()
		vs, _ := cl.CheckClaims(ctx, []systemone.ClaimPair{{Claim: it.Claim, Source: sources[it.ID]}}, 0)
		r := citeResult{ID: it.ID, Verdict: vs[0].Verification, Confidence: vs[0].Confidence, LatencyMs: time.Since(start).Milliseconds()}
		if vs[0].Err != nil {
			r.Error = vs[0].Err.Error()
		}
		out[i] = r
		if err := appendJSONL(f, r); err != nil {
			return nil, err
		}
		fmt.Fprintf(os.Stderr, "%s %-12s -> %-12s %.2f (%d ms)\n", it.ID, it.Class, r.Verdict, r.Confidence, r.LatencyMs)
	}
	return out, nil
}

func reportCitations(items []citeItem, rs []citeResult) {
	classes := []string{"supported", "paraphrase", "contradicted", "unsupported"}
	fmt.Println("| class | claims | right | confident (>= 0.8) | right when confident | confidence min / median / max | verdicts |")
	fmt.Println("|---|---:|---:|---:|---:|---|---|")
	var lat []float64
	for _, c := range classes {
		var n, right, conf, confRight int
		var confs []float64
		verdicts := map[string]int{}
		for i, it := range items {
			if it.Class != c {
				continue
			}
			r := rs[i]
			n++
			verdicts[r.Verdict]++
			confs = append(confs, r.Confidence)
			ok := r.Verdict == expectedVerdict(c)
			if ok {
				right++
			}
			if r.Confidence >= 0.8 {
				conf++
				if ok {
					confRight++
				}
			}
		}
		sort.Float64s(confs)
		fmt.Printf("| %s | %d | %d (%.0f%%) | %d | %d / %d | %.2f / %.2f / %.2f | %s |\n", c, n, right, 100*share(right, n), conf, confRight, conf,
			confs[0], pct(confs, 50), confs[len(confs)-1], countsString(verdicts))
	}
	for _, r := range rs {
		lat = append(lat, float64(r.LatencyMs))
	}
	sort.Float64s(lat)
	fmt.Printf("\nlatency per claim (one at a time): p50 %.0f ms, p95 %.0f ms, max %.0f ms\n", pct(lat, 50), pct(lat, 95), lat[len(lat)-1])
	enforceSweep(items, rs)
}

// enforceSweep: what enforce would do at each auto-accept threshold.
func enforceSweep(items []citeItem, rs []citeResult) {
	fmt.Println("\n| auto-accept | supported/paraphrase markers wrongly removed | unsupported/contradicted markers removed |")
	fmt.Println("|---:|---:|---:|")
	for _, t := range []float64{0.5, 0.6, 0.7, 0.8, 0.9} {
		var good, goodN, bad, badN int
		for i, it := range items {
			neg := rs[i].Verdict != systemone.Verified && rs[i].Verdict != systemone.Unchecked && rs[i].Confidence >= t
			if expectedVerdict(it.Class) == systemone.Verified {
				goodN++
				if neg {
					good++
				}
			} else {
				badN++
				if neg {
					bad++
				}
			}
		}
		fmt.Printf("| %.1f | %d / %d | %d / %d |\n", t, good, goodN, bad, badN)
	}
}

func countsString(m map[string]int) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	for i, k := range keys {
		parts[i] = fmt.Sprintf("%s %d", k, m[k])
	}
	return strings.Join(parts, ", ")
}

// appendJSONL writes v as one line.
func appendJSONL(f *os.File, v any) error {
	b, _ := json.Marshal(v)
	_, err := f.Write(append(b, '\n'))
	return err
}
