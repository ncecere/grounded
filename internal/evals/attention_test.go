package evals

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func TestMatchKey(t *testing.T) {
	id := uuid.New()
	items := Expected{DocumentIDs: []uuid.UUID{id}, URLs: []string{"https://example.edu/fees*", "https://example.edu/parking/"},
		Filenames: []string{"Parking.MD"}}.Items()
	type key struct {
		doc                   uuid.UUID
		url, prefix, filename string
	}
	want := []key{{doc: id}, {prefix: "https://example.edu/fees"}, {url: "https://example.edu/parking"}, {filename: "parking.md"}}
	for i, it := range items {
		var k key
		k.doc, k.url, k.prefix, k.filename = it.matchKey()
		if k != want[i] {
			t.Errorf("item %d key = %+v, want %+v", i, k, want[i])
		}
	}
	if d, u, p, f := (ExpectedItem{Kind: ItemDocument, Value: "not-a-uuid"}).matchKey(); d != uuid.Nil || u+p+f != "" {
		t.Errorf("a malformed document ID has a key")
	}
}

func TestMissedDeep(t *testing.T) {
	items := []ExpectedItem{{Kind: ItemFilename, Value: "housing.md"}}
	cases := []struct {
		name, status, scores string
		want                 bool
	}{
		{"missed after the deeper search", StatusFail, `{"expected":[{"kind":"filename","value":"Housing.md","state":"indexed"}],"k":4,"depth":50}`, true},
		{"k already 50 deep", StatusFail, `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed"}],"k":50}`, true},
		{"found beyond k", StatusFail, `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed","rank":11}],"k":4,"depth":50}`, false},
		{"no deeper search", StatusFail, `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed"}],"k":4}`, false},
		{"other expected documents", StatusFail, `{"expected":[{"kind":"filename","value":"old.md","state":"indexed"}],"k":4,"depth":50}`, false},
		{"passed", StatusPass, `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed"}],"k":4}`, false},
		{"missing", StatusMissing, `{"expected":[{"kind":"filename","value":"housing.md","state":"not_indexed"}],"k":4}`, false},
		{"before diagnoses", StatusFail, `{}`, false},
	}
	for _, c := range cases {
		if got := missedDeep(c.status, []byte(c.scores), items); got != c.want {
			t.Errorf("%s: missedDeep = %v", c.name, got)
		}
	}
}

func TestMissedEvery(t *testing.T) {
	items := []ExpectedItem{{Kind: ItemURL, Value: "https://example.edu/housing"}}
	miss := dbgen.LatestRetrievalResultsRow{Status: StatusFail,
		Scores: []byte(`{"expected":[{"kind":"url","value":"https://example.edu/housing","state":"indexed"}],"k":4,"depth":50}`)}
	pass := dbgen.LatestRetrievalResultsRow{Status: StatusPass, Scores: []byte(`{}`)}
	if missedEvery([]dbgen.LatestRetrievalResultsRow{miss, miss}, items) {
		t.Error("out of reach after 2 runs")
	}
	if !missedEvery([]dbgen.LatestRetrievalResultsRow{miss, miss, miss}, items) {
		t.Error("not out of reach after 3 misses")
	}
	if missedEvery([]dbgen.LatestRetrievalResultsRow{miss, pass, miss}, items) {
		t.Error("out of reach though one of the 3 passed")
	}
	if missedEvery([]dbgen.LatestRetrievalResultsRow{miss, miss, miss}, nil) {
		t.Error("out of reach without expected documents")
	}
}

func TestQuestionProblem(t *testing.T) {
	c := Case{EvalCase: dbgen.EvalCase{ID: uuid.New(), MustMention: []string{"permit", "Parchment"}}}
	indexed := ExpectedItem{Kind: ItemFilename, Value: "parking.md", State: StateIndexed}
	gone := ExpectedItem{Kind: ItemURL, Value: "https://example.edu/fees*", State: StateNotIndexed}
	phrases := map[string]bool{"permit": true, "Parchment": false}
	reach := &OutOfReach{RunID: uuid.New(), ResultID: uuid.New()}

	if _, ok := questionProblem(c, []ExpectedItem{indexed}, phrases, false, nil); ok {
		t.Error("a problem without one (phrases not checked)")
	}
	p, ok := questionProblem(c, []ExpectedItem{indexed, gone}, phrases, true, reach)
	if !ok || p.Missing != "" || len(p.Expected) != 1 || p.Expected[0] != gone || len(p.Phrases) != 1 || p.Phrases[0] != "Parchment" || p.OutOfReach != reach {
		t.Errorf("problem = %+v", p)
	}
	// Nothing held: can't pass, and out of reach is moot.
	p, ok = questionProblem(c, []ExpectedItem{gone}, phrases, false, reach)
	if !ok || p.Missing != MissingNotIndexed || p.OutOfReach != nil {
		t.Errorf("missing = %+v", p)
	}
}
