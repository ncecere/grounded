package agents

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/llm"
)

func TestNeedsContext(t *testing.T) {
	for q, want := range map[string]bool{
		"And for a second copy?":                                             true, // conjunction-led and short
		"How much does it cost?":                                             true,
		"What about the fee for students who graduated long ago?":            true,
		"How about ordering one online instead of in person?":                true,
		"Can I pay for the transcript order by card instead of by check?":    false, // long, names its subject
		"Can I pay for it with a credit card at the front desk?":             true,  // refers back with "it"
		"Where do students pick up their parking permits this fall term?":    true,  // "their", "this"
		"How do I request an official transcript from the registrar office?": false,
		"What are the library hours during the finals week on campus?":       false,
		"": false,
	} {
		if got := needsContext(q); got != want {
			t.Errorf("needsContext(%q) = %v, want %v", q, got, want)
		}
	}
}

func TestContextualQuery(t *testing.T) {
	hist := []llm.Message{
		llm.UserMessage{Content: "How do I request an official transcript?"},
		llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "Order it online [1]."}}},
		llm.UserMessage{Content: "How much does it cost?"},
		llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "Ten dollars [1]."}}},
	}
	// The third turn: back to the last question that stands on its own.
	if got := contextualQuery(hist, "And for a second copy?"); got != "How do I request an official transcript? How much does it cost? And for a second copy?" {
		t.Errorf("third turn = %q", got)
	}
	if got := contextualQuery(hist[:2], "And for a second copy?"); got != "How do I request an official transcript? And for a second copy?" {
		t.Errorf("second turn = %q", got)
	}
	clear := "What are the library hours during the finals week on campus?"
	if got := contextualQuery(hist, clear); got != clear {
		t.Errorf("a clear question changed: %q", got)
	}
	if got := contextualQuery(nil, "And for a second copy?"); got != "And for a second copy?" {
		t.Errorf("no history = %q", got)
	}
}

func TestRewriteHelpers(t *testing.T) {
	for in, want := range map[string]string{
		"  \"How much is a second transcript?\"  ":     "How much is a second transcript?",
		"Query: transcript fee second copy\nBecause …": "transcript fee second copy",
		"“fees”": "fees",
	} {
		if got := cleanRewrite(in); got != want {
			t.Errorf("cleanRewrite(%q) = %q, want %q", in, got, want)
		}
	}
	if !sameQuery("and for a second copy", "And for a  second copy?") || sameQuery("second transcript cost", "And for a second copy?") {
		t.Error("sameQuery")
	}
	long := strings.Repeat("word ", 1000)
	hist := []llm.Message{}
	for i := 0; i < 5; i++ {
		hist = append(hist, llm.UserMessage{Content: "q"}, llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: long}}})
	}
	msgs := rewriteContext(hist, "And then?")
	if len(msgs) != rewriteTurns+1 || msgs[len(msgs)-1].(llm.UserMessage).Content != "And then?" {
		t.Fatalf("context = %d messages", len(msgs))
	}
	for _, m := range msgs {
		if a, ok := m.(llm.AssistantMessage); ok && len([]rune(a.Text())) > rewriteAnswerChars+2 {
			t.Errorf("an answer was not shortened: %d runes", len([]rune(a.Text())))
		}
	}
}
