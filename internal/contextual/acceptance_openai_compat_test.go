package contextual

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

func acceptanceModernBody() map[string]any {
	return map[string]any{"model": "ctx", "max_completion_tokens": RequestMaxTokens,
		"reasoning_effort": "none", "stream": true,
		"messages": []map[string]string{{"role": "system", "content": SystemPrompt}, {"role": "user", "content": "A synthetic section."}}}
}

func TestAcceptanceExplicitModernChatGuard(t *testing.T) {
	guard, err := newAcceptanceTransport("https://acceptance.example.test/v1", fakeAcceptanceLimits(), counter(t))
	if err != nil {
		t.Fatal(err)
	}
	for _, modern := range []bool{true, false} {
		body := acceptanceModernBody()
		if !modern {
			delete(body, "max_completion_tokens")
			delete(body, "reasoning_effort")
			body["max_tokens"] = RequestMaxTokens
		}
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		kind, _, output, err := guard.requestBudget("/v1/chat/completions", data)
		if err != nil || kind != "context" || output != RequestMaxTokens {
			t.Fatalf("bounded chat modern=%v was refused: kind=%s output=%d err=%v", modern, kind, output, err)
		}
	}
}

func TestAcceptanceChatCompatibilityRejectsExtraWork(t *testing.T) {
	for _, value := range []any{"", "low", "medium", "high", "max", nil, true, 1, []string{"none"}, map[string]string{"effort": "none"}} {
		guard, err := newAcceptanceTransport("https://acceptance.example.test/v1", fakeAcceptanceLimits(), counter(t))
		if err != nil {
			t.Fatal(err)
		}
		next := &acceptanceCountingTransport{}
		guard.next = next
		body := acceptanceModernBody()
		body["reasoning_effort"] = value
		if _, err := guard.RoundTrip(acceptanceRequest(t, "/chat/completions", body)); err == nil || next.calls.Load() != 0 {
			t.Fatalf("invalid reasoning reached transport: %T", value)
		}
	}
	for _, value := range []any{"none", nil, "low"} {
		guard, err := newAcceptanceTransport("https://acceptance.example.test/v1", fakeAcceptanceLimits(), counter(t))
		if err != nil {
			t.Fatal(err)
		}
		next := &acceptanceCountingTransport{}
		guard.next = next
		body := map[string]any{"model": "embed", "input": []string{"Synthetic"}, "reasoning_effort": value}
		if _, err := guard.RoundTrip(acceptanceRequest(t, "/embeddings", body)); err == nil || next.calls.Load() != 0 {
			t.Fatal("embedding reasoning reached transport")
		}
	}
	for _, compat := range []acceptanceChatCompat{{MaxTokensField: "unbounded"}, {ThinkingOff: "high"}, {ThinkingOff: "chat_template_kwargs"}} {
		proxy, config := fakeAcceptanceConfig(t)
		config.ChatCompat = compat
		if _, err := newAcceptanceRun(t, config, proxy.APIKey, "fake"); err == nil || len(proxy.ContextCalls()) != 0 {
			t.Fatal("invalid compatibility passed preflight")
		}
	}
}

type acceptanceCompatibilityCapture struct {
	next       http.RoundTripper
	mu         sync.Mutex
	calls, bad int
}

func (c *acceptanceCompatibilityCapture) RoundTrip(req *http.Request) (*http.Response, error) {
	if strings.HasSuffix(req.URL.Path, "/chat/completions") {
		body, err := req.GetBody()
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(body)
		body.Close()
		if err != nil {
			return nil, err
		}
		var wire struct {
			MaxTokens     json.RawMessage `json:"max_tokens"`
			MaxCompletion int             `json:"max_completion_tokens"`
			Effort        string          `json:"reasoning_effort"`
		}
		err = json.Unmarshal(data, &wire)
		c.mu.Lock()
		c.calls++
		if err != nil || len(wire.MaxTokens) != 0 || wire.MaxCompletion != RequestMaxTokens || wire.Effort != "none" {
			c.bad++
		}
		c.mu.Unlock()
	}
	return c.next.RoundTrip(req)
}

func TestAcceptanceModernChatFixtureStreamingReplay(t *testing.T) {
	proxy, config := fakeAcceptanceConfig(t)
	config.ChatCompat = acceptanceChatCompat{MaxTokensField: "max_completion_tokens", ThinkingOff: "reasoning_effort_none"}
	run, err := newAcceptanceRun(t, config, proxy.APIKey, "fake")
	if err != nil {
		t.Fatal(err)
	}
	capture := &acceptanceCompatibilityCapture{next: run.guard.next}
	run.guard.next = capture
	report, err := run.execute(t.Context())
	if err != nil {
		t.Fatalf("modern fake harness failed at %s", report.FailedStage)
	}
	capture.mu.Lock()
	defer capture.mu.Unlock()
	if capture.calls != 6 || capture.bad != 0 || report.ChatCompat != config.ChatCompat || report.CachedReplayRequests != 0 || report.Reserved.EmbeddingRequests != 3 || report.ContextOK != 6 {
		t.Fatalf("modern request/replay/report mismatch: calls=%d bad=%d report=%+v", capture.calls, capture.bad, report)
	}
}
