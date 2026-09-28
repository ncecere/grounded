package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"time"
)

func cmdEmbedProbe(args []string) error {
	fs := flag.NewFlagSet("embed-probe", flag.ExitOnError)
	name := fs.String("endpoint", "spark-embed", "endpoint: spark-embed or gateway-embed")
	rpm := fs.Int("rpm", 0, "pace requests (use <= 100 for a 120/min gateway key)")
	data := fs.String("data", "/tmp/ragbench/fiqa", "BEIR dataset whose corpus supplies realistic texts")
	n := fs.Int("n", 1024, "texts per throughput setting")
	batches := fs.String("batches", "32,64", "batch sizes to measure")
	concs := fs.String("concurrency", "1,4", "concurrency levels to measure (the Spark is one machine: at most 4)")
	singles := fs.Int("singles", 20, "sequential single-query requests for latency")
	maxInput := fs.String("max-input", "8000,32000,40000", "approximate token lengths to try as one input (empty = skip)")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: sparkbench embed-probe [flags]\n\nChecks an embedding endpoint: dimensions and norm, whether the OpenAI\n\"dimensions\" parameter (Matryoshka) is accepted, the longest accepted input,\nsingle-query latency and batch throughput (texts/s, tokens/s).")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	ctx := context.Background()
	e, err := newEndpoint(*name, *rpm)
	if err != nil {
		return err
	}
	if err := probeBasics(ctx, e); err != nil {
		return err
	}
	probeMaxInput(ctx, e, *maxInput)
	if err := probeLatency(ctx, e, *singles); err != nil {
		return err
	}
	bs, err := parseInts(*batches)
	if err != nil {
		return err
	}
	cs, err := parseInts(*concs)
	if err != nil {
		return err
	}
	return probeThroughput(ctx, e, *data, *n, bs, cs)
}

// probeBasics reports dimensions, norm and Matryoshka support.
func probeBasics(ctx context.Context, e *endpoint) error {
	r, err := e.embed(ctx, []string{"What is the add/drop deadline?"}, nil)
	if err != nil {
		return err
	}
	var norm float64
	for _, x := range r.vecs[0] {
		norm += float64(x) * float64(x)
	}
	fmt.Printf("model %s: %d dims, L2 norm %.4f, %d tokens for a 7-word query\n", e.model, len(r.vecs[0]), math.Sqrt(norm), r.tokens)
	for _, d := range []int{1024, 768} {
		r, err := e.embed(ctx, []string{"hello"}, map[string]any{"dimensions": d})
		if err != nil {
			fmt.Printf("dimensions=%d: rejected: %v\n", d, err)
		} else {
			fmt.Printf("dimensions=%d: accepted, got %d dims\n", d, len(r.vecs[0]))
		}
	}
	return nil
}

// probeMaxInput tries single inputs of about the listed token counts.
func probeMaxInput(ctx context.Context, e *endpoint, list string) {
	for _, f := range strings.Split(list, ",") {
		var toks int
		if _, err := fmt.Sscan(strings.TrimSpace(f), &toks); err != nil || toks <= 0 {
			continue
		}
		// "registrar " is about one token; the reply reports the real count.
		text := strings.Repeat("registrar ", toks)
		t0 := time.Now()
		r, err := e.embed(ctx, []string{text}, nil)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) {
				err = fmt.Errorf("HTTP %d: %s", he.Status, truncate(he.Body, 240))
			}
			fmt.Printf("input ~%d tokens: rejected: %v\n", toks, err)
		} else {
			fmt.Printf("input ~%d tokens: accepted (%d tokens counted, %s)\n", toks, r.tokens, time.Since(t0).Round(time.Millisecond))
		}
	}
}

// probeLatency times sequential single-query requests.
func probeLatency(ctx context.Context, e *endpoint, n int) error {
	var lat []float64
	for i := 0; i < n; i++ {
		t0 := time.Now()
		if _, err := e.embed(ctx, []string{fmt.Sprintf("Query %d: how do I request an official transcript?", i)}, nil); err != nil {
			return err
		}
		lat = append(lat, float64(time.Since(t0).Microseconds())/1000)
	}
	if len(lat) > 0 {
		fmt.Printf("single query: p50 %.0f ms, p95 %.0f ms, max %.0f ms (n=%d)\n", pct(lat, 50), pct(lat, 95), pct(lat, 100), len(lat))
	}
	return nil
}

// probeThroughput embeds fresh corpus texts at each batch size and
// concurrency.
func probeThroughput(ctx context.Context, e *endpoint, data string, n int, bs, cs []int) error {
	var corpus []string
	if err := readJSONL(filepath.Join(data, "corpus.jsonl"), func(d struct {
		Title string `json:"title"`
		Text  string `json:"text"`
	}) error {
		if t := strings.TrimSpace(d.Title + "\n" + d.Text); len(t) > 20 {
			corpus = append(corpus, truncate(t, 4000))
		}
		return nil
	}); err != nil {
		return err
	}
	if len(corpus) < n*len(bs)*len(cs) {
		return fmt.Errorf("corpus has %d texts, need %d", len(corpus), n*len(bs)*len(cs))
	}
	fmt.Printf("\n| batch | concurrency | texts | seconds | texts/s | tokens/s | tokens/text |\n|---:|---:|---:|---:|---:|---:|---:|\n")
	off := 0
	for _, b := range bs {
		for _, c := range cs {
			texts := corpus[off : off+n] // fresh texts each run (no cache effects)
			off += n
			t0 := time.Now()
			_, toks, err := e.embedAll(ctx, texts, b, c)
			if err != nil {
				return err
			}
			sec := time.Since(t0).Seconds()
			fmt.Printf("| %d | %d | %d | %.1f | %.1f | %.0f | %.0f |\n", b, c, len(texts), sec, float64(len(texts))/sec, float64(toks)/sec, float64(toks)/float64(len(texts)))
		}
	}
	return nil
}
