package testutil

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode"
)

// FakeProxy is a deterministic OpenAI-compatible API for tests. Embeddings
// are derived from a hash of the input, so equal text gives equal vectors.
//
// # Chat completions
//
// POST /v1/chat/completions answers deterministically, streamed as
// chat.completion.chunk SSE when "stream" is true and as one
// chat.completion otherwise. Every reply starts with three reasoning deltas
// (FakeReasoning, sent as reasoning_content). The reply is chosen by the first
// matching rule, looking only at the last user message and the messages after
// it ("the current question"):
//
//  1. Query rewrite: no tools offered and the system prompt contains the word
//     "standalone" (any case) → the last user message text, unchanged.
//  2. Tools offered, tool_choice is not "none", and no "tool" message follows
//     the last user message → one call to search_knowledge (or the first
//     offered tool if that is absent) with arguments {"query": <last user
//     text>}, split across several chunks, finish_reason "tool_calls".
//     With SetToolCalls, the scripted calls come instead, one per turn: the
//     k-th when k-1 "tool" messages follow the last user message and that
//     tool is offered (MCP tools, docs/mcp-client.md); once they are used
//     up, the rules below answer.
//  3. Small talk: the system prompt contains "latest message is small talk"
//     → FakeSmallTalk (the scope check's small-talk reply).
//  4. Sources: the most recent of those messages containing `<source id="1"`
//     → the answer set with SetAnswer, if any; otherwise the first
//     non-empty line of that block's body followed by " [1]"; when that
//     line contains FAKE-LIST, a Markdown list with the first line of
//     every source n followed by " [n]".
//  5. Refusal: the system prompt contains a line `Refusal message: "<text>"`
//     → <text> (everything between the first and the last double quote on
//     that line). The chat pipeline's preamble should include this line.
//  6. The last user text contains "ping" or "pong" → "pong" (model test).
//  7. Otherwise FakeRefusal.
//
// Guardrail models (fake-llama-guard, fake-granite-guardian,
// fake-shieldgemma) and requests whose system prompt contains
// "grounded-moderation-classifier" get moderation answers instead, and POST
// /v1/moderations and /v1/systemone are served too (fakemoderation.go).
// Vision models (fake-vision; AddVisionModel) transcribe an image part
// (fakevision.go). POST /v1/rerank scores passages with FakeRerankModel
// by the query words they contain (fakererank.go).
//
// Usage is included in the final chunk when stream_options.include_usage is
// set (and always in non-streamed responses): prompt tokens are the word
// count of all messages, reasoning tokens are 3.
type FakeProxy struct {
	*httptest.Server
	APIKey string

	mu           sync.Mutex
	chat         map[string]bool // chat model IDs
	embedding    map[string]int  // embedding model ID -> dimensions
	matryoshka   map[string]bool // embedding models that accept "dimensions"
	embedDims    []int           // the "dimensions" parameter of each embedding request (0 = none)
	fail         int             // if non-zero, respond with this status
	chatFail     int             // if non-zero, chat completions respond with this status
	chunkDelay   time.Duration   // pause between streamed chunks
	replyDelay   time.Duration   // pause before a chat completion's first byte
	rewriteDelay time.Duration   // pause before a query rewrite's
	answer       string          // SetAnswer: the reply to a question with sources
	toolScript   []FakeToolCall  // SetToolCalls
	chatBodies   []json.RawMessage
	Requests     []string // "METHOD /path model" log

	// Embedding load simulation (see RejectEmbeddings, LimitEmbeddingRate).
	rejectN          int
	rejectStatus     int
	rejectRetryAfter string
	embedLatency     time.Duration
	embedRPM         int
	embedWindow      []time.Time // accepted embedding requests in the last minute
	embedBatches     []int       // inputs per successful embedding request
	embedRejected    int
	rejectInput      string // inputs containing it get 400

	// Moderation providers (fakemoderation.go).
	modFail  int
	modDelay time.Duration
	modCalls int
	// modFailLater fails moderation calls with this status once
	// modPassLeft more have answered (FailModerationAfter).
	modFailLater, modPassLeft int

	// Passage judging (fakesystemone.go).
	judgeFail   int
	judgeDelays []time.Duration // request n waits judgeDelays[n % len]
	judgeCalls  int

	// Vision models (fakevision.go).
	vision      map[string]bool
	visionFail  int
	visionCalls int

	// Citation and scope checks (fakesystemone.go).
	citeCalls  int
	citeDelay  time.Duration
	scopeCalls int
	scopeFail  int
	scopeDelay time.Duration

	// Rerank models (fakererank.go).
	rerankFail  int
	rerankDelay time.Duration
	rerankReqs  []FakeRerankRequest
}

