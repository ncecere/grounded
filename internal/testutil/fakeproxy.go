package testutil

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// FakeProxy is a deterministic OpenAI-compatible API for tests. Embeddings
// are derived from a hash of the input, so equal text gives equal vectors.
//
// # Chat completions
//
// POST /v1/chat/completions answers deterministically, streamed as
// chat.completion.chunk SSE when "stream" is true and as one
// chat.completion otherwise. Every reply starts with three reasoning deltas
// (FakeReasoning, sent as reasoning_content), except from a model whose ID
// starts with FakeNoThinkPrefix when it is asked to turn thinking off
// (reasoning_effort "none", or chat_template_kwargs enable_thinking false).
// The reply is chosen by the first
// matching rule, looking only at the last user message and the messages after
// it ("the current question"):
//
//  1. Query rewrite: no tools offered and the system prompt contains the word
//     "standalone" (any case) → the last user message text, unchanged
//     (SetRewrite scripts the reply instead).
//     Follow-up suggestions: no tools offered and the system prompt
//     contains "suggest follow-up questions" → a numbered list of up to 3
//     questions, FakeSuggestion of each passage line's deepest heading
//     ("- Title › Heading"), or NONE when the question contains
//     FakeNoSuggestions; SetSuggestions scripts the reply instead.
//  2. Tools offered, tool_choice is not "none", and no "tool" message follows
//     the last user message → one call to search_knowledge (or the first
//     offered tool if that is absent) with arguments {"query": <last user
//     text>}, split across several chunks, finish_reason "tool_calls".
//     With SetToolCalls, the scripted calls come instead, one per turn: the
//     k-th when k-1 "tool" messages follow the last user message and that
//     tool is offered (MCP tools, docs/mcp-client.md), each after its Text
//     when it has one; once they are used up, the rules below answer.
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
// Vision models (fake-vision) transcribe an image part
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
	suggestions  string          // SetSuggestions: the reply to the suggestions call
	rewrite      string          // SetRewrite: the reply to a query rewrite
	toolScript   []FakeToolCall  // SetToolCalls
	chatBodies   []json.RawMessage
	// suggestBodies are the follow-up suggestions calls' requests.
	suggestBodies []json.RawMessage
	Requests      []string // "METHOD /path model" log

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
	routeCalls int
	routeFail  int
	scopeFail  int
	scopeDelay time.Duration

	// Contextual chunks and the embedding inputs (fakecontext.go).
	ctx fakeContext

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

// BaseURL returns the OpenAI-style base URL including /v1.
func (p *FakeProxy) BaseURL() string { return p.URL + "/v1" }

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
