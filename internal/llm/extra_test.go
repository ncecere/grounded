package llm

import (
	"encoding/json"
	"testing"
)

func TestExtraBody(t *testing.T) {
	m := testModel()
	m.Compat.SupportsToolChoice = true
	m.Compat.ExtraBody = map[string]any{
		"chat_template_kwargs": map[string]any{"enable_thinking": false},
		"top_k":                20,
		// Core fields are never overridden, even if stored somehow.
		"model": "other", "messages": []any{}, "stream": false, "tools": nil, "tool_choice": "none", "max_tokens": 1,
	}
	temp := 0.2
	body := buildRequest(m, Context{Messages: []Message{UserMessage{Content: "q"}}, Tools: []Tool{{Name: "search_knowledge"}}},
		Options{MaxTokens: 100, ToolChoice: "required", Temperature: &temp}, true)
	raw, _ := json.Marshal(body)
	var got map[string]any
	_ = json.Unmarshal(raw, &got)
	if got["model"] != "gpt-oss-120b" || got["stream"] != true || got["tool_choice"] != "required" || got["max_tokens"] != 100.0 {
		t.Errorf("core fields overridden: %s", raw)
	}
	if msgs, _ := got["messages"].([]any); len(msgs) != 1 {
		t.Errorf("messages = %v", got["messages"])
	}
	if tools, _ := got["tools"].([]any); len(tools) != 1 {
		t.Errorf("tools = %v", got["tools"])
	}
	kw, _ := got["chat_template_kwargs"].(map[string]any)
	if kw["enable_thinking"] != false || got["top_k"] != 20.0 {
		t.Errorf("extra fields missing: %s", raw)
	}
	// Without tools, tool_choice stays unset rather than taking extraBody's.
	body = buildRequest(m, Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{}, true)
	if _, ok := body["tool_choice"]; ok {
		t.Errorf("tool_choice set from extraBody: %v", body["tool_choice"])
	}
	if _, ok := body["max_tokens"]; ok {
		t.Errorf("max_tokens set from extraBody: %v", body["max_tokens"])
	}
}