// FakeReasoning is the reasoning the fake streams before every reply.
var FakeReasoning = []string{"Looking at", " the question", " and sources."}

// FakeRefusal is the reply when no rule gives a better one.
const FakeRefusal = "I couldn't find an answer to that in the sources I have."

// NewFakeProxyHandler builds the fake without starting a server; used by
// cmd/fakeproxy for local development.
func NewFakeProxyHandler(apiKey string) (*FakeProxy, http.Handler) {
	p := &FakeProxy{
		APIKey:     apiKey,
		chat:       map[string]bool{"test-chat": true},
		embedding:  map[string]int{"test-embed": 8},
		matryoshka: map[string]bool{},
		vision:     map[string]bool{FakeVisionModel: true},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", p.models)
	mux.HandleFunc("POST /v1/embeddings", p.embeddings)
	mux.HandleFunc("POST /v1/chat/completions", p.completions)
	mux.HandleFunc("POST /v1/moderations", p.moderations)
	mux.HandleFunc("POST /v1/systemone", p.systemOne)
	mux.HandleFunc("POST /v1/rerank", p.rerank)
	return p, p.auth(mux)
}

// NewFakeProxy starts a fake proxy for one test.
func NewFakeProxy(t testing.TB) *FakeProxy {
	t.Helper()
	p, h := NewFakeProxyHandler("sk-test-" + randomSuffix())
	p.Server = httptest.NewServer(h)
	t.Cleanup(p.Close)
	return p
}

// NewFakeSystemOneService starts a fake that serves only POST
// /v1/systemone, like a SystemOne service (ADR-0020): every other path,
// GET /v1/models included, answers 404.
func NewFakeSystemOneService(t testing.TB) *FakeProxy {
	t.Helper()
	p, h := NewFakeProxyHandler("sk-test-" + randomSuffix())
	p.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/systemone" {
			writeErr(w, http.StatusNotFound, "not found")
			return
		}
		h.ServeHTTP(w, r)
	}))
	t.Cleanup(p.Close)
	return p
}

// AddChatModel registers a chat model.
func (p *FakeProxy) AddChatModel(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.chat[id] = true
}

// SetAnswer makes text the reply to every question answered with
// sources (rule 4), until it is set to "" again: a model's exact answer,
// for tests of what the pipeline makes of it.
func (p *FakeProxy) SetAnswer(text string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.answer = text
}

// FakeToolCall is a scripted tool call (SetToolCalls).
type FakeToolCall struct {
	Name string
	Args string // JSON
}

// SetToolCalls scripts the tool calls of every answer, one per turn (rule
// 2); none restores the default.
func (p *FakeProxy) SetToolCalls(calls ...FakeToolCall) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.toolScript = calls
}

// BaseURL returns the OpenAI-style base URL including /v1.
func (p *FakeProxy) BaseURL() string { return p.URL + "/v1" }

// AddEmbeddingModel registers an embedding model with the given dimensions.
func (p *FakeProxy) AddEmbeddingModel(id string, dims int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.embedding[id] = dims
}

// AddMatryoshkaEmbeddingModel registers an embedding model that accepts the
// OpenAI "dimensions" parameter: it returns the first dimensions of its
// native vector, renormalised. Models added with AddEmbeddingModel reject
// the parameter with 400, as vLLM does for a model served without
// Matryoshka support.
func (p *FakeProxy) AddMatryoshkaEmbeddingModel(id string, dims int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.embedding[id] = dims
	p.matryoshka[id] = true
}

// EmbedDimensions returns the "dimensions" parameter of every embedding
// request so far (0 when absent).
func (p *FakeProxy) EmbedDimensions() []int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]int(nil), p.embedDims...)
}

// FailWith makes every request return status (0 restores normal behaviour).
func (p *FakeProxy) FailWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.fail = status
}

