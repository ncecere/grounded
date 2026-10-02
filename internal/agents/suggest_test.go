package agents

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/llm"
)

func TestParseSuggestions(t *testing.T) {
	const asked = "How do I request a transcript?"
	cases := []struct {
		name, reply string
		want        []string
	}{
		{"plain lines", "What does a transcript cost?\nCan I order one online?", []string{"What does a transcript cost?", "Can I order one online?"}},
		{"list markers, emphasis, quotes, markers", "1. **What does it cost?** [1]\n2) \"Can I pay by card?\"\n- `How long does it take?` [2, 3]\nQ4: Who signs it?",
			[]string{"What does it cost?", "Can I pay by card?", "How long does it take?"}},
		{"none", "NONE", nil},
		{"none with a full stop", "None.", nil},
		{"labels and blanks", "Follow-up questions:\n\n   \n- Where is the registrar's office?", []string{"Where is the registrar's office?"}},
		{"the question asked", "how do I request a transcript\nWhat about a diploma?", []string{"What about a diploma?"}},
		{"duplicates", "What does it cost?\nwhat does it cost\nWhat does it cost ?", []string{"What does it cost?"}},
		{"over-long", strings.Repeat("a", MaxSuggestionChars+1) + "?\nShort one?", []string{"Short one?"}},
		{"no letters", "???\n123\n- ...", nil},
		{"at most three", "One question?\nTwo questions?\nThree questions?\nFour questions?", []string{"One question?", "Two questions?", "Three questions?"}},
		{"other languages", "¿Cuánto cuesta un certificado?\n証明書はいくらですか？", []string{"¿Cuánto cuesta un certificado?", "証明書はいくらですか？"}},
		{"look-alike punctuation", "Can I call 555\u20110100\u00a0today?", []string{"Can I call 555-0100 today?"}},
	}
	for _, c := range cases {
		if got := parseSuggestions(c.reply, asked); !slices.Equal(got, c.want) {
			t.Errorf("%s: %q, want %q", c.name, got, c.want)
		}
	}
}

func TestSuggestionPassages(t *testing.T) {
	cites := []Citation{
		{N: 2, Title: "Transcripts", HeadingPath: []string{"Transcripts", "Fees"}},
		{N: 9, Kind: SourceTool, Server: "Status", Tool: "check"},
	}
	hit := func(n int, title string, headings ...string) numberedHit {
		return numberedHit{Hit: kbs.Hit{Title: title, HeadingPath: headings}, N: n}
	}
	sources := []numberedHit{
		hit(1, "Transcripts", "Ordering"), hit(2, "Transcripts", "Transcripts", "Fees"), hit(3, "  Diplomas  ", "Replacement   copies"),
		{Hit: kbs.Hit{Title: "Old policy"}, N: 4, Conflicting: true}, {Hit: kbs.Hit{Title: "tool"}, N: 9, Tool: &toolSource{}}, hit(5, ""),
	}
	want := []string{"Transcripts › Fees", "Transcripts › Ordering", "Diplomas › Replacement copies"}
	if got := suggestionPassages(cites, sources); !slices.Equal(got, want) {
		t.Errorf("passages = %q, want %q", got, want)
	}
	in := suggestionInput("How much?", "It costs $10 [1]. Order online [1, 2].", want)
	if !strings.Contains(in, "Question: How much?") || strings.Contains(in, "[1") || !strings.Contains(in, "- Transcripts › Fees\n") {
		t.Errorf("input = %q", in)
	}
	var many []numberedHit
	for i := range 30 {
		many = append(many, hit(i+1, "Doc", strings.Repeat("h", i+1)))
	}
	if got := suggestionPassages(nil, many); len(got) != suggestPassageLines {
		t.Errorf("passage lines = %d, want %d", len(got), suggestPassageLines)
	}
}

// TestSuggestable: only complete answers with citations, not refused,
// moderated or failed.
func TestSuggestable(t *testing.T) {
	ok := Answer{Text: "Ten dollars [1].", Citations: []Citation{{N: 1}}, StopReason: string(llm.StopReasonStop)}
	if !suggestable(&ok) {
		t.Error("a cited answer isn't suggestable")
	}
	for name, mut := range map[string]func(*Answer){
		"refused":     func(a *Answer) { a.Refused = true },
		"no context":  func(a *Answer) { a.NoContext = true },
		"no citation": func(a *Answer) { a.Citations = nil },
		"moderated":   func(a *Answer) { a.Moderation = &ModerationEvent{} },
		"error":       func(a *Answer) { a.ErrorCode = ErrCodeModelUnavailable },
		"aborted":     func(a *Answer) { a.StopReason = string(llm.StopReasonAborted) },
		"cut off":     func(a *Answer) { a.StopReason = string(llm.StopReasonLength) },
		"empty":       func(a *Answer) { a.Text = " " },
	} {
		a := ok
		mut(&a)
		if suggestable(&a) {
			t.Errorf("%s: suggestable", name)
		}
	}
}

// TestFollowUpSuggestionsSetting: on by default and for configurations
// saved before v0.4.1 (absent), off when saved off, and versioned with the
// rest of the configuration.
func TestFollowUpSuggestionsSetting(t *testing.T) {
	if !DefaultConfig().FollowUpSuggestions {
		t.Error("new agents don't suggest follow-ups")
	}
	if !DecodeConfig(json.RawMessage(`{"instructions":"Be brief.","queryRewrite":true}`)).FollowUpSuggestions {
		t.Error("a configuration saved before v0.4.1 doesn't suggest follow-ups")
	}
	c, err := ParseConfig(json.RawMessage(`{"followUpSuggestions":false}`))
	if err != nil || c.FollowUpSuggestions {
		t.Fatalf("parsed off = %v %v", c.FollowUpSuggestions, err)
	}
	if DecodeConfig(c.JSON()).FollowUpSuggestions || !strings.Contains(string(c.JSON()), `"followUpSuggestions":false`) {
		t.Errorf("stored form = %s", c.JSON())
	}
	if _, err := ParseConfig(json.RawMessage(`{"followUpSuggestions":"yes"}`)); err == nil {
		t.Error("a non-boolean was accepted")
	}
}

// TestOffersSuggestions: streamed answers on the chat, API, Try it and
// public channels; never the OpenAI-compatible endpoint, MCP ask or JSON.
func TestOffersSuggestions(t *testing.T) {
	emit := func(Event) {}
	for ch, want := range map[string]bool{ChannelUI: true, ChannelAPI: true, ChannelTest: true, ChannelPublic: true, ChannelWidget: true,
		ChannelOpenAI: false, ChannelMCP: false} {
		ru := &run{cfg: Config{FollowUpSuggestions: true}, channel: ch, out: &streamer{emit: emit}}
		if got := ru.offersSuggestions(); got != want {
			t.Errorf("%s: offers = %v", ch, got)
		}
	}
	if (&run{cfg: Config{FollowUpSuggestions: true}, channel: ChannelUI, out: &streamer{}}).offersSuggestions() {
		t.Error("a JSON reply offers suggestions")
	}
	if (&run{cfg: Config{}, channel: ChannelUI, out: &streamer{emit: emit}}).offersSuggestions() {
		t.Error("an agent with suggestions off offers them")
	}
}
