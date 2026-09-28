package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// endpoint is one OpenAI-compatible service. The key stays in the struct and
// is only ever sent in the Authorization header.
type endpoint struct {
	name, url, key, model string
	pace                  *pacer
	http                  *http.Client
}

// endpointEnv names the environment variables of each named endpoint.
var endpointEnv = map[string][3]string{
	"gateway-embed": {"URL", "KEY", "EMBEDDING_MODEL"},
	"gateway-chat":  {"URL", "KEY", "LLM_MODEL"},
	"spark-embed":   {"SPARK_EMBEDDING_URL", "SPARK_EMBEDDING_KEY", "SPARK_EMBEDDING_MODEL"},
	"spark-chat":    {"SPARK_LLM_URL", "SPARK_LLM_KEY", "SPARK_LLM_MODEL"},
	"systemone":     {"SPARK_SYSTEMONE_URL", "SPARK_SYSTEMONE_KEY", "SPARK_SYSTEMONE_MODEL"},
}

// newEndpoint resolves a named endpoint. rpm > 0 paces requests (the
// benchmark gateway allowed 120 per minute per key).
func newEndpoint(name string, rpm int) (*endpoint, error) {
	env, ok := endpointEnv[name]
	if !ok {
		return nil, fmt.Errorf("unknown endpoint %q", name)
	}
	e := &endpoint{name: name, url: os.Getenv(env[0]), key: os.Getenv(env[1]), model: os.Getenv(env[2]),
		http: &http.Client{Timeout: 15 * time.Minute}}
	if e.url == "" || e.key == "" || e.model == "" {
		return nil, fmt.Errorf("%s: set $%s, $%s and $%s (source ai.env)", name, env[0], env[1], env[2])
	}
	e.url = strings.TrimRight(e.url, "/")
	if !strings.HasSuffix(e.url, "/v1") {
		e.url += "/v1"
	}
	if rpm > 0 {
		e.pace = &pacer{interval: time.Minute / time.Duration(rpm)}
	}
	return e, nil
}

// pacer spaces requests at least interval apart.
type pacer struct {
	mu       sync.Mutex
	interval time.Duration
	next     time.Time
}

func (p *pacer) wait(ctx context.Context) error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	now := time.Now()
	at := p.next
	if at.Before(now) {
		at = now
	}
	p.next = at.Add(p.interval)
	p.mu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(time.Until(at)):
		return nil
	}
}

// post sends a JSON request and returns the response (the caller closes the
// body). 429 and 5xx are retried with backoff, honouring Retry-After.
func (e *endpoint) post(ctx context.Context, path string, body any) (*http.Response, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	delay := 2 * time.Second
	for attempt := 1; ; attempt++ {
		if err := e.pace.wait(ctx); err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, "POST", e.url+path, bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+e.key)
		req.Header.Set("Content-Type", "application/json")
		resp, err := e.http.Do(req)
		if err == nil && resp.StatusCode < 300 {
			return resp, nil
		}
		status := 0
		var msg string
		if err == nil {
			status = resp.StatusCode
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 2000))
			resp.Body.Close()
			msg = string(b)
		}
		if err == nil && status != 429 && status < 500 {
			return nil, &httpError{status, msg}
		}
		if attempt >= 6 {
			if err == nil {
				err = &httpError{status, msg}
			}
			return nil, fmt.Errorf("%s%s: giving up after %d attempts: %w", e.name, path, attempt, err)
		}
		wait := delay
		if resp != nil {
			if s, perr := strconv.Atoi(resp.Header.Get("Retry-After")); perr == nil && s > 0 {
				wait = time.Duration(s) * time.Second
			}
		}
		log.Printf("%s%s: attempt %d failed (status %d, err %v); retrying in %s", e.name, path, attempt, status, err, wait)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
		delay = min(delay*2, time.Minute)
	}
}

type httpError struct {
	Status int
	Body   string
}

