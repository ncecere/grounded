package evals

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestExpectedItems(t *testing.T) {
	id := uuid.New()
	items := Expected{DocumentIDs: []uuid.UUID{id}, URLs: []string{"https://example.edu/fees*"}, Filenames: []string{"Parking.md"}}.Items()
	if len(items) != 3 || items[0].Kind != ItemDocument || items[0].Value != id.String() || items[1].Kind != ItemURL || items[2].Kind != ItemFilename {
		t.Fatalf("items = %+v", items)
	}
	// Each item matches alone, the way the whole question does.
	if !items[1].want().Matches(Doc{URL: "https://example.edu/fees/2026"}) || !items[2].want().Matches(Doc{Filename: "parking.md"}) ||
		items[2].want().Matches(Doc{URL: "https://example.edu/fees"}) || !items[0].want().Matches(Doc{DocumentID: id}) {
		t.Errorf("an item doesn't match like the question")
	}
	if items[2].key() != (ExpectedItem{Kind: ItemFilename, Value: "PARKING.MD"}).key() {
		t.Errorf("filename keys differ by case")
	}
}

func TestMissingReason(t *testing.T) {
	cases := []struct {
		states []string
		want   string
	}{
		{[]string{StateNotIndexed}, MissingNotIndexed},
		{[]string{StateNotIndexed, StateDeleted}, MissingDeleted},
		{[]string{StateDeleted, StateIndexed}, ""},
	}
	for _, c := range cases {
		items := make([]ExpectedItem, len(c.states))
		for i, st := range c.states {
			items[i].State = st
		}
		if got := missingReason(items); got != c.want {
			t.Errorf("%v: %q, want %q", c.states, got, c.want)
		}
	}
}

func TestRankItems(t *testing.T) {
	items := Expected{Filenames: []string{"a.md", "b.md", "c.md"}}.Items()
	two := 2
	items[1].Rank = &two // ranked in the top k already: kept
	rankItems(items, []Doc{{Filename: "x.md"}, {Filename: "b.md"}, {Filename: "a.md"}, {Filename: "a.md"}})
	if items[0].Rank == nil || *items[0].Rank != 3 || *items[1].Rank != 2 || items[2].Rank != nil {
		t.Errorf("items = %+v", items)
	}
}

func TestStoredScores(t *testing.T) {
	d := Diagnosis{Expected: []ExpectedItem{{Kind: ItemURL, Value: "https://example.edu/a", State: StateIndexed}}, K: 4, Depth: DeepSearch}
	// A retrieval check: the diagnosis alone, no answer scores.
	sc, got := decodeScores(encodeScores(nil, d))
	if sc != nil || got.K != 4 || got.Depth != DeepSearch || len(got.Expected) != 1 {
		t.Errorf("retrieval = %+v %+v", sc, got)
	}
	// A full answer: both in one object.
	raw := encodeScores(&AnswerScores{Cited: true, Mentions: []Mention{}}, Diagnosis{Missing: ""})
	if sc, _ := decodeScores(raw); sc == nil || !sc.Cited || sc.Mentions == nil {
		t.Errorf("answer = %s", raw)
	}
	// Results stored before the diagnosis: {} for retrieval, bare scores for answers.
	if sc, d := decodeScores(json.RawMessage(`{}`)); sc != nil || len(d.Expected) != 0 {
		t.Errorf("old retrieval = %+v %+v", sc, d)
	}
	if sc, _ := decodeScores(json.RawMessage(`{"cited":false,"mentions":[{"phrase":"fee","found":true}],"refused":false}`)); sc == nil || len(sc.Mentions) != 1 {
		t.Errorf("old answer = %+v", sc)
	}
}

func TestSummarizeReasons(t *testing.T) {
	s := Summarize(KindAnswer, 0, []Scored{
		{Status: StatusPass, Answer: &AnswerScores{Cited: true, Mentions: []Mention{}}},
		{Status: StatusPass, Answer: &AnswerScores{Cited: true, Mentions: []Mention{{Phrase: "fee", Found: true}}}},
		{Status: StatusFail, Answer: &AnswerScores{Mentions: []Mention{}}},
		{Status: StatusMissing, Missing: MissingNotIndexed},
		{Status: StatusMissing, Missing: MissingDeleted},
		{Status: StatusMissing}, // recorded before the reason was kept
	})
	// Only a pass without must-mention phrases is cited-only.
	if s.CitedOnly != 1 || s.Missing != 3 || s.NotIndexed != 1 || s.Passed != 2 {
		t.Errorf("summary = %+v", s)
	}
}

func TestShortSnippet(t *testing.T) {
	if got := shortSnippet("# Fees\n\n  Transcripts   cost $10."); got != "# Fees Transcripts cost $10." {
		t.Errorf("short = %q", got)
	}
	long := shortSnippet(strings.Repeat("word ", 200))
	if !strings.HasSuffix(long, "…") || len([]rune(long)) > snippetChars+1 {
		t.Errorf("long = %d runes", len([]rune(long)))
	}
}

func TestNotInKBText(t *testing.T) {
	items := Expected{URLs: []string{"https://example.edu/a"}, Filenames: []string{"b.pdf"}}.Items()
	if got := notInKBText("Student help", items); got != "No document in Student help matches https://example.edu/a or b.pdf yet. It'll count once one is added." {
		t.Errorf("text = %q", got)
	}
}
