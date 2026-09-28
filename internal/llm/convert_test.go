package llm

import (
	"encoding/json"
	"testing"
)

func toJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestConvertMessages(t *testing.T) {
	m := testModel()
	c := Context{
		SystemPrompt: "sys",
		Messages: []Message{
			UserMessage{Content: "first question"},
			AssistantMessage{StopReason: StopReasonToolUse, Content: []Block{
				Thinking{Text: "private reasoning"},
				Text{Text: "Searching."},
				ToolCall{ID: "a", Name: "search_knowledge", Arguments: json.RawMessage(`{"query":"x"}`)},
				ToolCall{ID: "b", Name: "search_knowledge", Arguments: json.RawMessage(`"{broken"`)},
			}},
			ToolResultMessage{ToolCallID: "a", ToolName: "search_knowledge", Content: "<sources/>", Details: map[string]int{"hits": 3}},
			ToolResultMessage{ToolCallID: "zzz", Content: "orphan, dropped"},
			ToolResultMessage{ToolCallID: "a", Content: "duplicate, dropped"},
			// b has no result: a placeholder is added.
			AssistantMessage{StopReason: StopReasonStop, Content: []Block{Thinking{Text: "t"}, Text{Text: "Answer [1]."}}},
			UserMessage{Content: "follow-up"},
			// Aborted with a partial tool call: text kept, call dropped.
			AssistantMessage{StopReason: StopReasonAborted, Content: []Block{
				Text{Text: "Partial"}, ToolCall{ID: "c", Name: "search_knowledge"},
			}},
			ToolResultMessage{ToolCallID: "c", Content: "dropped: its call was not sent"},
			// Errored with nothing useful: skipped.
			AssistantMessage{StopReason: StopReasonError, Content: []Block{Thinking{Text: "only thinking"}}},
			UserMessage{Content: ""}, // empty user messages are skipped
			UserMessage{Content: "again"},
			AssistantMessage{StopReason: StopReasonToolUse, Content: []Block{ToolCall{ID: "d", Name: "f"}}},
		},
	}
	got := toJSON(t, convertMessages(m, c))
	want := `[{"role":"system","content":"sys"},` +
		`{"role":"user","content":"first question"},` +
		`{"role":"assistant","content":"Searching.","tool_calls":[` +
		`{"id":"a","type":"function","function":{"name":"search_knowledge","arguments":"{\"query\":\"x\"}"}},` +
		`{"id":"b","type":"function","function":{"name":"search_knowledge","arguments":"{broken"}}]},` +
		`{"role":"tool","content":"\u003csources/\u003e","tool_call_id":"a"},` +
		`{"role":"tool","content":"No result provided","tool_call_id":"b"},` +
		`{"role":"assistant","content":"Answer [1]."},` +
		`{"role":"user","content":"follow-up"},` +
		`{"role":"assistant","content":"Partial"},` +
		`{"role":"user","content":"again"},` +
		`{"role":"assistant","content":null,"tool_calls":[{"id":"d","type":"function","function":{"name":"f","arguments":"{}"}}]},` +
		`{"role":"tool","content":"No result provided","tool_call_id":"d"}]`
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}

	// Developer role; empty tool output placeholder.
	m.Compat.SupportsDeveloperRole = true
	got = toJSON(t, convertMessages(m, Context{SystemPrompt: "sys", Messages: []Message{
		AssistantMessage{StopReason: StopReasonToolUse, Content: []Block{ToolCall{ID: "x", Name: "f", Arguments: json.RawMessage(`{}`)}}},
		ToolResultMessage{ToolCallID: "x"},
	}}))
	want = `[{"role":"developer","content":"sys"},{"role":"assistant","content":null,"tool_calls":[{"id":"x","type":"function","function":{"name":"f","arguments":"{}"}}]},{"role":"tool","content":"(no tool output)","tool_call_id":"x"}]`
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
}

func TestBuildRequestCompat(t *testing.T) {
	temp := 0.2
	tools := []Tool{{Name: "f"}}
	c := Context{Messages: []Message{UserMessage{Content: "q"}}, Tools: tools}
	opts := Options{Temperature: &temp, MaxTokens: 10000, ReasoningEffort: "low", User: "grounded-t-a", ToolChoice: ToolChoiceRequired}

	// Defaults: max_tokens (clamped), usage in stream, no reasoning_effort, no tool_choice.
	body := buildRequest(testModel(), c, opts, true)
	if body["max_tokens"] != 4096 || body["temperature"] != 0.2 || body["user"] != "grounded-t-a" {
		t.Fatalf("body = %v", body)
	}
	for _, k := range []string{"reasoning_effort", "tool_choice", "max_completion_tokens"} {
		if _, ok := body[k]; ok {
			t.Errorf("%s sent by default", k)
		}
	}
	if body["stream_options"] == nil {
		t.Error("stream_options missing")
	}
	if got := toJSON(t, body["tools"]); got != `[{"type":"function","function":{"name":"f","parameters":{"type":"object","properties":{}}}}]` {
		t.Errorf("tools = %s", got)
	}

	// Everything switched on.
	m := testModel()
	m.MaxOutputTokens = 0
	m.Compat = Compat{SupportsReasoningEffort: true, SupportsToolChoice: true, MaxTokensField: "max_completion_tokens"}
	body = buildRequest(m, c, opts, true)
	if body["max_completion_tokens"] != 10000 || body["reasoning_effort"] != "low" || body["tool_choice"] != "required" {
		t.Fatalf("body = %v", body)
	}
	if _, ok := body["stream_options"]; ok {
		t.Error("stream_options sent although SupportsStreamUsage is false")
	}

	// tool_choice needs tools; zero options are omitted; empty field name falls back.
	m.Compat.MaxTokensField = ""
	body = buildRequest(m, Context{}, Options{ToolChoice: ToolChoiceRequired, MaxTokens: 5}, false)
	for _, k := range []string{"tool_choice", "tools", "temperature", "user", "reasoning_effort", "stream_options"} {
		if _, ok := body[k]; ok {
			t.Errorf("%s should be omitted: %v", k, body)
		}
	}
	if body["max_tokens"] != 5 || body["stream"] != false {
		t.Errorf("body = %v", body)
	}
}

func TestWireArguments(t *testing.T) {
	for in, want := range map[string]string{
		"":            "{}",
		"null":        "{}",
		`{"a":1}`:     `{"a":1}`,
		`"raw {text"`: "raw {text",
		`"bad escape`: `"bad escape`,
		`[1,2]`:       `[1,2]`,
	} {
		if got := wireArguments(json.RawMessage(in)); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
}

func TestParseArguments(t *testing.T) {
	for in, want := range map[string]string{
		"":                       `{}`,
		"  ":                     `{}`,
		"{\n  \"q\": \"a b\"\n}": `{"q":"a b"}`,
		`{"q":`:                  `"{\"q\":"`,
	} {
		if got := string(parseArguments(in)); got != want {
			t.Errorf("%q -> %s, want %s", in, got, want)
		}
	}
}