// FailChatWith makes chat completions (only) return status, with
// Retry-After: 1 for 429 and 503 (0 restores normal behaviour). Embeddings
// keep working, so a chat test gets past retrieval.
func (p *FakeProxy) FailChatWith(status int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.chatFail = status
}

// SetChunkDelay pauses d between streamed chunks (0 = none), so tests can
// abort a chat mid-stream.
func (p *FakeProxy) SetChunkDelay(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.chunkDelay = d
}

// SetReplyDelay pauses before a chat completion's first byte (0 = none):
// rewrite before a query rewrite's (a reasoning model thinking before it
// writes the query), firstToken before any other (the model's time to
// first token).
func (p *FakeProxy) SetReplyDelay(firstToken, rewrite time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.replyDelay, p.rewriteDelay = firstToken, rewrite
}

// RejectEmbeddings makes the next n embedding requests fail with status,
// sending retryAfter (seconds or an HTTP date; "" = none) as Retry-After.
func (p *FakeProxy) RejectEmbeddings(n, status int, retryAfter string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rejectN, p.rejectStatus, p.rejectRetryAfter = n, status, retryAfter
}

// RejectInputsContaining answers 400 to embedding requests with an input
// containing s ("" = off), like a proxy refusing one malformed input.
func (p *FakeProxy) RejectInputsContaining(s string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rejectInput = s
}

// LimitEmbeddingRate answers 429 with Retry-After once more than rpm
// embedding requests arrive within a sliding minute (0 = unlimited), like a
// gateway's per-key limit.
func (p *FakeProxy) LimitEmbeddingRate(rpm int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.embedRPM = rpm
}

// SetEmbedLatency delays every embedding response by d.
func (p *FakeProxy) SetEmbedLatency(d time.Duration) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.embedLatency = d
}

// EmbedBatches returns the number of inputs of each successful embedding
// request so far.
func (p *FakeProxy) EmbedBatches() []int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]int(nil), p.embedBatches...)
}

// EmbedRequestsFor returns how many embedding requests named model.
func (p *FakeProxy) EmbedRequestsFor(model string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, r := range p.Requests {
		if r == "POST /v1/embeddings "+model {
			n++
		}
	}
	return n
}

// EmbedRejected returns how many embedding requests were refused (injected
// or over the rate limit).
func (p *FakeProxy) EmbedRejected() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.embedRejected
}

// admitEmbedding applies injected failures and the rate limit. It returns
// the status and Retry-After to answer with, or 0.
func (p *FakeProxy) admitEmbedding(now time.Time) (int, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.rejectN > 0 {
		p.rejectN--
		p.embedRejected++
		return p.rejectStatus, p.rejectRetryAfter
	}
	if p.embedRPM > 0 {
		cut := 0
		for cut < len(p.embedWindow) && now.Sub(p.embedWindow[cut]) >= time.Minute {
			cut++
		}
		p.embedWindow = p.embedWindow[cut:]
		if len(p.embedWindow) >= p.embedRPM {
			p.embedRejected++
			wait := time.Minute - now.Sub(p.embedWindow[0])
			return http.StatusTooManyRequests, fmt.Sprint(int(math.Ceil(wait.Seconds())))
		}
		p.embedWindow = append(p.embedWindow, now)
	}
	return 0, ""
}

// ChatRequests returns the raw bodies of the chat completion requests so far.
func (p *FakeProxy) ChatRequests() []json.RawMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]json.RawMessage(nil), p.chatBodies...)
}

func (p *FakeProxy) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		fail := p.fail
		p.mu.Unlock()
		if fail != 0 {
			writeErr(w, fail, "injected failure")
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+p.APIKey {
			writeErr(w, http.StatusUnauthorized, "invalid api key")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"message": msg}})
}

func (p *FakeProxy) log(r *http.Request, model string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Requests = append(p.Requests, r.Method+" "+r.URL.Path+" "+model)
}

