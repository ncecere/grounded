// Package gateway is a small client for OpenAI-compatible API proxies
// (ADR-0005). It uses only the standard OpenAI surface so any proxy works:
// LiteLLM, open-model-gateway, vLLM, or OpenAI itself.
//
// Phase 3 adds the pi-style streaming chat layer (ADR-0017) on top of this.
package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Error kinds, stable for callers and the API.
const (
	KindUnavailable = "unavailable"  // network error, timeout or 5xx
	KindAuth        = "auth"         // 401/403: bad or missing API key
	KindNotFound    = "not_found"    // 404: unknown model or wrong base URL
	KindRateLimited = "rate_limited" // 429
	KindBadRequest  = "bad_request"  // other 4xx
	KindBadResponse = "bad_response" // response we could not understand
)

// Error describes a failed proxy call. Message is safe to show to admins; it
// never contains the API key.
type Error struct {
	Kind    string
	Status  int
	Message string
	// RetryAfter is how long the proxy (or the connection's request limit)
	// asked us to wait; 0 when it did not say.
	RetryAfter time.Duration
}

// Backpressure reports whether the call was refused because of load rather
// than failure: 429, or a 503 with Retry-After, or the connection's own
// request limit. The request is worth repeating unchanged after RetryAfter,
// and such attempts should not count as failures.
func (e *Error) Backpressure() bool {
	return e.Kind == KindRateLimited || (e.Kind == KindUnavailable && e.RetryAfter > 0)
}

// Limiter paces the requests of one connection (for example a proxy key
// allowed 120 requests per minute). Wait blocks until a request may be sent,
// or returns an *Error with Kind KindRateLimited and RetryAfter when the wait
// would be too long. Backoff records that the proxy asked for a pause.
type Limiter interface {
	Wait(ctx context.Context) error
	Backoff(ctx context.Context, d time.Duration)
}

// DefaultBackoff is the pause after a 429 without Retry-After.
const DefaultBackoff = 10 * time.Second

// maxRetryAfter caps what a proxy can ask for.
const maxRetryAfter = time.Hour

// parseRetryAfter reads a Retry-After header: delay-seconds or an HTTP date.
func parseRetryAfter(h string, now time.Time) time.Duration {
	h = strings.TrimSpace(h)
	if h == "" {
		return 0
	}
	var d time.Duration
	if secs, err := strconv.ParseFloat(h, 64); err == nil {
		d = time.Duration(secs * float64(time.Second))
	} else if t, err := http.ParseTime(h); err == nil {
		d = t.Sub(now)
	}
	return min(max(d, 0), maxRetryAfter)
}

// TimedOut reports whether the call timed out before the proxy answered
// (the message starts "timed out", followed by the phase; see
// describeTransportError).
func (e *Error) TimedOut() bool {
	return e.Kind == KindUnavailable && e.Status == 0 && strings.HasPrefix(e.Message, "timed out")
}

func (e *Error) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("proxy %s (HTTP %d): %s", e.Kind, e.Status, e.Message)
	}
	return fmt.Sprintf("proxy %s: %s", e.Kind, e.Message)
}

// maxResponseBytes bounds how much of a response we read.
const maxResponseBytes = 64 << 20

// Client talks to one proxy.
type Client struct {
	BaseURL string // including the version prefix, e.g. https://proxy.example.edu/v1
	APIKey  string // optional
	HTTP    *http.Client
	// Limiter, when set, paces every request and learns from 429s.
	Limiter Limiter
	// Observe, when set, is told each request's outcome (Outcome) and how
	// long it took: to the response for plain calls, to the response
	// headers for streams. Requests the Limiter refused are reported as
	// OutcomeThrottled without being sent.
	Observe func(outcome string, elapsed time.Duration)
}

// Request outcomes reported to Client.Observe: OutcomeOK, OutcomeCanceled,
// OutcomeThrottled or an error Kind.
const (
	OutcomeOK        = "ok"
	OutcomeCanceled  = "canceled"  // the caller gave up (context cancelled)
	OutcomeThrottled = "throttled" // the connection's own request limit refused it
)

