package llm

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Streams recorded from qwen3.8-27b on SGLang (docs/benchmarks/spark-models.md
// §3.1): reasoning in reasoning_content, a whitespace-only "\n\n" content
// delta before the answer and before the tool call, and reasoning tokens at
// the top level of usage.

// noBlankText fails when a text block is empty or whitespace-only, or an
// answer starts with whitespace.
func noBlankText(t *testing.T, msg AssistantMessage) {
	t.Helper()
	for i, b := range msg.Content {
		if tx, ok := b.(Text); ok && strings.TrimSpace(tx.Text) == "" {
			t.Errorf("block %d is a blank text block %q", i, tx.Text)
		}
	}
	if txt := msg.Text(); txt != strings.TrimLeft(txt, " \t\r\n") {
		t.Errorf("text starts with whitespace: %q", txt[:min(len(txt), 20)])
	}
}

func blockTypes(msg AssistantMessage) []string {
	out := make([]string, len(msg.Content))
	for i, b := range msg.Content {
		out[i] = b.BlockType()
	}
	return out
}

func TestRecordedQwenTextStream(t *testing.T) {
	rec := newRecorder(t, sseHandler(fixture(t, "qwen3827b_text.sse")))
	evs := stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{})
	done := terminal(evs)
	if done.Type != EventDone || done.Reason != StopReasonStop {
		t.Fatalf("terminal = %s %s %s", done.Type, done.Reason, done.Message.ErrorMessage)
	}
	msg := done.Message
	if got := blockTypes(msg); !reflect.DeepEqual(got, []string{"thinking", "text"}) {
		t.Fatalf("blocks = %v", got)
	}
	noBlankText(t, msg)
	if !strings.HasPrefix(msg.Text(), "Drop/add ends") || !strings.HasSuffix(msg.Text(), "[1].") {
		t.Errorf("text = %q", msg.Text())
	}
	if msg.Usage.Reasoning != 176 || msg.Usage.Output != 205 || msg.Usage.Input != 197 || msg.Usage.Total != 402 {
		t.Errorf("usage = %+v", msg.Usage)
	}
	// Deltas still add up to the final text; no delta event is whitespace-only.
	var sb strings.Builder
	for _, e := range evs {
		if e.Type == EventTextDelta {
			if strings.TrimSpace(e.Delta) == "" && sb.Len() == 0 {
				t.Errorf("leading whitespace delta %q", e.Delta)
			}
			sb.WriteString(e.Delta)
		}
	}
	if sb.String() != msg.Text() {
		t.Errorf("deltas %q != text %q", sb.String(), msg.Text())
	}
}

func TestRecordedQwenToolCallStream(t *testing.T) {
	rec := newRecorder(t, sseHandler(fixture(t, "qwen3827b_toolcall.sse")))
	evs := stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}, Tools: []Tool{{Name: "search_knowledge"}}}, Options{})
	done := terminal(evs)
	if done.Type != EventDone || done.Reason != StopReasonToolUse {
		t.Fatalf("terminal = %s %s", done.Type, done.Reason)
	}
	msg := done.Message
	// The "\n\n" before the call no longer becomes a text block.
	if got := blockTypes(msg); !reflect.DeepEqual(got, []string{"thinking", "toolCall"}) {
		t.Fatalf("blocks = %v", got)
	}
	for _, e := range evs {
		if e.Type == EventTextStart {
			t.Error("a text block was started")
		}
	}
	calls := msg.ToolCalls()
	if len(calls) != 1 || calls[0].Name != "search_knowledge" || string(calls[0].Arguments) != `{"query":"drop add deadline end date"}` {
		t.Fatalf("calls = %+v", calls)
	}
	if msg.Usage.Reasoning != 30 || msg.Usage.Output != 61 {
		t.Errorf("usage = %+v", msg.Usage)
	}
}

func TestRecordedQwenToolResultStream(t *testing.T) {
	rec := newRecorder(t, sseHandler(fixture(t, "qwen3827b_toolresult.sse")))
	done := terminal(stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{}))
	if done.Type != EventDone || done.Reason != StopReasonStop {
		t.Fatalf("terminal = %s %s", done.Type, done.Reason)
	}
	noBlankText(t, done.Message)
	if got := blockTypes(done.Message); !reflect.DeepEqual(got, []string{"thinking", "text"}) {
		t.Fatalf("blocks = %v", got)
	}
	if done.Message.Usage.Reasoning != 51 {
		t.Errorf("usage = %+v", done.Message.Usage)
	}
}

func content(s string) string {
	b, _ := json.Marshal(s)
	return delta(`{"content":` + string(b) + `}`)
}

func TestWhitespaceDeltas(t *testing.T) {
	thinking := delta(`{"reasoning_content":"hmm"}`)
	cases := []struct {
		name   string
		chunks []string
		blocks []string
		text   string
	}{
		{"leading blank deltas dropped", []string{content("\n\n"), content(" "), content("Answer")}, []string{"text"}, "Answer"},
		{"leading space of the first text trimmed", []string{content("\n\n  Answer"), content(" here")}, []string{"text"}, "Answer here"},
		{"whitespace inside the answer kept", []string{content("A"), content("\n\n"), content("  - b"), content("\n")}, []string{"text"}, "A\n\n  - b\n"},
		{"only whitespace: no block", []string{thinking, content("\n\n")}, []string{"thinking"}, ""},
		{"blank delta doesn't end thinking", []string{thinking, content("\n"), thinking, content("Hi")}, []string{"thinking", "text"}, "Hi"},
		{"separator kept after earlier text", []string{content("One."), thinking, content("\n\n"), content("Two.")}, []string{"text", "thinking", "text"}, "One.\n\nTwo."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := newRecorder(t, sseHandler(sse(append(c.chunks, finish("stop"))...)))
			done := terminal(stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{}))
			if got := blockTypes(done.Message); !reflect.DeepEqual(got, c.blocks) {
				t.Fatalf("blocks = %v", got)
			}
			if done.Message.Text() != c.text {
				t.Errorf("text = %q, want %q", done.Message.Text(), c.text)
			}
		})
	}
}

func TestWhitespaceNonStreamed(t *testing.T) {
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c1","choices":[{"message":{"content":"\n\nThe answer."},"finish_reason":"stop"}],` +
			`"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7,"reasoning_tokens":2}}`))
	})
	done := terminal(stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{}))
	if done.Message.Text() != "The answer." || done.Message.Usage.Reasoning != 2 {
		t.Fatalf("message = %+v", done.Message)
	}
}

func TestReasoningTokenFields(t *testing.T) {
	for raw, want := range map[string]int{
		`{"completion_tokens":9,"completion_tokens_details":{"reasoning_tokens":4}}`:                      4,
		`{"completion_tokens":9,"reasoning_tokens":5}`:                                                    5,
		`{"completion_tokens":9,"reasoning_tokens":5,"completion_tokens_details":{"reasoning_tokens":4}}`: 4,
		`{"completion_tokens":9,"completion_tokens_details":null}`:                                        0,
	} {
		var u wireUsage
		if err := json.Unmarshal([]byte(raw), &u); err != nil {
			t.Fatal(err)
		}
		if got := u.usage().Reasoning; got != want {
			t.Errorf("%s: reasoning = %d, want %d", raw, got, want)
		}
	}
}
