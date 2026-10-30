package agents

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/kbs"
)

// parentHit is a hit that has a parent whose text was built (as ExpandParents does): the passage is "passage", the parent "passage" plus the
// words around it. doc and first identify the parent; chunk the passage.
func parentHit(doc uuid.UUID, first int32, words int) *fusedHit {
	text := strings.Repeat("section ", words)
	return &fusedHit{hit: kbs.Hit{ChunkID: uuid.New(), DocumentID: doc, Title: "Handbook", Content: "passage", PageStart: 0,
		Parent: &kbs.Parent{ProfileID: uuid.Nil, First: first, Last: first + 2, Matched: 2, Text: text, SHA256: "x", Passages: 3, Tokens: words, MaxTokens: 512}}}
}

func newTestRetriever(budget int) *retriever {
	return &retriever{budget: budget, byChunk: map[uuid.UUID]*numberedHit{}, byParent: map[kbs.ParentKey]*numberedHit{}}
}

// A hit with a parent is numbered with the parent's text, costs what that text costs, and cites it (docs/parent-child-retrieval.md §5, §6).
func TestNumberGivesTheParentAndCountsItsCost(t *testing.T) {
	r := newTestRetriever(1000)
	h := parentHit(uuid.New(), 4, 100) // 800 characters: 200 tokens, 20 of markup and the title
	out := r.number([]*fusedHit{h}, 5)
	if len(out) != 1 || out[0].Content != h.hit.Parent.Text || !out[0].Parent.Expanded {
		t.Fatalf("numbered = %+v", out)
	}
	if want := 1000 - (estimateTokens(h.hit.Parent.Text) + estimateTokens("Handbook") + 20); r.budget != want {
		t.Errorf("budget left = %d, want %d", r.budget, want)
	}
	cp := citationParent(out[0])
	if cp == nil || cp.First != 4 || cp.Last != 6 || cp.Passages != 3 || cp.Matched != 2 || cp.Tokens != estimateTokens(h.hit.Parent.Text) || cp.SHA256 != "x" {
		t.Errorf("citation parent = %+v", cp)
	}
	if c := citationOf(out[0], CitationSnippetLink); c.Parent == nil || !strings.HasPrefix(c.Snippet, "section section") {
		t.Errorf("citation = %+v", c)
	}
}

// A parent that does not fit the remaining budget is never cut: the model is given the passage, and the citation says no parent (§5).
func TestNumberFallsBackToThePassageWhenTheParentDoesNotFit(t *testing.T) {
	r := newTestRetriever(300)
	h := parentHit(uuid.New(), 0, 400) // 1600 characters: 400 tokens
	out := r.number([]*fusedHit{h}, 5)
	if len(out) != 1 || out[0].Content != "passage" || out[0].Parent.Expanded || h.hit.Parent.Skipped != "budget" {
		t.Fatalf("numbered = %+v (skipped %q)", out, h.hit.Parent.Skipped)
	}
	if citationParent(out[0]) != nil {
		t.Error("a citation of a passage carries a parent")
	}
	if r.budget >= 300 || r.budget < 300-hitCost(kbs.Hit{Content: "passage", Title: "Handbook"}) {
		t.Errorf("budget left = %d", r.budget)
	}
}

// Two hits in one parent are one source, whatever path found them; a second search that finds another passage of a parent the model already
// has gets that source's number and pays nothing (§5).
func TestNumberDeduplicatesParents(t *testing.T) {
	r := newTestRetriever(2000)
	doc := uuid.New()
	a, b := parentHit(doc, 0, 50), parentHit(doc, 0, 50) // the same parent, found twice (two knowledge bases)
	other := parentHit(uuid.New(), 0, 50)
	out := r.number([]*fusedHit{a, b, other}, 5)
	if len(out) != 2 || out[0].N != 1 || out[1].N != 2 || len(r.all) != 2 {
		t.Fatalf("numbered = %d sources, %d in the answer; want 2 and 2", len(out), len(r.all))
	}
	left := r.budget
	again := parentHit(doc, 0, 50) // another search, another passage of the first parent
	out = r.number([]*fusedHit{again}, 5)
	if len(out) != 1 || out[0].N != 1 || r.budget != left || len(r.all) != 2 {
		t.Errorf("second search = %+v, budget %d -> %d", out, left, r.budget)
	}
	// A parent that was not used (the passage was given) does not stand for its siblings: they are different text.
	r2 := newTestRetriever(2000)
	x, y := parentHit(doc, 0, 50), parentHit(doc, 0, 50)
	x.hit.Parent.Text, y.hit.Parent.Text = "", ""
	if out := r2.number([]*fusedHit{x, y}, 5); len(out) != 2 {
		t.Errorf("unexpanded siblings = %d sources, want 2", len(out))
	}
}

// Without a parent nothing changes: the passage, its cost and the citation as before (the default and every profile without parents).
func TestNumberWithoutParentsIsAsBefore(t *testing.T) {
	r := newTestRetriever(1000)
	f := &fusedHit{hit: kbs.Hit{ChunkID: uuid.New(), DocumentID: uuid.New(), Title: "Doc", Content: strings.Repeat("word ", 100)}}
	out := r.number([]*fusedHit{f}, 5)
	if len(out) != 1 || out[0].Content != f.hit.Content || out[0].Parent != nil || r.budget != 1000-hitCost(f.hit) || citationParent(out[0]) != nil {
		t.Fatalf("numbered = %+v, budget %d", out, r.budget)
	}
	if c := citationOf(out[0], CitationSnippetLink); c.Parent != nil {
		t.Errorf("citation = %+v", c)
	}
	// A search that is told not to expand (the evaluation's retrieval check) leaves parents alone.
	r3 := newTestRetriever(1000)
	r3.noExpand = true
	h := parentHit(uuid.New(), 0, 20)
	if out := r3.number([]*fusedHit{h}, 5); out[0].Content != "passage" || citationParent(out[0]) != nil {
		t.Errorf("noExpand numbered = %+v", out)
	}
}
