package agents

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf16"

	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// storedAnswer is a stored assistant row with these content blocks.
func storedAnswer(t *testing.T, blocks ...llm.Block) dbgen.ListMessagesRow {
	t.Helper()
	content, err := json.Marshal(blocks)
	if err != nil {
		t.Fatal(err)
	}
	return dbgen.ListMessagesRow{Role: "assistant", Content: content}
}

// thinkingBefore is what each tool call says came before it.
func thinkingBefore(m MessageView) []int {
	out := []int{}
	for _, c := range m.ToolCalls {
		out = append(out, c.ThinkingBefore)
	}
	return out
}

// thinkingUpTo is the joined thinking of the blocks before the n-th tool call.
func thinkingUpTo(blocks []llm.Block, n int) string {
	var think []string
	for _, b := range blocks {
		switch v := b.(type) {
		case llm.Thinking:
			think = append(think, v.Text)
		case llm.ToolCall:
			if n == 0 {
				return strings.Join(think, "\n\n")
			}
			n--
		}
	}
	return strings.Join(think, "\n\n")
}

func TestAssistantViewThinkingBefore(t *testing.T) {
	call := func(id string) llm.ToolCall {
		return llm.ToolCall{ID: id, Name: "search_knowledge", Arguments: json.RawMessage(`{"query":"q"}`)}
	}
	cases := []struct {
		name     string
		blocks   []llm.Block
		thinking string
		want     []int
	}{
		{"a call before any thinking", []llm.Block{call("c1"), llm.Thinking{Text: "after"}, llm.Text{Text: "A."}}, "after", []int{0}},
		{"thinking, a call, thinking", []llm.Block{llm.Thinking{Text: "First."}, call("c1"), llm.Thinking{Text: "Then."}, llm.Text{Text: "A."}},
			"First.\n\nThen.", []int{6}},
		{"two calls in one turn", []llm.Block{llm.Thinking{Text: "Look."}, call("c1"), call("c2"), llm.Thinking{Text: "Done."}}, "Look.\n\nDone.", []int{5, 5}},
		{"calls in two turns", []llm.Block{llm.Thinking{Text: "One."}, call("c1"), llm.Thinking{Text: "Two."}, call("c2"), llm.Thinking{Text: "Three."}},
			"One.\n\nTwo.\n\nThree.", []int{4, 10}},
		// "Café ☕ 𝄞" is 9 UTF-16 code units (the clef is a surrogate pair) but 14 bytes.
		{"non-ASCII thinking", []llm.Block{llm.Thinking{Text: "Café ☕ 𝄞"}, call("c1"), llm.Thinking{Text: "über"}, call("c2")},
			"Café ☕ 𝄞\n\nüber", []int{9, 15}},
		{"an empty thinking block", []llm.Block{llm.Thinking{Text: ""}, call("c1"), llm.Thinking{Text: "x"}, call("c2")}, "\n\nx", []int{0, 3}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := assistantView(storedAnswer(t, tc.blocks...))
			if m.Thinking != tc.thinking {
				t.Fatalf("thinking = %q, want %q", m.Thinking, tc.thinking)
			}
			got := thinkingBefore(m)
			if len(got) != len(tc.want) {
				t.Fatalf("thinkingBefore = %v, want %v", got, tc.want)
			}
			units := utf16.Encode([]rune(m.Thinking))
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("thinkingBefore = %v, want %v", got, tc.want)
				}
				// The offset slices the thinking as a browser would: the part before the call ends there.
				if before := string(utf16.Decode(units[:got[i]])); before != thinkingUpTo(tc.blocks, i) {
					t.Fatalf("thinking before call %d = %q", i, before)
				}
			}
		})
	}
}

func TestAssistantViewThinkingBeforeInJSON(t *testing.T) {
	m := assistantView(storedAnswer(t, llm.Thinking{Text: "Plan."}, llm.ToolCall{ID: "c1", Name: "check_outage"}, llm.Text{Text: "A."}))
	b, err := json.Marshal(m.ToolCalls[0])
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got["thinkingBefore"] != float64(5) {
		t.Fatalf("thinkingBefore = %v in %s", got["thinkingBefore"], b)
	}
}
