package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// gatewayFlags configure direct calls to the OpenAI-compatible model proxy.
type gatewayFlags struct {
	url, keyEnv, model string
	batch, concurrency int
}

func (g *gatewayFlags) register(fs *flag.FlagSet) {
	fs.StringVar(&g.url, "gateway-url", os.Getenv("URL"), "OpenAI-compatible base URL; /v1 is appended when missing (default $URL)")
	fs.StringVar(&g.keyEnv, "key-env", "KEY", "environment variable holding the gateway API key (never printed)")
	fs.StringVar(&g.model, "model", envOr("EMBEDDING_MODEL", "nomic-embed-text-v1.5"), "embedding model ID (default $EMBEDDING_MODEL)")
	fs.IntVar(&g.batch, "batch", 64, "inputs per embedding request")
	fs.IntVar(&g.concurrency, "concurrency", 4, "concurrent embedding requests (be polite: at most 4)")
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// baseV1 returns the proxy URL with a /v1 suffix.
func baseV1(u string) string {
	u = strings.TrimRight(u, "/")
	if !strings.HasSuffix(u, "/v1") {
		u += "/v1"
	}
	return u
}

type embedder struct {
	url, key, model string
	http            *http.Client
	tokens          int64
	mu              sync.Mutex
}

func (g gatewayFlags) embedder() (*embedder, error) {
	if g.url == "" {
		return nil, errors.New("set -gateway-url or $URL")
	}
	key := os.Getenv(g.keyEnv)
	if key == "" {
		return nil, fmt.Errorf("$%s is empty", g.keyEnv)
	}
	return &embedder{url: baseV1(g.url), key: key, model: g.model, http: &http.Client{Timeout: 5 * time.Minute}}, nil
}

// embed sends one request, retrying 429 and 5xx with exponential backoff
// (honouring Retry-After).
func (e *embedder) embed(ctx context.Context, inputs []string) ([][]float32, error) {
	body, _ := json.Marshal(map[string]any{"model": e.model, "input": inputs})
	delay := 2 * time.Second
	for attempt := 1; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "POST", e.url+"/embeddings", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+e.key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := e.http.Do(req)
		var raw []byte
		status := 0
		if err == nil {
			raw, err = io.ReadAll(resp.Body)
			resp.Body.Close()
			status = resp.StatusCode
		}
		retryable := err != nil || status == 429 || status >= 500
		if !retryable && status >= 300 {
			return nil, fmt.Errorf("embeddings: HTTP %d: %s", status, truncate(string(raw), 300))
		}
		if !retryable {
			var out struct {
				Data []struct {
					Index     int       `json:"index"`
					Embedding []float32 `json:"embedding"`
				} `json:"data"`
				Usage struct {
					TotalTokens int64 `json:"total_tokens"`
				} `json:"usage"`
			}
			if err := json.Unmarshal(raw, &out); err != nil {
				return nil, fmt.Errorf("embeddings: %w", err)
			}
			if len(out.Data) != len(inputs) {
				return nil, fmt.Errorf("embeddings: got %d vectors for %d inputs", len(out.Data), len(inputs))
			}
			vecs := make([][]float32, len(inputs))
			for _, d := range out.Data {
				vecs[d.Index] = d.Embedding
			}
			e.mu.Lock()
			e.tokens += out.Usage.TotalTokens
			e.mu.Unlock()
			return vecs, nil
		}
		if attempt >= 8 {
			if err == nil {
				err = fmt.Errorf("HTTP %d", status)
			}
			return nil, fmt.Errorf("embeddings: giving up after %d attempts: %w", attempt, err)
		}
		wait := delay
		if resp != nil {
			if s, perr := strconv.Atoi(resp.Header.Get("Retry-After")); perr == nil && s > 0 {
				wait = time.Duration(s) * time.Second
			}
		}
		log.Printf("embeddings: attempt %d failed (status %d, err %v); retrying in %s", attempt, status, err, wait)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
		delay = min(delay*2, time.Minute)
	}
}

// embedAll embeds texts in batches with bounded concurrency.
func (e *embedder) embedAll(ctx context.Context, texts []string, batch, concurrency int, progress string) ([][]float32, error) {
	out := make([][]float32, len(texts))
	type job struct{ start, end int }
	jobs := make(chan job)
	errc := make(chan error, concurrency)
	var wg sync.WaitGroup
	var done int
	var mu sync.Mutex
	start := time.Now()
	for w := 0; w < max(concurrency, 1); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				vecs, err := e.embed(ctx, texts[j.start:j.end])
				if err != nil {
					errc <- err
					return
				}
				copy(out[j.start:j.end], vecs)
				mu.Lock()
				done += j.end - j.start
				if progress != "" && (done/batch)%50 == 0 {
					el := time.Since(start).Seconds()
					log.Printf("%s: %d/%d embedded (%.0f/s)", progress, done, len(texts), float64(done)/el)
				}
				mu.Unlock()
			}
		}()
	}
	var err error
feed:
	for s := 0; s < len(texts); s += batch {
		select {
		case jobs <- job{s, min(s+batch, len(texts))}:
		case err = <-errc:
			break feed
		}
	}
	close(jobs)
	wg.Wait()
	if err == nil {
		select {
		case err = <-errc:
		default:
		}
	}
	return out, err
}