// Outcome classifies a request's result for metrics.
func Outcome(err error) string {
	var e *Error
	switch {
	case err == nil:
		return OutcomeOK
	case errors.As(err, &e) && e.Kind == KindRateLimited && e.Status == 0:
		return OutcomeThrottled
	case errors.As(err, &e):
		return e.Kind
	case errors.Is(err, context.Canceled):
		return OutcomeCanceled
	default:
		return KindUnavailable
	}
}

// observe reports a request to Observe.
func (c *Client) observe(start time.Time, err error) {
	if c.Observe != nil {
		c.Observe(Outcome(err), time.Since(start))
	}
}

// wait applies the limiter before a request.
func (c *Client) wait(ctx context.Context) error {
	if c.Limiter == nil || hasSlot(ctx) {
		return nil
	}
	return c.Limiter.Wait(ctx)
}

// learn tells the limiter about a backpressure response.
func (c *Client) learn(ctx context.Context, e *Error) {
	if c.Limiter == nil || !e.Backpressure() {
		return
	}
	d := e.RetryAfter
	if d <= 0 {
		d = DefaultBackoff
	}
	c.Limiter.Backoff(ctx, d)
}

// New returns a client with the given per-request timeout.
func New(baseURL, apiKey string, timeout time.Duration) *Client {
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		APIKey:  apiKey,
		HTTP:    &http.Client{Timeout: timeout},
	}
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) (err error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rdr = bytes.NewReader(b)
	}
	tr := &Trace{}
	req, err := http.NewRequestWithContext(tr.attach(ctx), method, c.BaseURL+path, rdr)
	if err != nil {
		return &Error{Kind: KindBadRequest, Message: "invalid base URL"}
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	start := time.Now()
	if err := c.wait(ctx); err != nil {
		c.observe(start, err)
		return err
	}
	start = time.Now()
	defer func() { c.observe(start, err) }()
	hc := c.httpClient(ctx)
	res, err := hc.Do(req)
	if err != nil {
		return &Error{Kind: KindUnavailable, Message: describeTransportError(failure{
			err: err, host: requestHost(req.URL), proxy: proxyFor(hc, req), trace: tr, elapsed: time.Since(start),
		})}
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil {
		return &Error{Kind: KindUnavailable, Status: res.StatusCode, Message: "response interrupted"}
	}
	if len(raw) > maxResponseBytes {
		return &Error{Kind: KindBadResponse, Status: res.StatusCode, Message: "response too large"}
	}
	if res.StatusCode >= 300 {
		e := statusError(res.StatusCode, raw)
		e.RetryAfter = parseRetryAfter(res.Header.Get("Retry-After"), time.Now())
		c.learn(ctx, e)
		return e
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &Error{Kind: KindBadResponse, Status: res.StatusCode, Message: "response is not the expected JSON; check the base URL includes the API version (for example /v1)"}
	}
	return nil
}

func statusError(status int, raw []byte) *Error {
	var body struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Detail string `json:"detail"`
	}
	_ = json.Unmarshal(raw, &body)
	msg := body.Error.Message
	if msg == "" {
		msg = body.Detail
	}
	if msg == "" {
		msg = http.StatusText(status)
	}
	if len(msg) > 300 {
		msg = msg[:300] + "…"
	}
	kind := KindBadRequest
	switch {
	case status == 401 || status == 403:
		kind = KindAuth
	case status == 404:
		kind = KindNotFound
	case status == 429 || status == 529:
		// 529 is "overloaded" on some APIs (for example System One
		// judgment servers, ADR-0019): backpressure, like 429.
		kind = KindRateLimited
	case status >= 500:
		kind = KindUnavailable
	}
	return &Error{Kind: kind, Status: status, Message: msg}
}

// PostJSON POSTs body to path (relative to the base URL) and decodes the
// JSON response into out, with the same errors, pacing and backpressure
// handling as the other calls. It serves APIs beyond the fixed OpenAI
// surface, such as moderation providers (ADR-0019).
func (c *Client) PostJSON(ctx context.Context, path string, body, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out)
}

// ListModels returns the model IDs the proxy advertises (GET /models).
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, "/models", nil, &out); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		if m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// Usage is token usage reported by the proxy.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// EmbedRequest embeds a batch of inputs.
type EmbedRequest struct {
	Model string
	Input []string
	User  string // OpenAI "user" field, for attribution in proxy logs
	// Dimensions, when above 0, is sent as the OpenAI "dimensions"
	// parameter (Matryoshka models whose server supports it).
	Dimensions int
}

