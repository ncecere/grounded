package agents

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/llm"
)

// The rewrite check (v0.4.2 US2-01): answers are refused, queries kept, in
// several languages.
func TestNotAQuery(t *testing.T) {
	const q = "Can a student extend it instead?"
	fallback := "How long does a guest Wi-Fi pass last? " + q
	for _, c := range []struct {
		rewrite, question, why string
	}{
		// The re-test's answer: a marker, two clauses, a statement.
		{"No, a student cannot extend a guest Wi-Fi pass; only a staff member (sponsor) can extend it from the Guest Portal [1].", q, "cites sources"},
		{"No, a student cannot extend a guest Wi-Fi pass. Only a sponsor can.", q, "several sentences"},
		{"No, only a staff sponsor can extend a guest Wi-Fi pass.", q, "a statement for a question"},
		{"Nein, nur ein Sponsor kann den Gastzugang verlängern［1］", "Kann ein Student ihn verlängern?", "cites sources"},
		{"不可以。只有工作人员可以延长访客通行证", "学生可以延长吗？", "several sentences"},
		{"Non, seul un parrain peut prolonger le pass invité.", "Un étudiant peut-il le prolonger ?", "a statement for a question"},
		{strings.Repeat("guest wifi pass extension policy ", 6) + "students", q, "too long"},
		{"x", q, "too short"},
		// Queries.
		{"Can a student extend a guest Wi-Fi pass?", q, ""},
		{"student extension of a guest Wi-Fi pass", q, ""},
		{"¿Puede un estudiante extender un pase de invitado?", "¿Y un estudiante?", ""},
		{"学生可以延长访客Wi-Fi通行证吗？", "学生可以延长吗？", ""},
		{"How much does a U.S. transcript cost, e.g. for 1.5 credits?", "And for a second copy?", ""},
		{"Is the VPN down? Which Wi-Fi should a visitor use?", "Is it down? And which Wi-Fi for a visitor?", ""},
		// A statement for a statement is fine.
		{"Guest Wi-Fi pass extension for students.", "Tell me about extending it.", ""},
	} {
		if got := notAQuery(c.rewrite, c.question, fallback); got != c.why {
			t.Errorf("notAQuery(%q, %q) = %q, want %q", c.rewrite, c.question, got, c.why)
		}
	}
}

func TestCountSentences(t *testing.T) {
	for text, want := range map[string]int{
		"":                                    0,
		"One sentence.":                       1,
		"One. Two!":                           2,
		"Is it? Yes.":                         2,
		"The U.S. office, e.g. at 1.5 pm.":    1,
		"“Quoted.” Then more":                 2,
		"一句。二句":                               2,
		"Ends with dots...":                   1,
		"First; second":                       2,
		"Version 2.0 of the app (see below).": 1,
	} {
		if got := countSentences(text); got != want {
			t.Errorf("countSentences(%q) = %d, want %d", text, got, want)
		}
	}
}

// The rewrite reads earlier answers without their markers, so it has none
// to copy.
func TestRewriteContextDropsMarkers(t *testing.T) {
	hist := []llm.Message{
		llm.UserMessage{Content: "How long does a guest Wi-Fi pass last?"},
		llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "A guest pass lasts 24 hours [1][2]."}}},
	}
	msgs := rewriteContext(hist, "Can a student extend it?")
	if got := msgs[1].(llm.AssistantMessage).Text(); got != "A guest pass lasts 24 hours." {
		t.Errorf("answer in the rewrite's context = %q", got)
	}
}