func (h *httpError) Error() string {
	return fmt.Sprintf("HTTP %d: %s", h.Status, truncate(h.Body, 400))
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// embedResult is one /embeddings response.
type embedResult struct {
	vecs   [][]float32
	tokens int
}

func (e *endpoint) embed(ctx context.Context, inputs []string, extra map[string]any) (embedResult, error) {
	body := map[string]any{"model": e.model, "input": inputs}
	for k, v := range extra {
		body[k] = v
	}
	resp, err := e.post(ctx, "/embeddings", body)
	if err != nil {
		return embedResult{}, err
	}
	defer resp.Body.Close()
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
		Usage struct {
			PromptTokens int `json:"prompt_tokens"`
			TotalTokens  int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return embedResult{}, fmt.Errorf("embeddings: %w", err)
	}
	if len(out.Data) != len(inputs) {
		return embedResult{}, fmt.Errorf("embeddings: got %d vectors for %d inputs", len(out.Data), len(inputs))
	}
	r := embedResult{vecs: make([][]float32, len(inputs)), tokens: max(out.Usage.TotalTokens, out.Usage.PromptTokens)}
	for _, d := range out.Data {
		r.vecs[d.Index] = d.Embedding
	}
	return r, nil
}

// embedAll embeds texts in batches with bounded concurrency and reports the
// gateway-counted tokens.
func (e *endpoint) embedAll(ctx context.Context, texts []string, batch, conc int) ([][]float32, int, error) {
	out := make([][]float32, len(texts))
	var mu sync.Mutex
	var tokens, done int
	var firstErr error
	sem := make(chan struct{}, max(conc, 1))
	var wg sync.WaitGroup
	start := time.Now()
	for s := 0; s < len(texts); s += batch {
		mu.Lock()
		failed := firstErr != nil
		mu.Unlock()
		if failed {
			break
		}
		sem <- struct{}{}
		wg.Add(1)
		go func(s, end int) {
			defer func() { <-sem; wg.Done() }()
			r, err := e.embed(ctx, texts[s:end], nil)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				return
			}
			copy(out[s:end], r.vecs)
			tokens += r.tokens
			done += end - s
			if (done/batch)%40 == 0 {
				log.Printf("%s: %d/%d embedded (%.1f/s)", e.name, done, len(texts), float64(done)/time.Since(start).Seconds())
			}
		}(s, min(s+batch, len(texts)))
	}
	wg.Wait()
	return out, tokens, firstErr
}

// cachedEmbed returns vectors for ids, embedding only those missing from the
// cache file for (endpoint model, variant). The file format is ragbench's:
// append-only records of uint16 id length, id, uint16 dims, dims x float32.
func cachedEmbed(ctx context.Context, e *endpoint, dir, variant string, ids, texts []string, batch, conc int) ([][]float32, error) {
	path := cachePath(dir, e.model+"|"+variant)
	cache, err := readCache(path)
	if err != nil {
		return nil, err
	}
	var miss []int
	for i, id := range ids {
		if _, ok := cache[id]; !ok {
			miss = append(miss, i)
		}
	}
	if len(miss) > 0 {
		log.Printf("%s: %d cached, embedding %d (%s)", variant, len(ids)-len(miss), len(miss), path)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
		f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		const slice = 1024 // progress survives interruptions
		for s := 0; s < len(miss); s += slice {
			part := miss[s:min(s+slice, len(miss))]
			in := make([]string, len(part))
			for j, i := range part {
				in[j] = texts[i]
			}
			vecs, _, err := e.embedAll(ctx, in, batch, conc)
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
		}
	}
	out := make([][]float32, len(ids))
	for i, id := range ids {
		out[i] = append([]float32(nil), cache[id]...)
	}
	return out, nil
}

func cachePath(dir, variant string) string {
	h := sha1.Sum([]byte(variant))
	return filepath.Join(dir, "emb-"+hex.EncodeToString(h[:6])+".bin")
}

func readCache(path string) (map[string][]float32, error) {
	cache := map[string][]float32{}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return cache, nil
	} else if err != nil {
		return nil, err
	}
	defer f.Close()
	r := bufio.NewReader(f)
	for {
		v, id, err := readRecord(r)
		if errors.Is(err, io.EOF) {
			return cache, nil
		} else if err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		cache[id] = v
	}
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
