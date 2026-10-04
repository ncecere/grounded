package llm

import (
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"
)

// thinkingText joins the message's thinking blocks.
func thinkingText(msg AssistantMessage) string {
	var b strings.Builder
	for _, bl := range msg.Content {
		if th, ok := bl.(Thinking); ok {
			b.WriteString(th.Text)
		}
	}
	return b.String()
}

// splitContent sends s as content deltas of n bytes.
func splitContent(s string, n int) []string {
	var out []string
	for i := 0; i < len(s); i += n {
		out = append(out, content(s[i:min(i+n, len(s))]))
	}
	return out
}

// TestThinkTagsInContent (v0.4.2 BU-02): reasoning written in the answer
// text never reaches it, whatever the chunking: tagged reasoning becomes
// thinking, and a bare </think> (Qwen3 reasoning with thinking off, after a
// tool result) turns the text before it into thinking, so the answer is
// shown once and without the tag.
func TestThinkTagsInContent(t *testing.T) {
	cases := []struct {
		name, in, text, thinking string
		blocks                   []string
		retracted                bool
	}{
		{"bare closing tag", "Email is fine [3].\n</think>\n\nEmail is fine [3].", "Email is fine [3].", "Email is fine [3].",
			[]string{"thinking", "text"}, true},
		{"tagged reasoning first", "<think>\nCheck the outage tool.\n</think>\n\nNo outage [1].", "No outage [1].", "Check the outage tool.",
			[]string{"thinking", "text"}, false},
		{"no tags", "A < b, and <thin client> stays.", "A < b, and <thin client> stays.", "", []string{"text"}, false},
		{"a partial tag at the end is text", "Use the tag <thi", "Use the tag <thi", "", []string{"text"}, false},
		{"unclosed reasoning", "<think>Still thinking", "", "Still thinking", []string{"thinking"}, false},
	}
	for _, c := range cases {
		for n := 1; n <= 12; n++ {
			rec := newRecorder(t, sseHandler(sse(append(splitContent(c.in, n), finish("stop"))...)))
			evs := stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{})
			done := terminal(evs)
			if done.Type != EventDone {
				t.Fatalf("%s/%d: terminal = %s", c.name, n, done.Type)
			}
			msg := done.Message
			if msg.Text() != c.text || strings.TrimSpace(thinkingText(msg)) != c.thinking {
				t.Fatalf("%s/%d: text %q thinking %q", c.name, n, msg.Text(), thinkingText(msg))
			}
			var types []string
			for _, b := range msg.Content {
				if len(types) == 0 || types[len(types)-1] != b.BlockType() {
					types = append(types, b.BlockType())
				}
			}
			if !reflect.DeepEqual(types, c.blocks) {
				t.Fatalf("%s/%d: blocks = %v", c.name, n, types)
			}
			// The deltas a consumer adds up (dropping them at text_to_thinking) give the final text.
			var sb strings.Builder
			retracted := false
			for _, e := range evs {
				switch e.Type {
				case EventTextDelta:
					if strings.Contains(e.Delta, "think>") {
						t.Fatalf("%s/%d: a text delta carries a tag: %q", c.name, n, e.Delta)
					}
					sb.WriteString(e.Delta)
				case EventTextToThinking:
					retracted = true
					sb.Reset()
				}
			}
			if sb.String() != c.text || retracted != c.retracted {
				t.Fatalf("%s/%d: deltas %q (retracted %v)", c.name, n, sb.String(), retracted)
			}
		}
	}
}

// A reasoning field and a bare </think> in content: both end up as thinking.
func TestThinkTagWithReasoningField(t *testing.T) {
	chunks := []string{delta(`{"reasoning_content":"plan"}`), content("Draft."), content("</thi"), content("nk>Answer."), finish("stop")}
	rec := newRecorder(t, sseHandler(sse(chunks...)))
	done := terminal(stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{}))
	if done.Message.Text() != "Answer." || thinkingText(done.Message) != "planDraft." {
		t.Fatalf("text %q thinking %q", done.Message.Text(), thinkingText(done.Message))
	}
}

// A non-streamed response is split the same way.
func TestThinkTagNonStreamed(t *testing.T) {
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c1","choices":[{"message":{"content":"Draft.\n</think>\n\nThe answer."},"finish_reason":"stop"}]}`))
	})
	done := terminal(stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{}))
	if done.Message.Text() != "The answer." || strings.TrimSpace(thinkingText(done.Message)) != "Draft." {
		t.Fatalf("message = %+v", done.Message)
	}
}
