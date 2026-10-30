package contenthealth

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

// "Not cited": ready documents that existed when observation began and that no answer cited in the window. The window starts at
// the later of asOf − citationWindowDays and the first answer event left; fewer than MinAnswers answers say nothing.
func TestNeverCitedWindowAndMinimum(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	agent := f.agent(f.teamA)
	old := asOf.AddDate(-1, 0, 0)
	cited := f.addDoc(f.teamA, src, doc{created: old})
	neverCited := f.addDoc(f.teamA, src, doc{created: old.Add(time.Hour)})
	f.addDoc(f.teamA, src, doc{created: asOf.AddDate(0, 0, -5)}) // created after observation began: too new to judge
	twoDaysBeforeStart := f.addDoc(f.teamA, src, doc{created: asOf.AddDate(0, 0, -60)})

	// No agent has answered: unavailable, not "every document is uncited".
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateUnavailable || s.Reason != ReasonNoAnswers {
		t.Fatalf("no agents: %+v, want unavailable (no answers)", s)
	}
	// Too few answers.
	f.answers(f.teamA, agent, MinAnswers-1, asOf.AddDate(0, 0, -30), "ui", cited)
	s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	if s.State != StateUnavailable || s.Reason != ReasonTooFewAnswers || s.Counts["answers"] != MinAnswers-1 || s.Found != 0 {
		t.Fatalf("%d answers: %+v, want unavailable (too few answers)", MinAnswers-1, s)
	}
	// Draft test chats are not use, and events outside the window and of other teams are not seen.
	f.answers(f.teamA, agent, 10, asOf.AddDate(0, 0, -20), "test")
	f.answers(f.teamA, agent, 10, asOf.AddDate(0, 0, -200), "ui")
	f.answers(f.teamB, f.agent(f.teamB), 100, asOf.AddDate(0, 0, -20), "ui")
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateUnavailable || s.Reason != ReasonTooFewAnswers {
		t.Fatalf("test chats, old events and another team's events counted: %+v", s)
	}
	// Enough answers: one more.
	f.answers(f.teamA, agent, 1, asOf.AddDate(0, 0, -29), "api", cited)
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	s = res.signal(SignalNeverCited)
	if s.State != StateMeasured || s.Found != 2 || s.Counts["answers"] != MinAnswers || s.Counts["tooNew"] != 1 || s.Counts["judged"] != 3 {
		t.Fatalf("cited = %+v, want 2 found among 3 judged, 1 too new, %d answers", s, MinAnswers)
	}
	if s.ObservedSince == nil || !s.ObservedSince.Equal(asOf.AddDate(0, 0, -30)) {
		t.Fatalf("observed since %v, want the first answer event (30 days before), later than the 90-day window", s.ObservedSince)
	}
	got := ids(res.findings(SignalNeverCited))
	if !contains(got, neverCited) || !contains(got, twoDaysBeforeStart) || contains(got, cited) || len(got) != 2 {
		t.Errorf("never cited = %v, want the two documents no answer cited (and not %v)", got, cited)
	}
	for _, fd := range res.findings(SignalNeverCited) {
		if fd.InKB {
			t.Errorf("a document in no knowledge base is marked as in one")
		}
	}
}

// A document is marked when its source is in no knowledge base: it could never have been cited.
func TestNeverCitedMarksDocumentsOutsideKnowledgeBases(t *testing.T) {
	f := newFixture(t)
	inKB, loose := f.source(f.teamA, "In a KB", "upload"), f.source(f.teamA, "In none", "upload")
	kb := f.id(`INSERT INTO knowledge_bases (team_id, name, embedding_profile_id) VALUES ($1, 'KB', $2) RETURNING id`, f.teamA, f.profile)
	f.exec(`INSERT INTO kb_sources (kb_id, source_id) VALUES ($1, $2)`, kb, inKB)
	a, b := f.addDoc(f.teamA, inKB, doc{}), f.addDoc(f.teamA, loose, doc{})
	f.answers(f.teamA, f.agent(f.teamA), 60, asOf.AddDate(0, 0, -10), "ui")
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	for _, fd := range res.findings(SignalNeverCited) {
		if want := fd.DocumentID == a; fd.InKB != want {
			t.Errorf("document %v in knowledge base = %v, want %v", fd.DocumentID, fd.InKB, want)
		}
	}
	if !contains(ids(res.findings(SignalNeverCited)), b) {
		t.Error("the document in no knowledge base is not listed")
	}
}

// Deleted conversations remove their analytics events, so a document they cited can show as not cited: the report only sees
// what is kept, and says how many answers it saw.
func TestNeverCitedSeesOnlyWhatIsRetained(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	d := f.addDoc(f.teamA, src, doc{})
	agent := f.agent(f.teamA)
	f.answers(f.teamA, agent, MinAnswers, asOf.AddDate(0, 0, -10), "ui", d)
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.Found != 0 || s.State != StateMeasured {
		t.Fatalf("cited document listed: %+v", s)
	}
	f.exec(`DELETE FROM message_events WHERE team_id = $1`, f.teamA) // retention, or the people who asked deleted their conversations
	f.answers(f.teamA, agent, MinAnswers, asOf.AddDate(0, 0, -10), "ui")
	s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	if s.Found != 1 || s.Counts["answers"] != MinAnswers {
		t.Fatalf("after deletion: %+v, want the document to show, with the answers still seen", s)
	}
}

// The scan is bounded: more answers than the bound make the signal unavailable, never a partial list.
func TestNeverCitedBoundedScan(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	f.addDoc(f.teamA, src, doc{})
	f.answers(f.teamA, f.agent(f.teamA), 120, asOf.AddDate(0, 0, -10), "ui")
	f.svc.AnswerScanLimit = 100
	s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	if s.State != StateUnavailable || s.Reason != ReasonTooManyAnswers || s.Found != 0 {
		t.Fatalf("over the scan bound: %+v, want unavailable (too many answers)", s)
	}
	f.svc.AnswerScanLimit = 120
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateMeasured {
		t.Fatalf("at the bound: %+v, want measured", s)
	}
}

// A scope narrows what is judged, not what counts as a citation.
func TestNeverCitedScopeNarrowsDocumentsNotCitations(t *testing.T) {
	f := newFixture(t)
	one, two := f.source(f.teamA, "One", "upload"), f.source(f.teamA, "Two", "upload")
	inOne := f.addDoc(f.teamA, one, doc{})
	inTwo := f.addDoc(f.teamA, two, doc{})
	f.answers(f.teamA, f.agent(f.teamA), 60, asOf.AddDate(0, 0, -10), "ui", inTwo)
	res := f.collect(f.teamA, asOf, 365, 90, &one, nil)
	if got := ids(res.findings(SignalNeverCited)); len(got) != 1 || got[0] != inOne {
		t.Fatalf("scoped to one source: %v, want only %v", got, uuid.UUID(inOne))
	}
}