// EmbedResult holds one vector per input, in input order.
type EmbedResult struct {
	Vectors [][]float32
	Usage   Usage
}

// Embed calls POST /embeddings.
func (c *Client) Embed(ctx context.Context, r EmbedRequest) (EmbedResult, error) {
	body := map[string]any{"model": r.Model, "input": r.Input, "encoding_format": "float"}
	if r.User != "" {
		body["user"] = r.User
	}
	if r.Dimensions > 0 {
		body["dimensions"] = r.Dimensions
	}
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float32 `json:"embedding"`
		} `json:"data"`
		Usage Usage `json:"usage"`
	}
	if err := c.do(ctx, http.MethodPost, "/embeddings", body, &out); err != nil {
		return EmbedResult{}, err
	}
	if len(out.Data) != len(r.Input) {
		return EmbedResult{}, &Error{Kind: KindBadResponse, Message: fmt.Sprintf("expected %d embeddings, got %d", len(r.Input), len(out.Data))}
	}
	vecs := make([][]float32, len(r.Input))
	for _, d := range out.Data {
		if d.Index < 0 || d.Index >= len(vecs) || vecs[d.Index] != nil || len(d.Embedding) == 0 {
			return EmbedResult{}, &Error{Kind: KindBadResponse, Message: "embedding indexes are invalid"}
		}
		vecs[d.Index] = d.Embedding
	}
	return EmbedResult{Vectors: vecs, Usage: out.Usage}, nil
}

// ChatMessage is a plain-text chat message (the pi-style content model
// arrives with streaming in Phase 3), optionally with one PNG image for a
// vision model (sent as OpenAI content parts; vision.go).
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	// ImagePNG is sent after the text as an image_url content part.
	ImagePNG []byte `json:"-"`
}

// CompleteRequest is a non-streaming chat completion.
type CompleteRequest struct {
	Model     string
	Messages  []ChatMessage
	MaxTokens int
	User      string
	// Extra is merged into the body (MergeExtra): the model's extraBody.
	Extra map[string]any
}

// CompleteResult is the first choice of a completion.
type CompleteResult struct {
	Text         string
	FinishReason string
	Usage        Usage
}

// Complete calls POST /chat/completions without streaming.
func (c *Client) Complete(ctx context.Context, r CompleteRequest) (CompleteResult, error) {
	body := map[string]any{"model": r.Model, "messages": r.Messages, "stream": false}
	if r.MaxTokens > 0 {
		body["max_tokens"] = r.MaxTokens
	}
	if r.User != "" {
		body["user"] = r.User
	}
	MergeExtra(body, r.Extra)
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage Usage `json:"usage"`
	}
	if err := c.do(ctx, http.MethodPost, "/chat/completions", body, &out); err != nil {
		return CompleteResult{}, err
	}
	if len(out.Choices) == 0 {
		return CompleteResult{}, &Error{Kind: KindBadResponse, Message: "no choices returned"}
	}
	return CompleteResult{Text: out.Choices[0].Message.Content, FinishReason: out.Choices[0].FinishReason, Usage: out.Usage}, nil
}

type backgroundKey struct{}

// Background marks requests made on ctx as background work (ingestion):
// under a connection's request limit they wait for free capacity instead of
// reserving it ahead, so interactive requests (queries, chat) go first.
func Background(ctx context.Context) context.Context {
	return context.WithValue(ctx, backgroundKey{}, true)
}

// IsBackground reports whether ctx carries Background.
func IsBackground(ctx context.Context) bool {
	b, _ := ctx.Value(backgroundKey{}).(bool)
	return b
}

type slotKey struct{}

// WithSlot marks ctx as holding a request slot the caller already obtained
// from the client's Limiter (Wait), so the request is not paced twice. The
// ingestion batcher waits for a slot first and fills the request with
// whatever inputs arrived meanwhile.
func WithSlot(ctx context.Context) context.Context {
	return context.WithValue(ctx, slotKey{}, true)
}

func hasSlot(ctx context.Context) bool {
	b, _ := ctx.Value(slotKey{}).(bool)
	return b
}
