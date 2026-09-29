package evals

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
)

// A full answer's citations stay one per marker number, even when several
// cite the same document, so [3] finds its entry.
func TestCitationViews(t *testing.T) {
	transcripts, diplomas := uuid.New(), uuid.New()
	p := int32(2)
	cites := []agents.Citation{
		{N: 1, DocumentID: transcripts, Title: "Transcripts", Snippet: "Order online."},
		{N: 2, DocumentID: diplomas, Title: "Diplomas", Snippet: "Mailed in June.", PageStart: &p},
		{N: 3, DocumentID: transcripts, Title: "Transcripts", Snippet: "Fees apply.", HeadingPath: []string{"Fees"}},
	}
	docs := []Doc{
		{DocumentID: transcripts, Title: "Transcripts", Filename: "transcripts.md"},
		{DocumentID: diplomas, Title: "Diplomas", URL: "https://example.edu/diplomas"},
		{DocumentID: transcripts, Title: "Transcripts", Filename: "transcripts.md"},
	}
	got := citationViews(cites, docs, Expected{Filenames: []string{"transcripts.md"}})
	if len(got) != 3 {
		t.Fatalf("citations = %+v", got)
	}
	for i, h := range got {
		if h.N != i+1 || h.Rank != i+1 || h.Snippet != cites[i].Snippet || h.Expected != (h.DocumentID == transcripts) {
			t.Errorf("citation %d = %+v", i, h)
		}
	}
	if got[1].PageStart == nil || *got[1].PageStart != 2 || got[1].URL != "https://example.edu/diplomas" || got[2].HeadingPath[0] != "Fees" {
		t.Errorf("passage details = %+v", got)
	}
}

// A v0.2.0 answer kept each cited document once, at its citation's
// position: reading it numbers the entries from the answer's markers
// (ascending, as v0.2.0 listed them); a repeated document's marker has none.
func TestNumberLegacyCitations(t *testing.T) {
	hits := []HitView{{Rank: 1, Title: "Enrollment"}, {Rank: 3, Title: "Transcripts"}}
	numberLegacyCitations("Request it online [4]. It costs $10 [1][4]. See the fees [5].", hits)
	if hits[0].N != 1 || hits[1].N != 5 {
		t.Errorf("legacy numbers = %+v", hits)
	}
	current := []HitView{{Rank: 1, N: 2}}
	numberLegacyCitations("Fees [2].", current)
	if current[0].N != 2 {
		t.Errorf("numbered citations changed: %+v", current)
	}
}
