// Contextual chunks on the fake gateway (docs/contextual-chunks.md): a chat request whose system prompt starts with the marker of the
// contextual-chunks prompt is a context call. The fake records it (the system prompt, the user message, whether tools were offered) and
// answers with a description made from the section text, or what a test scripts, so tests can check what was sent and what was embedded.
// It never calls a real model. The inputs of embedding requests are recorded too.

package fakes

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// FakeContextMarker starts the contextual-chunks system prompt (internal/contextual.SystemPrompt).
const FakeContextMarker = "grounded-contextual-chunks"

// FakeContextCall is one context request the fake received.
type FakeContextCall struct {
	Model, System, User string
	// Tools: the request offered tools or a tool choice (it must not).
	Tools bool
	// MaxTokens is the output limit asked for (max_tokens or max_completion_tokens).
	MaxTokens int
	User_     string // the OpenAI "user" tag
}

type fakeContext struct {
	mu     sync.Mutex
	calls  []FakeContextCall
	reply  func(user string) string
	status int
	delay  time.Duration
	inputs []string // embedding inputs, in order
}

// SetContextReply scripts the text of every context reply from the user message (nil: the default, "Describes ..." and the section's
// first words).
func (p *FakeProxy) SetContextReply(f func(user string) string) {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	p.ctx.reply = f
}

// FailContextWith makes context requests (only those) answer this status; 0 stops.
func (p *FakeProxy) FailContextWith(status int) {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	p.ctx.status = status
}

// SetContextDelay makes context replies wait before answering.
func (p *FakeProxy) SetContextDelay(d time.Duration) {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	p.ctx.delay = d
}

// ContextCalls are the context requests so far.
func (p *FakeProxy) ContextCalls() []FakeContextCall {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	return append([]FakeContextCall(nil), p.ctx.calls...)
}

// EmbedInputs are the texts of the embedding requests so far, in order.
func (p *FakeProxy) EmbedInputs() []string {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	return append([]string(nil), p.ctx.inputs...)
}

// ResetEmbedInputs forgets the recorded embedding inputs.
func (p *FakeProxy) ResetEmbedInputs() {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	p.ctx.inputs = nil
}

func (p *FakeProxy) recordEmbedInputs(in []string) {
	p.ctx.mu.Lock()
	defer p.ctx.mu.Unlock()
	p.ctx.inputs = append(p.ctx.inputs, in...)
}

// contextChat answers a contextual-chunks request; it reports whether the request was one.
func (p *FakeProxy) contextChat(w http.ResponseWriter, r *http.Request, in *fakeChatRequest, raw []byte) bool {
	var system, user string
	for _, m := range in.Messages {
		switch m.Role {
		case "system", "developer":
			system = fakeText(m.Content)
		case "user":
			user = fakeText(m.Content)
		}
	}
	if !strings.HasPrefix(system, FakeContextMarker) {
		return false
	}
	var extra struct {
		MaxTokens           int    `json:"max_tokens"`
		MaxCompletionTokens int    `json:"max_completion_tokens"`
		User                string `json:"user"`
	}
	_ = json.Unmarshal(raw, &extra)
	call := FakeContextCall{Model: in.Model, System: system, User: user, Tools: len(in.Tools) > 0 || len(in.ToolChoice) > 0,
		MaxTokens: max(extra.MaxTokens, extra.MaxCompletionTokens), User_: extra.User}
	p.ctx.mu.Lock()
	p.ctx.calls = append(p.ctx.calls, call)
	status, delay, reply := p.ctx.status, p.ctx.delay, p.ctx.reply
	p.ctx.mu.Unlock()
	if status != 0 {
		if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
			w.Header().Set("Retry-After", "1")
		}
		writeErr(w, status, "context failure (test)")
		return true
	}
	if !wait(r, delay) {
		return true
	}
	text := defaultContextReply(user)
	if reply != nil {
		text = reply(user)
	}
	words := 0
	for _, m := range in.Messages {
		words += len(strings.Fields(fakeText(m.Content)))
	}
	rep := fakeReply{text: text, promptTokens: words}
	completion := len(strings.Fields(text))
	usage := map[string]any{"prompt_tokens": words, "completion_tokens": completion, "total_tokens": words + completion}
	if !in.Stream {
		writeFakeCompletion(w, in, rep, usage)
		return true
	}
	streamFakeChunks(w, r, fakeChunks(in, rep, usage), 0)
	return true
}

// defaultContextReply describes the section by its first words: deterministic, and it changes when the section does.
func defaultContextReply(user string) string {
	section := user
	if i := strings.Index(section, "<untrusted_section>"); i >= 0 {
		section = section[i+len("<untrusted_section>"):]
	}
	if i := strings.Index(section, "</untrusted_section>"); i >= 0 {
		section = section[:i]
	}
	words := strings.Fields(section)
	if len(words) > 8 {
		words = words[:8]
	}
	return "This section describes " + strings.Join(words, " ") + " in the document."
}
