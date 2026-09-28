package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

// cmdThrottle runs a pacing reverse proxy in front of the model gateway.
// Some gateway keys are limited to a fixed number of requests per minute and
// answer 429 beyond it; Grounded embeds one request per document and retries a
// 429 only a few times, so a bulk upload fails documents. The proxy spreads
// requests evenly under the limit and holds (rather than fails) a request
// that still gets a 429, so the ingest measurement reflects Grounded rather than
// retry luck. It forwards the caller's Authorization header unchanged and
// never logs it.
func cmdThrottle(args []string) error {
	fs := flag.NewFlagSet("throttle", flag.ExitOnError)
	listen := fs.String("listen", "127.0.0.1:18090", "listen address; point Grounded's model connection at http://<listen>/v1")
	upstream := fs.String("upstream", envOr("URL", ""), "gateway origin to forward to (default $URL)")
	rpm := fs.Int("rpm", 110, "requests per minute forwarded upstream (the benchmark gateway's per-key limit was 120)")
	conc := fs.Int("concurrency", 4, "maximum concurrent upstream requests")
	burst := fs.Int("burst", 4, "requests that may pass at once after an idle period (token bucket size), so paced clients see no added latency")
	fs.Usage = func() {
		fmt.Fprintln(fs.Output(), "usage: ragbench throttle [flags]\n\nPacing reverse proxy for a rate-limited OpenAI-compatible gateway.")
		fs.PrintDefaults()
	}
	_ = fs.Parse(args)
	up := strings.TrimSuffix(strings.TrimRight(*upstream, "/"), "/v1")
	if up == "" {
		return fmt.Errorf("set -upstream or $URL")
	}
	t := &throttle{
		upstream: up, client: &http.Client{Timeout: 5 * time.Minute},
		tokens: make(chan struct{}, max(*burst, 1)), sem: make(chan struct{}, max(*conc, 1)),
	}
	go t.refill(time.Minute / time.Duration(max(*rpm, 1)))
	go func() {
		for range time.Tick(time.Minute) {
			log.Printf("throttle: forwarded=%d upstream_429=%d waiting=%d", t.forwarded.Load(), t.limited.Load(), t.held.Load())
		}
	}()
	log.Printf("throttle: %s -> %s at %d requests/min, %d concurrent", *listen, up, *rpm, *conc)
	return http.ListenAndServe(*listen, t)
}

// throttle is the pacing proxy: a token bucket spreads requests, a semaphore
// bounds concurrency, and 429 or 5xx answers are retried (up to 10 times).
type throttle struct {
	upstream                 string
	client                   *http.Client
	tokens, sem              chan struct{}
	forwarded, limited, held atomic.Int64
}

// refill adds a token every interval while the bucket has room.
func (t *throttle) refill(interval time.Duration) {
	tick := time.NewTicker(interval)
	defer tick.Stop()
	for range tick.C {
		select {
		case t.tokens <- struct{}{}:
		default: // bucket full
		}
	}
}

func (t *throttle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	t.held.Add(1)
	defer t.held.Add(-1)
	for attempt := 1; ; attempt++ {
		select {
		case <-t.tokens:
		case <-r.Context().Done():
			return
		}
		t.sem <- struct{}{}
		resp, err := forward(r.Context(), t.client, t.upstream, r, body)
		<-t.sem
		t.forwarded.Add(1)
		if err == nil && resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode < 500 || attempt >= 10 {
			relay(w, resp, err)
			return
		}
		select {
		case <-time.After(min(t.retryWait(resp, err, attempt), time.Minute)):
		case <-r.Context().Done():
			return
		}
	}
}

// retryWait is the pause before the next attempt: Retry-After when given,
// else attempt × 5s. It closes the failed response.
func (t *throttle) retryWait(resp *http.Response, err error, attempt int) time.Duration {
	wait := time.Duration(attempt) * 5 * time.Second
	if err != nil {
		return wait
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		t.limited.Add(1)
	}
	if s, perr := strconv.Atoi(resp.Header.Get("Retry-After")); perr == nil && s > 0 {
		wait = time.Duration(s) * time.Second
	}
	resp.Body.Close()
	return wait
}

// relay copies the upstream response (or a 502 for err) to the client.
func relay(w http.ResponseWriter, resp *http.Response, err error) {
	if err != nil {
		http.Error(w, "upstream: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func forward(ctx context.Context, c *http.Client, upstream string, r *http.Request, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, r.Method, upstream+r.URL.RequestURI(), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	for _, k := range []string{"Authorization", "Content-Type", "Accept", "User-Agent"} {
		if v := r.Header.Get(k); v != "" {
			req.Header.Set(k, v)
		}
	}
	return c.Do(req)
}
