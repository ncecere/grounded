package llm

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestMessageJSONRoundTrip(t *testing.T) {
	msgs := []Message{
		UserMessage{Content: "hi"},
		AssistantMessage{
			Content: []Block{
				Thinking{Text: "hmm"}, Text{Text: "Answer [1]"},
				ToolCall{ID: "c1", Name: "search_knowledge", Arguments: json.RawMessage(`{"query":"x"}`)},
				ToolCall{ID: "c2", Name: "partial"}, // nil arguments marshal as null
			},
			Model: "m", ResponseID: "r", Usage: Usage{Input: 1, Output: 2, Reasoning: 1, Total: 3},
			StopReason: StopReasonAborted, ErrorMessage: "Request was aborted", ErrorKind: "unavailable",
		},
		ToolResultMessage{ToolCallID: "c1", ToolName: "search_knowledge", Content: "No results.", Details: map[string]any{"hitCount": float64(0)}, IsError: true},
		AssistantMessage{StopReason: StopReasonStop},
	}
	for _, m := range msgs {
		raw, err := json.Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		back, err := UnmarshalMessage(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if a, ok := m.(AssistantMessage); ok {
			for i, b := range a.Content {
				if tc, ok := b.(ToolCall); ok && tc.Arguments == nil {
					tc.Arguments = json.RawMessage("null")
					a.Content[i] = tc
				}
			}
			if a.Content == nil {
				a.Content = []Block{}
			}
			m = a
			if back.(AssistantMessage).Content == nil {
				bm := back.(AssistantMessage)
				bm.Content = []Block{}
				back = bm
			}
		}
		if !reflect.DeepEqual(m, back) {
			t.Errorf("round trip:\n%#v\n%#v\n%s", m, back, raw)
		}
		if back.MessageRole() != m.MessageRole() {
			t.Errorf("role %s vs %s", back.MessageRole(), m.MessageRole())
		}
	}

	raw, _ := json.Marshal(msgs[1])
	want := `{"role":"assistant","content":[{"type":"thinking","text":"hmm"},{"type":"text","text":"Answer [1]"},` +
		`{"type":"toolCall","id":"c1","name":"search_knowledge","arguments":{"query":"x"}},{"type":"toolCall","id":"c2","name":"partial","arguments":null}],` +
		`"model":"m","responseId":"r","usage":{"input":1,"output":2,"reasoning":1,"cacheRead":0,"cacheWrite":0,"total":3},` +
		`"stopReason":"aborted","errorMessage":"Request was aborted","errorKind":"unavailable"}`
	if string(raw) != want {
		t.Errorf("assistant json:\n%s\nwant\n%s", raw, want)
	}
}

func TestUnmarshalErrors(t *testing.T) {
	for _, in := range []string{
		`{"role":"system"}`,
		`not json`,
		`{"role":"assistant","content":[{"type":"image"}]}`,
		`{"role":"assistant","content":"text"}`,
		`{"role":"user","content":5}`,
		`{"role":"toolResult","isError":"yes"}`,
	} {
		if _, err := UnmarshalMessage([]byte(in)); err == nil {
			t.Errorf("%s: expected error", in)
		}
	}
	if _, err := UnmarshalBlocks([]byte(`[1]`)); err == nil {
		t.Error("expected error for a non-object block")
	}
	var a AssistantMessage
	if err := json.Unmarshal([]byte(`[]`), &a); err == nil {
		t.Error("expected error for a non-object assistant message")
	}
}

func TestAssistantHelpers(t *testing.T) {
	m := AssistantMessage{Content: []Block{Thinking{Text: "a"}, Text{Text: "b"}, Thinking{Text: "c"}, Text{Text: "d"}, ToolCall{ID: "x"}}}
	if m.Text() != "bd" || m.Thinking() != "ac" || len(m.ToolCalls()) != 1 {
		t.Fatalf("helpers: %q %q %v", m.Text(), m.Thinking(), m.ToolCalls())
	}
	c := m.Clone()
	c.Content[0] = Text{Text: "changed"}
	if m.Content[0].(Thinking).Text != "a" {
		t.Error("Clone shares content")
	}
}

func TestResolveCompat(t *testing.T) {
	def := DecodeCompat(nil)
	want := Compat{SupportsStreamUsage: true, MaxTokensField: "max_tokens"}
	if !reflect.DeepEqual(def, want) {
		t.Fatalf("defaults = %+v", def)
	}
	if !reflect.DeepEqual(DecodeCompat(json.RawMessage(`{bad`)), want) {
		t.Error("invalid JSON must give defaults")
	}
	all := DecodeCompat(json.RawMessage(`{"supportsDeveloperRole":true,"supportsReasoningEffort":true,"supportsStreamUsage":false,
		"maxTokensField":"max_completion_tokens","supportsToolChoice":true,"thinkingField":"reasoning",
		"extraBody":{"chat_template_kwargs":{"enable_thinking":false}}}`))
	want = Compat{true, true, false, "max_completion_tokens", true, "reasoning",
		map[string]any{"chat_template_kwargs": map[string]any{"enable_thinking": false}}}
	if !reflect.DeepEqual(all, want) {
		t.Fatalf("all = %+v", all)
	}
	// Unknown enum values fall back to the defaults.
	odd := DecodeCompat(json.RawMessage(`{"maxTokensField":"nope","thinkingField":"nope"}`))
	if odd.MaxTokensField != "max_tokens" || odd.ThinkingField != "" {
		t.Fatalf("odd = %+v", odd)
	}
}

func TestModelFromRow(t *testing.T) {
	cw, mo := int32(131072), int32(8192)
	m := ModelFromRow(dbgen.Model{UpstreamModel: "gpt-oss-120b", ContextWindow: &cw, MaxOutputTokens: &mo, SupportsTools: true,
		Compat: json.RawMessage(`{"supportsReasoningEffort":true}`)})
	if m.ID != "gpt-oss-120b" || m.ContextWindow != 131072 || m.MaxOutputTokens != 8192 || !m.SupportsTools || !m.Compat.SupportsReasoningEffort || !m.Compat.SupportsStreamUsage {
		t.Fatalf("model = %+v", m)
	}
	if m := ModelFromRow(dbgen.Model{UpstreamModel: "x"}); m.ContextWindow != 0 || m.MaxOutputTokens != 0 || m.Compat.MaxTokensField != "max_tokens" {
		t.Fatalf("model = %+v", m)
	}
	if UserTag("registrar", "helper") != "grounded-registrar-helper" {
		t.Error("user tag")
	}
}