func (p *FakeProxy) models(w http.ResponseWriter, r *http.Request) {
	p.log(r, "")
	p.mu.Lock()
	var data []map[string]string
	for id := range p.chat {
		data = append(data, map[string]string{"id": id, "object": "model"})
	}
	for id := range p.embedding {
		data = append(data, map[string]string{"id": id, "object": "model"})
	}
	for id := range p.vision {
		data = append(data, map[string]string{"id": id, "object": "model"})
	}
	for id := range fakeGuardModels {
		data = append(data, map[string]string{"id": id, "object": "model"})
	}
	data = append(data, map[string]string{"id": FakeRerankModel, "object": "model"})
	p.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{"object": "list", "data": data})
}

func (p *FakeProxy) embeddings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Model      string `json:"model"`
		Input      any    `json:"input"`
		Dimensions int    `json:"dimensions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	p.log(r, in.Model)
	p.mu.Lock()
	dims, ok := p.embedding[in.Model]
	mrl := p.matryoshka[in.Model]
	p.embedDims = append(p.embedDims, in.Dimensions)
	p.mu.Unlock()
	if !ok {
		writeErr(w, 404, "model not found")
		return
	}
	if in.Dimensions != 0 && (!mrl || in.Dimensions < 1 || in.Dimensions > dims) {
		writeErr(w, 400, "Model \""+in.Model+"\" does not support matryoshka representation, changing output dimensions will lead to poor results.")
		return
	}
	if status, retryAfter := p.admitEmbedding(time.Now()); status != 0 {
		if retryAfter != "" {
			w.Header().Set("Retry-After", retryAfter)
		}
		writeErr(w, status, "rate limit exceeded")
		return
	}
	p.mu.Lock()
	latency := p.embedLatency
	p.mu.Unlock()
	if latency > 0 {
		select {
		case <-time.After(latency):
		case <-r.Context().Done():
			return
		}
	}
	var inputs []string
	switch v := in.Input.(type) {
	case string:
		inputs = []string{v}
	case []any:
		for _, s := range v {
			str, _ := s.(string)
			inputs = append(inputs, str)
		}
	}
	p.mu.Lock()
	bad := p.rejectInput
	p.mu.Unlock()
	for _, text := range inputs {
		if bad != "" && strings.Contains(text, bad) {
			writeErr(w, http.StatusBadRequest, "input rejected")
			return
		}
	}
	data := make([]map[string]any, len(inputs))
	tokens := 0
	for i, text := range inputs {
		vec := FakeEmbedding(text, dims)
		if in.Dimensions > 0 {
			vec = truncateNormalize(vec, in.Dimensions)
		}
		data[i] = map[string]any{"object": "embedding", "index": i, "embedding": vec}
		tokens += len(strings.Fields(text)) + 1
	}
	p.mu.Lock()
	p.embedBatches = append(p.embedBatches, len(inputs))
	p.mu.Unlock()
	_ = json.NewEncoder(w).Encode(map[string]any{
		"object": "list", "data": data, "model": in.Model,
		"usage": map[string]int{"prompt_tokens": tokens, "total_tokens": tokens},
	})
}

// truncateNormalize keeps the first n values at unit length (Matryoshka).
func truncateNormalize(v []float32, n int) []float32 {
	out := append([]float32(nil), v[:n]...)
	var sum float64
	for _, x := range out {
		sum += float64(x) * float64(x)
	}
	if sum > 0 {
		norm := math.Sqrt(sum)
		for i, x := range out {
			out[i] = float32(float64(x) / norm)
		}
	}
	return out
}

// FakeEmbedding returns the deterministic unit vector the fake proxy
// produces for text: a hashed bag of words, so texts sharing words are close
// (cosine similarity behaves like a crude semantic model) and equal texts are
// identical. A tiny hash of the whole text avoids zero vectors.
func FakeEmbedding(text string, dims int) []float32 {
	v := make([]float64, dims)
	for _, w := range strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		if len(w) < 3 {
			continue // skip short function words
		}
		sum := sha256.Sum256([]byte(w))
		v[binary.BigEndian.Uint32(sum[:4])%uint32(dims)] += 1
	}
	whole := sha256.Sum256([]byte(text))
	for i := range v {
		v[i] += float64(whole[i%len(whole)]) / 255 * 0.01
	}
	var norm float64
	for _, x := range v {
		norm += x * x
	}
	norm = math.Sqrt(norm)
	out := make([]float32, dims)
	for i := range v {
		out[i] = float32(v[i] / norm)
	}
	return out
}
