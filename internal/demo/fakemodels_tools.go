package demo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Tool calls of the fake gateway: when a request offers a tool other than
// search_knowledge (an agent's MCP tools, docs/mcp-client.md) and no tool
// result follows the question yet, the fake calls the first such tool once,
// filling each required string argument with the question. The next turn
// quotes the tool's result like any other source, so a demo agent with an
// MCP tool shows a cited tool result without a real model.

type fakeTool struct {
	Function struct {
		Name       string          `json:"name"`
		Parameters json.RawMessage `json:"parameters"`
	} `json:"function"`
}

// demoToolCall is the call to make, or nil.
func demoToolCall(in *fakeChatRequest) (name, args string, ok bool) {
	question, afterQuestion := "", false
	for _, m := range in.Messages {
		switch m.Role {
		case "user":
			question, afterQuestion = questionOf(messageText(m.Content)), false
		case "tool":
			afterQuestion = true
		}
	}
	if afterQuestion {
		return "", "", false
	}
	for _, t := range in.Tools {
		if t.Function.Name == "" || t.Function.Name == "search_knowledge" {
			continue
		}
		return t.Function.Name, toolArguments(t.Function.Parameters, question), true
	}
	return "", "", false
}

// questionOf is the question of a user message: the text after the
// retrieved sources, when the message carries them (retrieval mode always).
func questionOf(text string) string {
	for _, end := range []string{"</conflicting_sources>", "</sources>"} {
		if i := strings.LastIndex(text, end); i >= 0 {
			text = text[i+len(end):]
			break
		}
	}
	text = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(text), "No sources matched this question."))
	return text
}

// toolArguments fills the schema's required string properties with text.
func toolArguments(schema json.RawMessage, text string) string {
	var s struct {
		Required   []string `json:"required"`
		Properties map[string]struct {
			Type string `json:"type"`
		} `json:"properties"`
	}
	_ = json.Unmarshal(schema, &s)
	args := map[string]any{}
	for _, name := range s.Required {
		if p, ok := s.Properties[name]; ok && (p.Type == "string" || p.Type == "") {
			args[name] = strings.TrimSpace(text)
		}
	}
	b, _ := json.Marshal(args)
	return string(b)
}

// writeToolCall answers with one tool call, as JSON or SSE.
func writeToolCall(w http.ResponseWriter, in *fakeChatRequest, name, args string) {
	call := map[string]any{"index": 0, "id": "call_demo_1", "type": "function", "function": map[string]string{"name": name, "arguments": args}}
	usage := map[string]int{"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
	if !in.Stream {
		writeJSON(w, map[string]any{
			"id": "chatcmpl-demo", "object": "chat.completion", "created": 1790000000, "model": in.Model,
			"choices": []map[string]any{{"index": 0, "finish_reason": "tool_calls",
				"message": map[string]any{"role": "assistant", "content": nil, "tool_calls": []any{call}}}},
			"usage": usage,
		})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	chunk := func(delta map[string]any, finish any) map[string]any {
		return map[string]any{"id": "chatcmpl-demo", "object": "chat.completion.chunk", "created": 1790000000, "model": in.Model,
			"choices": []map[string]any{{"index": 0, "delta": delta, "finish_reason": finish}}}
	}
	chunks := []map[string]any{chunk(map[string]any{"role": "assistant", "tool_calls": []any{call}}, nil), chunk(map[string]any{}, "tool_calls")}
	if in.StreamOptions != nil && in.StreamOptions.IncludeUsage {
		chunks = append(chunks, map[string]any{"id": "chatcmpl-demo", "object": "chat.completion.chunk", "created": 1790000000,
			"model": in.Model, "choices": []any{}, "usage": usage})
	}
	for _, c := range chunks {
		b, _ := json.Marshal(c)
		_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
	}
	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}
