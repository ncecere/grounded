package testutil

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

// chatReply POSTs a non-streamed completion and returns the first choice's message and the usage.
func chatReply(t *testing.T, p *FakeProxy, extra map[string]any) (message map[string]any, usage map[string]any) {
	t.Helper()
	body := map[string]any{"messages": []map[string]string{{"role": "user", "content": "Reply with the single word: pong"}}}
	for k, v := range extra {
		body[k] = v
	}
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", p.URL+"/v1/chat/completions", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		Choices []struct {
			Message map[string]any `json:"message"`
		} `json:"choices"`
		Usage map[string]any `json:"usage"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil || len(out.Choices) == 0 {
		t.Fatalf("decode: %v (status %d)", err, res.StatusCode)
	}
	return out.Choices[0].Message, out.Usage
}

func reasoningTokens(usage map[string]any) float64 {
	d, _ := usage["completion_tokens_details"].(map[string]any)
	n, _ := d["reasoning_tokens"].(float64)
	return n
}

func TestFakeModelsReasonOnEveryReplyByDefault(t *testing.T) {
	p := NewFakeProxy(t)
	msg, usage := chatReply(t, p, map[string]any{"model": "test-chat", "reasoning_effort": "none"})
	if msg["reasoning_content"] == nil || msg["reasoning_content"] == "" || reasoningTokens(usage) == 0 {
		t.Errorf("an ordinary fake model ignores thinking off, like the models in issue #7: message %v usage %v", msg, usage)
	}
}

func TestANoThinkModelHonoursReasoningEffortNone(t *testing.T) {
	p := NewFakeProxy(t)
	p.AddChatModel(FakeNoThinkPrefix + "-1")
	msg, usage := chatReply(t, p, map[string]any{"model": FakeNoThinkPrefix + "-1", "reasoning_effort": "none"})
	if msg["reasoning_content"] != nil && msg["reasoning_content"] != "" || reasoningTokens(usage) != 0 {
		t.Errorf("reasoning_effort none: message %v usage %v, want no reasoning", msg, usage)
	}
	if msg["content"] != "pong" {
		t.Errorf("content = %v, want pong: it still answers", msg["content"])
	}
}

func TestANoThinkModelHonoursTheTemplateSwitch(t *testing.T) {
	p := NewFakeProxy(t)
	p.AddChatModel(FakeNoThinkPrefix + "-2")
	msg, usage := chatReply(t, p, map[string]any{"model": FakeNoThinkPrefix + "-2", "chat_template_kwargs": map[string]any{"enable_thinking": false}})
	if msg["reasoning_content"] != nil && msg["reasoning_content"] != "" || reasoningTokens(usage) != 0 {
		t.Errorf("enable_thinking false: message %v usage %v, want no reasoning", msg, usage)
	}
}

func TestANoThinkModelStillReasonsWhenNotAsked(t *testing.T) {
	p := NewFakeProxy(t)
	p.AddChatModel(FakeNoThinkPrefix + "-3")
	for name, extra := range map[string]map[string]any{
		"no setting":                {},
		"a higher effort":           {"reasoning_effort": "low"},
		"the template switch on":    {"chat_template_kwargs": map[string]any{"enable_thinking": true}},
		"an unrelated template key": {"chat_template_kwargs": map[string]any{"other": false}},
	} {
		extra["model"] = FakeNoThinkPrefix + "-3"
		msg, usage := chatReply(t, p, extra)
		if msg["reasoning_content"] == nil || msg["reasoning_content"] == "" || reasoningTokens(usage) == 0 {
			t.Errorf("%s: message %v usage %v, want reasoning", name, msg, usage)
		}
	}
}
