package testutil

import (
	"encoding/json"
	"time"
)

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

// SetSuggestions makes text the reply to the follow-up suggestions call
// (rule 1), until it is set to "" again.
func (p *FakeProxy) SetSuggestions(text string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.suggestions = text
}

// SetRewrite makes text the reply to a query rewrite (rule 1) instead of
// the message unchanged, until it is set to "" again: a model that answers
// instead of rewriting (v0.4.2 US2-01).
func (p *FakeProxy) SetRewrite(text string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rewrite = text
}

// FakeToolCall is a scripted tool call (SetToolCalls).
type FakeToolCall struct {
	Name string
	Args string // JSON
	// Text is written in the same turn before the call (narration or a
	// draft, v0.4.2 BU2-01): streamed as content before the tool call's
	// chunks, or the message's content beside tool_calls.
	Text string
}

// SetToolCalls scripts the tool calls of every answer, one per turn (rule
// 2); none restores the default.
func (p *FakeProxy) SetToolCalls(calls ...FakeToolCall) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.toolScript = calls
}

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

// ChatRequests returns the raw bodies of the chat completion requests so
// far, except the follow-up suggestions calls (SuggestionRequests).
func (p *FakeProxy) ChatRequests() []json.RawMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]json.RawMessage(nil), p.chatBodies...)
}

// SuggestionRequests returns the bodies of the follow-up suggestions calls
// (not in ChatRequests).
func (p *FakeProxy) SuggestionRequests() []json.RawMessage {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]json.RawMessage(nil), p.suggestBodies...)
}
