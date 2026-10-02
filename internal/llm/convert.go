package llm

import (
	"encoding/json"
	"strings"

	"github.com/ncecere/grounded/internal/gateway"
)

// Wire format for OpenAI chat completions.

type wireMessage struct {
	Role       string         `json:"role"`
	Content    any            `json:"content"` // string, or nil for an assistant message with only tool calls
	ToolCalls  []wireToolCall `json:"tool_calls,omitempty"`
	ToolCallID string         `json:"tool_call_id,omitempty"`
}

type wireToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function wireFunction `json:"function"`
}

type wireFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type wireTool struct {
	Type     string          `json:"type"`
	Function wireToolFuncDef `json:"function"`
}

type wireToolFuncDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters"`
}

const noResultText = "No result provided"

// convertMessages turns the context into OpenAI messages:
//   - the system prompt uses role "developer" when compat allows, else "system";
//   - thinking blocks are never sent back;
//   - assistant messages that ended in error or aborted keep their text but
//     drop their (possibly incomplete) tool calls;
//   - every sent tool call gets exactly one "tool" message: orphaned results
//     are dropped and missing ones are filled with an error placeholder, since
//     providers reject either mismatch.
func convertMessages(m Model, c Context) []wireMessage {
	out := make([]wireMessage, 0, len(c.Messages)+1)
	if c.SystemPrompt != "" {
		role := "system"
		if m.Compat.SupportsDeveloperRole {
			role = "developer"
		}
		out = append(out, wireMessage{Role: role, Content: c.SystemPrompt})
	}

	var pending []ToolCall        // tool calls of the last assistant message
	answered := map[string]bool{} // their IDs that have a result
	closePending := func() {
		for _, tc := range pending {
			if !answered[tc.ID] {
				out = append(out, wireMessage{Role: "tool", ToolCallID: tc.ID, Content: noResultText})
			}
		}
		pending, answered = nil, map[string]bool{}
	}

	for _, msg := range c.Messages {
		switch msg := msg.(type) {
		case UserMessage:
			closePending()
			if msg.Content != "" {
				out = append(out, wireMessage{Role: "user", Content: msg.Content})
			}
		case AssistantMessage:
			closePending()
			wm, calls := assistantWire(msg)
			pending = append(pending, calls...)
			if wm.Content == nil && len(wm.ToolCalls) == 0 {
				continue
			}
			out = append(out, wm)
		case ToolResultMessage:
			if answered[msg.ToolCallID] || !hasCall(pending, msg.ToolCallID) {
				continue
			}
			answered[msg.ToolCallID] = true
			content := msg.Content
			if content == "" {
				content = "(no tool output)"
			}
			out = append(out, wireMessage{Role: "tool", ToolCallID: msg.ToolCallID, Content: content})
		}
	}
	closePending()
	return out
}

// assistantWire converts an assistant message: its text, and its tool calls
// (returned too) unless it ended in error or was aborted.
func assistantWire(msg AssistantMessage) (wireMessage, []ToolCall) {
	wm := wireMessage{Role: "assistant"}
	var text strings.Builder
	for _, b := range msg.Content {
		if t, ok := b.(Text); ok {
			text.WriteString(t.Text)
		}
	}
	if strings.TrimSpace(text.String()) != "" {
		wm.Content = text.String()
	}
	var calls []ToolCall
	if msg.StopReason != StopReasonError && msg.StopReason != StopReasonAborted {
		for _, tc := range msg.ToolCalls() {
			wm.ToolCalls = append(wm.ToolCalls, wireToolCall{
				ID: tc.ID, Type: "function",
				Function: wireFunction{Name: tc.Name, Arguments: wireArguments(tc.Arguments)},
			})
			calls = append(calls, tc)
		}
	}
	return wm, calls
}

func hasCall(calls []ToolCall, id string) bool {
	for _, tc := range calls {
		if tc.ID == id {
			return true
		}
	}
	return false
}

// wireArguments renders stored arguments as the JSON text the API expects. A
// JSON string holds raw text that did not parse; it is sent back verbatim.
func wireArguments(args json.RawMessage) string {
	if len(args) == 0 || string(args) == "null" {
		return "{}"
	}
	if args[0] == '"' {
		var s string
		if json.Unmarshal(args, &s) == nil {
			return s
		}
	}
	return string(args)
}

var emptyObjectSchema = json.RawMessage(`{"type":"object","properties":{}}`)

func convertTools(tools []Tool) []wireTool {
	out := make([]wireTool, len(tools))
	for i, t := range tools {
		params := t.Parameters
		if len(params) == 0 {
			params = emptyObjectSchema
		}
		out[i] = wireTool{Type: "function", Function: wireToolFuncDef{Name: t.Name, Description: t.Description, Parameters: params}}
	}
	return out
}

// buildRequest assembles the chat completion request body.
func buildRequest(m Model, c Context, o Options, stream bool) map[string]any {
	body := map[string]any{
		"model":    m.ID,
		"messages": convertMessages(m, c),
		"stream":   stream,
	}
	if stream && m.Compat.SupportsStreamUsage {
		body["stream_options"] = map[string]any{"include_usage": true}
	}
	if n := o.MaxTokens; n > 0 {
		if m.MaxOutputTokens > 0 && n > m.MaxOutputTokens {
			n = m.MaxOutputTokens
		}
		field := m.Compat.MaxTokensField
		if field == "" {
			field = "max_tokens"
		}
		body[field] = n
	}
	if o.Temperature != nil {
		body["temperature"] = *o.Temperature
	}
	if len(c.Tools) > 0 {
		body["tools"] = convertTools(c.Tools)
		if o.ToolChoice != "" && m.Compat.SupportsToolChoice {
			body["tool_choice"] = o.ToolChoice
		}
	}
	switch {
	case o.ReasoningEffort == EffortOff:
		thinkingOff(body, m.Compat)
	case o.ReasoningEffort != "" && m.Compat.SupportsReasoningEffort:
		body["reasoning_effort"] = o.ReasoningEffort
	}
	if o.User != "" {
		body["user"] = o.User
	}
	gateway.MergeExtra(body, m.Compat.ExtraBody)
	return body
}

// thinkingOff turns thinking off the way the model's compatibility says
// (nothing when it has no way): reasoning_effort "none", or
// chat_template_kwargs.enable_thinking false, kept with the other template
// arguments of its extraBody.
func thinkingOff(body map[string]any, c Compat) {
	switch c.ThinkingOff {
	case ThinkingOffEffortNone:
		body["reasoning_effort"] = "none"
	case ThinkingOffTemplateKwarg:
		kw := map[string]any{}
		if extra, ok := c.ExtraBody["chat_template_kwargs"].(map[string]any); ok {
			for k, v := range extra {
				kw[k] = v
			}
		}
		kw["enable_thinking"] = false
		body["chat_template_kwargs"] = kw
	}
}
