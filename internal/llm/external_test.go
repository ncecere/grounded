package llm_test

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/testutil"
)

// The stored compat JSON is written by catalog.Compat and read by
// llm.CompatOverrides; they must not drift apart.
func TestCompatOverridesMatchCatalog(t *testing.T) {
	ct, lt := reflect.TypeOf(catalog.Compat{}), reflect.TypeOf(llm.CompatOverrides{})
	if ct.NumField() != lt.NumField() {
		t.Fatalf("catalog.Compat has %d fields, llm.CompatOverrides %d", ct.NumField(), lt.NumField())
	}
	for i := 0; i < ct.NumField(); i++ {
		cf := ct.Field(i)
		lf, ok := lt.FieldByName(cf.Name)
		if !ok || lf.Tag.Get("json") != cf.Tag.Get("json") || lf.Type != cf.Type {
			t.Errorf("field %s differs", cf.Name)
		}
	}
	yes, rc := true, "reasoning"
	raw, _ := json.Marshal(catalog.Compat{SupportsToolChoice: &yes, ThinkingField: &rc})
	if c := llm.DecodeCompat(raw); !c.SupportsToolChoice || c.ThinkingField != "reasoning" {
		t.Fatalf("decoded = %+v", c)
	}
}

var searchTool = llm.Tool{
	Name:        "search_knowledge",
	Description: "Search.",
	Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`),
}

func fakeModel() llm.Model {
	return llm.Model{ID: "test-chat", SupportsTools: true, Compat: llm.DecodeCompat(nil)}
}

func TestFakeProxyStreamingChat(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	prov := llm.NewOpenAI(gateway.New(p.BaseURL(), p.APIKey, 5*time.Second))
	ctx := context.Background()
	sys := "Preamble.\nRefusal message: \"Sorry, not in my sources.\"\nMore."
	question := llm.UserMessage{Content: "How do I drop a class?"}

	// Turn 1: tools offered, no tool result yet → search_knowledge call.
	var deltas, thinking int
	var final llm.Event
	for ev := range prov.Stream(ctx, fakeModel(), llm.Context{SystemPrompt: sys, Messages: []llm.Message{question}, Tools: []llm.Tool{searchTool}}, llm.Options{}) {
		switch ev.Type {
		case llm.EventToolCallDelta:
			deltas++
		case llm.EventThinkingDelta:
			thinking++
		}
		if ev.Type.Terminal() {
			final = ev
		}
	}
	msg := final.Message
	calls := msg.ToolCalls()
	if final.Type != llm.EventDone || msg.StopReason != llm.StopReasonToolUse || len(calls) != 1 || calls[0].Name != "search_knowledge" {
		t.Fatalf("turn 1 = %+v", msg)
	}
	if string(calls[0].Arguments) != `{"query":"How do I drop a class?"}` || deltas < 3 || thinking != len(testutil.FakeReasoning) {
		t.Fatalf("args %s, %d arg deltas, %d thinking deltas", calls[0].Arguments, deltas, thinking)
	}
	if msg.Usage.Reasoning != 3 || msg.Usage.Input == 0 || msg.Usage.Total != msg.Usage.Input+msg.Usage.Output {
		t.Errorf("usage = %+v", msg.Usage)
	}

	// Turn 2: with sources → quote line 1 with [1].
	sources := "<sources>\n<source id=\"1\" title=\"Drop/add\">\n\nUse the student portal to drop a class before the deadline.\nMore text.\n</source>\n</sources>"
	history := []llm.Message{question, msg, llm.ToolResultMessage{ToolCallID: calls[0].ID, ToolName: "search_knowledge", Content: sources}}
	ans, err := llm.Complete(ctx, prov, fakeModel(), llm.Context{SystemPrompt: sys, Messages: history, Tools: []llm.Tool{searchTool}}, llm.Options{})
	if err != nil || ans.Text() != "Use the student portal to drop a class before the deadline. [1]" || ans.StopReason != llm.StopReasonStop || ans.Thinking() == "" {
		t.Fatalf("turn 2 = %+v %v", ans, err)
	}

	// Turn 2 with no results → the refusal message from the system prompt.
	history[2] = llm.ToolResultMessage{ToolCallID: calls[0].ID, Content: "No results."}
	ans, err = llm.Complete(ctx, prov, fakeModel(), llm.Context{SystemPrompt: sys, Messages: history, Tools: []llm.Tool{searchTool}}, llm.Options{})
	if err != nil || ans.Text() != "Sorry, not in my sources." {
		t.Fatalf("refusal = %q %v", ans.Text(), err)
	}

	// Always mode: sources in the user message, no tools.
	ans, _ = llm.Complete(ctx, prov, fakeModel(), llm.Context{SystemPrompt: sys, Messages: []llm.Message{
		llm.UserMessage{Content: "Q?\n" + sources},
	}}, llm.Options{})
	if ans.Text() != "Use the student portal to drop a class before the deadline. [1]" {
		t.Fatalf("always mode = %q", ans.Text())
	}

	// No refusal line → the fixed fallback; query rewrite → echo.
	ans, _ = llm.Complete(ctx, prov, fakeModel(), llm.Context{SystemPrompt: "x", Messages: []llm.Message{question}}, llm.Options{})
	if ans.Text() != testutil.FakeRefusal {
		t.Fatalf("fallback = %q", ans.Text())
	}
	ans, _ = llm.Complete(ctx, prov, fakeModel(), llm.Context{SystemPrompt: "Rewrite the question as a standalone search query.", Messages: []llm.Message{question}}, llm.Options{})
	if ans.Text() != question.Content {
		t.Fatalf("rewrite = %q", ans.Text())
	}

	// Without include_usage there is no usage.
	m := fakeModel()
	m.Compat.SupportsStreamUsage = false
	ans, _ = llm.Complete(ctx, prov, m, llm.Context{Messages: []llm.Message{llm.UserMessage{Content: "ping"}}}, llm.Options{})
	if ans.Text() != "pong" || ans.Usage != (llm.Usage{}) {
		t.Fatalf("no usage = %+v", ans)
	}

	// The requests carried the expected fields.
	reqs := p.ChatRequests()
	var first map[string]any
	_ = json.Unmarshal(reqs[0], &first)
	if first["stream"] != true || first["tools"] == nil {
		t.Errorf("request = %v", first)
	}
}

func TestFakeProxyAbortMidStream(t *testing.T) {
	p := testutil.NewFakeProxy(t)
	p.SetChunkDelay(20 * time.Millisecond)
	prov := llm.NewOpenAI(gateway.New(p.BaseURL(), p.APIKey, 5*time.Second))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var final llm.Event
	for ev := range prov.Stream(ctx, fakeModel(), llm.Context{Messages: []llm.Message{llm.UserMessage{Content: "one two three four five six"}},
		SystemPrompt: "standalone"}, llm.Options{}) {
		if ev.Type == llm.EventTextDelta {
			cancel()
		}
		if ev.Type.Terminal() {
			final = ev
		}
	}
	if final.Reason != llm.StopReasonAborted || !strings.HasPrefix(final.Message.Text(), "one") || final.Message.Text() == "one two three four five six" {
		t.Fatalf("final = %+v", final.Message)
	}
}

// TestLiveGateway streams from the real gateway. Run with:
//
//	set -a && . ./ai.env && set +a
//	GROUNDED_LIVE_LLM=1 GROUNDED_LIVE_URL="$URL" GROUNDED_LIVE_KEY="$KEY" GROUNDED_LIVE_MODEL="$LLM_MODEL" go test -run Live -v ./internal/llm/
func TestLiveGateway(t *testing.T) {
	if os.Getenv("GROUNDED_LIVE_LLM") != "1" {
		t.Skip("set GROUNDED_LIVE_LLM=1 with GROUNDED_LIVE_URL, GROUNDED_LIVE_KEY and GROUNDED_LIVE_MODEL")
	}
	url, key, model := os.Getenv("GROUNDED_LIVE_URL"), os.Getenv("GROUNDED_LIVE_KEY"), os.Getenv("GROUNDED_LIVE_MODEL")
	if url == "" || key == "" || model == "" {
		t.Fatal("GROUNDED_LIVE_URL, GROUNDED_LIVE_KEY and GROUNDED_LIVE_MODEL are required")
	}
	if !strings.HasSuffix(strings.TrimRight(url, "/"), "/v1") {
		url = strings.TrimRight(url, "/") + "/v1"
	}
	prov := llm.NewOpenAI(gateway.New(url, key, 60*time.Second))
	m := llm.Model{ID: model, SupportsTools: true, Compat: llm.DecodeCompat(json.RawMessage(`{"supportsReasoningEffort":true}`))}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	opts := llm.Options{MaxTokens: 1024, ReasoningEffort: "low", User: llm.UserTag("livetest", "llm")}

	start := time.Now()
	var firstToken time.Duration
	var final llm.Event
	for ev := range prov.Stream(ctx, m, llm.Context{
		SystemPrompt: "You are concise.",
		Messages:     []llm.Message{llm.UserMessage{Content: "In one short sentence, what is the capital of France?"}},
	}, opts) {
		if firstToken == 0 && (ev.Type == llm.EventTextDelta || ev.Type == llm.EventThinkingDelta) {
			firstToken = time.Since(start)
		}
		if ev.Type.Terminal() {
			final = ev
		}
	}
	msg := final.Message
	if final.Type != llm.EventDone || msg.Text() == "" {
		t.Fatalf("text: %s %s %s", final.Type, final.Reason, msg.ErrorMessage)
	}
	t.Logf("text answer: %q (stop %s, first token %s, total %s, usage %+v)", msg.Text(), msg.StopReason, firstToken, time.Since(start), msg.Usage)

	sys := "Always call search_knowledge before answering questions about Example University."
	q := llm.UserMessage{Content: "When is the drop/add deadline at Example University?"}
	msg, err := llm.Complete(ctx, prov, m, llm.Context{SystemPrompt: sys, Messages: []llm.Message{q}, Tools: []llm.Tool{searchTool}}, opts)
	if err != nil {
		t.Fatalf("tool call: %v", err)
	}
	calls := msg.ToolCalls()
	if msg.StopReason != llm.StopReasonToolUse || len(calls) == 0 || calls[0].Name != "search_knowledge" {
		t.Fatalf("expected a search_knowledge call, got %+v", msg)
	}
	t.Logf("tool call: %s %s (usage %+v)", calls[0].Name, calls[0].Arguments, msg.Usage)

	// Answer after the tool result, without tools (the loop's forced final turn).
	history := []llm.Message{q, msg, llm.ToolResultMessage{ToolCallID: calls[0].ID, ToolName: calls[0].Name,
		Content: "<sources>\n<source id=\"1\" title=\"Drop/add\">\nDrop/add ends at 11:59 p.m. on the fifth day of the term.\n</source>\n</sources>"}}
	ans, err := llm.Complete(ctx, prov, m, llm.Context{SystemPrompt: sys + "\nCite sources as [n].", Messages: history}, opts)
	if err != nil || ans.Text() == "" {
		t.Fatalf("final answer: %+v %v", ans, err)
	}
	t.Logf("final answer: %q (usage %+v)", ans.Text(), ans.Usage)
}
