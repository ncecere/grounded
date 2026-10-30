package contenthealth

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

// "No retained citation evidence": ready documents of sources a published agent reaches, that existed when the source became
// reachable and that no retained answer cited in the team-wide window. The window starts at the later of asOf − citationWindowDays
// and the team's first retained answer event; fewer than MinAnswers answers that could have cited something say nothing.
func TestNeverCitedWindowAndMinimum(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	agent := f.served(f.teamA, src)
	old := asOf.AddDate(-1, 0, 0)
	cited := f.addDoc(f.teamA, src, doc{created: old})
	neverCited := f.addDoc(f.teamA, src, doc{created: old.Add(time.Hour)})
	f.addDoc(f.teamA, src, doc{created: asOf.AddDate(0, 0, -5)}) // created after observation began: too new to judge
	twoDaysBeforeStart := f.addDoc(f.teamA, src, doc{created: asOf.AddDate(0, 0, -60)})

	// No agent has answered: unavailable, not "every document is uncited".
	if s := f.collect(f.teamB, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateNotApplicable {
		t.Fatalf("a team with nothing: %+v", s)
	}
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateUnavailable || s.Reason != ReasonNoAnswers {
		t.Fatalf("no answers: %+v, want unavailable (no answers)", s)
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
	if cov := res.coverage(src); cov.CiteState != CiteJudged || cov.ExposureAnswers != MinAnswers || cov.ExposedSince == nil {
		t.Errorf("coverage = %+v, want the source judged with %d answers and a time", cov, MinAnswers)
	}
}

// Only documents of sources an active, published agent reaches through a knowledge base are judged. A source in no knowledge base,
// in one only an unpublished, disabled or deleted agent serves, or in one a published agent no longer serves, could not have been
// cited by what the team's agents answer with: its documents are counted, not listed. (Before, they were listed with a flag.)
func TestNeverCitedJudgesOnlyWhatAPublishedAgentReaches(t *testing.T) {
	f := newFixture(t)
	reached, loose, unpublished, disabled, deleted, dropped := f.source(f.teamA, "Reached", "upload"), f.source(f.teamA, "In no KB", "upload"),
		f.source(f.teamA, "Unpublished", "upload"), f.source(f.teamA, "Disabled", "upload"), f.source(f.teamA, "Deleted agent", "upload"),
		f.source(f.teamA, "Dropped", "upload")
	agent := f.served(f.teamA, reached)
	u := f.agent(f.teamA) // an agent that was never published reaches nothing, even if a knowledge base lists its source
	f.publish(u, time.Time{}, f.kb(f.teamA, time.Time{}, unpublished))
	f.exec(`UPDATE agents SET published_version_id = NULL WHERE id = $1`, u)
	d := f.served(f.teamA, disabled)
	f.exec(`UPDATE agents SET status = 'disabled_by_team' WHERE id = $1`, d)
	del := f.served(f.teamA, deleted)
	f.exec(`UPDATE agents SET deleted_at = now() WHERE id = $1`, del)
	// An older version served the source; the agent's current published version does not.
	dr := f.agent(f.teamA)
	f.publish(dr, time.Time{}, f.kb(f.teamA, time.Time{}, dropped))
	f.publish(dr, time.Time{}, f.kb(f.teamA, time.Time{}))

	mine := f.addDoc(f.teamA, reached, doc{})
	others := map[string]uuid.UUID{}
	for name, src := range map[string]uuid.UUID{"loose": loose, "unpublished": unpublished, "disabled": disabled, "deleted": deleted, "dropped": dropped} {
		others[name] = f.addDoc(f.teamA, src, doc{})
	}
	f.answers(f.teamA, agent, 60, asOf.AddDate(0, 0, -10), "ui")
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	s := res.signal(SignalNeverCited)
	if got := ids(res.findings(SignalNeverCited)); s.State != StateMeasured || len(got) != 1 || got[0] != mine {
		t.Fatalf("listed %v (%+v), want only the document of the source a published agent reaches", got, s)
	}
	if s.Counts["notServed"] != 5 || s.Counts["judged"] != 1 || s.Counts["sourcesJudged"] != 1 {
		t.Errorf("counts = %v, want 5 documents of sources no agent reaches left out, 1 judged", s.Counts)
	}
	for name, src := range map[string]uuid.UUID{"loose": loose, "unpublished": unpublished, "disabled": disabled, "deleted": deleted, "dropped": dropped} {
		if cov := res.coverage(src); cov.CiteState != CiteNotServed || cov.ExposedSince != nil {
			t.Errorf("%s source coverage = %+v, want not served and no invented time", name, cov)
		}
		if contains(ids(res.findings(SignalNeverCited)), others[name]) {
			t.Errorf("the %s source's document is listed", name)
		}
	}
	// Nothing reached: unavailable, never a measured zero.
	f.exec(`UPDATE agents SET status = 'disabled_by_team' WHERE id = $1`, agent)
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateUnavailable || s.Reason != ReasonNoExposure || s.Found != 0 {
		t.Errorf("no source reached: %+v, want unavailable (no exposure)", s)
	}
}

// A source attached to a knowledge base late is not judged against traffic that came before it was reachable: the answers that
// count for it are the kept answers of agents that reach it, since the next UTC day after the attachment (a bound that can be
// later than the truth, never earlier).
func TestNeverCitedLateAttachmentIsNotJudgedAgainstOlderTraffic(t *testing.T) {
	f := newFixture(t)
	old, late := f.source(f.teamA, "Old", "upload"), f.source(f.teamA, "Late", "upload")
	attached := time.Date(2026, 10, 25, 12, 0, 0, 0, time.UTC)
	agent := f.agent(f.teamA)
	f.publish(agent, asOf.AddDate(-1, 0, 0), f.kb(f.teamA, asOf.AddDate(-1, 0, 0), old), f.kb(f.teamA, attached, late))
	dOld := f.addDoc(f.teamA, old, doc{})
	dLate := f.addDoc(f.teamA, late, doc{created: asOf.AddDate(0, 0, -100)}) // existed long before it was attached
	f.answers(f.teamA, agent, 100, asOf.AddDate(0, 0, -40), "ui")            // before the late source was reachable
	f.answers(f.teamA, agent, 60, attached.Add(8*time.Hour), "ui")           // the same UTC day as the attachment: not counted for it
	f.answers(f.teamA, agent, MinAnswers-10, asOf.AddDate(0, 0, -2), "ui")   // after: 40 < the minimum

	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	if got := ids(res.findings(SignalNeverCited)); len(got) != 1 || got[0] != dOld {
		t.Fatalf("listed %v, want only the document of the long-reachable source: %v is judged against traffic from before it was attached", got, dLate)
	}
	cov := res.coverage(late)
	if cov.CiteState != CiteTooFewAnswer || cov.ExposureAnswers != MinAnswers-10 || cov.ExposedSince == nil || !cov.ExposedSince.Equal(time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("late source coverage = %+v, want too few answers (%d) since the next UTC day after attachment", cov, MinAnswers-10)
	}
	if s := res.signal(SignalNeverCited); s.Counts["fewAnswers"] != 1 || s.Counts["judged"] != 1 {
		t.Errorf("counts = %v, want the late source's document counted as left out for too few answers", s.Counts)
	}
	// Enough traffic since: judged, but a document added after it became reachable is still too new.
	f.answers(f.teamA, agent, 10, asOf.AddDate(0, 0, -1), "ui")
	dAfter := f.addDoc(f.teamA, late, doc{created: attached.Add(36 * time.Hour)})
	res = f.collect(f.teamA, asOf, 365, 90, nil, nil)
	got := ids(res.findings(SignalNeverCited))
	if !contains(got, dLate) || !contains(got, dOld) || contains(got, dAfter) || len(got) != 2 {
		t.Errorf("listed %v, want the two documents that existed (not %v, added after exposure began)", got, dAfter)
	}
	if res.signal(SignalNeverCited).Counts["tooNew"] != 1 {
		t.Errorf("counts = %v, want 1 document too new", res.signal(SignalNeverCited).Counts)
	}
}

// A new publication: an agent published four days ago is not judged against older traffic of another agent, even when its
// knowledge base was attached long ago.
func TestNeverCitedNewPublicationIsNotJudgedAgainstOlderTraffic(t *testing.T) {
	f := newFixture(t)
	s1, s2 := f.source(f.teamA, "One", "upload"), f.source(f.teamA, "Two", "upload")
	a1 := f.served(f.teamA, s1)
	a2 := f.agent(f.teamA)
	published := asOf.AddDate(0, 0, -4)
	f.publish(a2, published, f.kb(f.teamA, time.Time{}, s2))
	d1, d2 := f.addDoc(f.teamA, s1, doc{}), f.addDoc(f.teamA, s2, doc{})
	f.answers(f.teamA, a1, 100, asOf.AddDate(0, 0, -40), "ui")
	f.answers(f.teamA, a2, 5, asOf.AddDate(0, 0, -1), "ui")
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	got := ids(res.findings(SignalNeverCited))
	if len(got) != 1 || got[0] != d1 || contains(got, d2) {
		t.Fatalf("listed %v, want only %v: %v was published four days ago and saw 5 answers", got, d1, d2)
	}
	if cov := res.coverage(s2); cov.CiteState != CiteTooFewAnswer || cov.ExposureAnswers != 5 || !cov.ExposedSince.Equal(time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("coverage = %+v, want too few answers (5) since the next UTC day after publication", cov)
	}
}

// Traffic concentrated in one agent: a team-wide total above the minimum does not make a quiet agent's sources judgeable.
func TestNeverCitedTrafficConcentration(t *testing.T) {
	f := newFixture(t)
	busy, quiet := f.source(f.teamA, "Busy", "upload"), f.source(f.teamA, "Quiet", "upload")
	a1, a2 := f.served(f.teamA, busy), f.served(f.teamA, quiet)
	dBusy, dQuiet := f.addDoc(f.teamA, busy, doc{}), f.addDoc(f.teamA, quiet, doc{})
	f.answers(f.teamA, a1, 200, asOf.AddDate(0, 0, -20), "ui")
	f.answers(f.teamA, a2, 3, asOf.AddDate(0, 0, -20), "ui")
	res := f.collect(f.teamA, asOf, 365, 90, nil, nil)
	s := res.signal(SignalNeverCited)
	if got := ids(res.findings(SignalNeverCited)); s.State != StateMeasured || len(got) != 1 || got[0] != dBusy || contains(got, dQuiet) {
		t.Fatalf("listed %v (%+v), want only the busy agent's document", got, s)
	}
	if s.Counts["answers"] != 203 || s.Counts["fewAnswers"] != 1 {
		t.Errorf("counts = %v, want 203 team-wide answers and the quiet source's document left out", s.Counts)
	}
	if fd := res.findings(SignalNeverCited)[0]; fd.Value != 200 {
		t.Errorf("the finding says %d answers could have cited its source, want 200", fd.Value)
	}
	// If every source is quiet, nothing can be judged: unavailable, not a list of "uncited" documents.
	f.exec(`DELETE FROM message_events WHERE agent_id = $1`, a1)
	f.answers(f.teamA, f.agent(f.teamA), 60, asOf.AddDate(0, 0, -20), "ui") // plenty team-wide, none through a published agent
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateUnavailable || s.Reason != ReasonNoExposure {
		t.Errorf("all sources quiet: %+v, want unavailable (no exposure)", s)
	}
}

// The minimum counts answers that could have cited something. Refusals, errors, answers with no context or no retrieved passage,
// moderated answers and draft test chats do not count toward it.
func TestNeverCitedMinimumCountsOnlyAnswersThatCouldCite(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	agent := f.served(f.teamA, src)
	f.addDoc(f.teamA, src, doc{})
	when := asOf.AddDate(0, 0, -10)
	f.answers(f.teamA, agent, MinAnswers-1, when, "ui")
	for _, e := range map[string]event{
		"refused": {refused: true}, "errored": {errCode: "model_error"}, "no context": {noContext: true}, "no passages": {noPassages: true},
		"moderated": {moderation: "block"}, "test chat": {channel: "test"},
	} {
		f.event(f.teamA, agent, 20, when, e)
	}
	s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	if s.State != StateUnavailable || s.Reason != ReasonTooFewAnswers || s.Counts["answers"] != MinAnswers-1 {
		t.Fatalf("%d answers that could cite among %d events: %+v, want unavailable (too few) counting only the %d", MinAnswers-1, MinAnswers-1+6*20, s, MinAnswers-1)
	}
	f.answers(f.teamA, agent, 1, when, "ui")
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateMeasured || s.Counts["answers"] != MinAnswers {
		t.Fatalf("at the minimum: %+v, want measured with %d", s, MinAnswers)
	}
}

// The team's agents are read in a fixed order and up to a bound; more agents than the bound is detected and the signal says so,
// rather than quietly judging against a partial set of events.
func TestNeverCitedAgentListIsBoundedAndDetected(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	agent := f.served(f.teamA, src)
	f.addDoc(f.teamA, src, doc{})
	f.answers(f.teamA, agent, 60, asOf.AddDate(0, 0, -10), "ui")
	f.exec(`INSERT INTO agents (team_id, slug, name) SELECT $1, 'bulk-' || g, 'Bulk' FROM generate_series(1, $2) g`, f.teamA, MaxAgents-1)
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateMeasured {
		t.Fatalf("exactly %d agents: %+v, want measured", MaxAgents, s)
	}
	f.exec(`INSERT INTO agents (team_id, slug, name) VALUES ($1, 'one-too-many', 'Bulk')`, f.teamA)
	if s := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited); s.State != StateUnavailable || s.Reason != ReasonTooManyAgents || s.Found != 0 {
		t.Fatalf("%d agents: %+v, want unavailable (too many agents), never a confident empty list", MaxAgents+1, s)
	}
	// The list is deterministic: the same order every time, whatever the cap.
	a, err := f.svc.q.ContentHealthTeamAgents(f.ctx, dbgen.ContentHealthTeamAgentsParams{TeamID: f.teamA, Cap: 50})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := f.svc.q.ContentHealthTeamAgents(f.ctx, dbgen.ContentHealthTeamAgentsParams{TeamID: f.teamA, Cap: 50})
	for i := range a {
		if a[i] != b[i] || (i > 0 && string(a[i-1][:]) >= string(a[i][:])) {
			t.Fatal("the agent list is not in a fixed order")
		}
	}
}

// The scan is bounded: more answers than the bound make the signal unavailable, never a partial list.
func TestNeverCitedBoundedScan(t *testing.T) {
	f := newFixture(t)
	src := f.source(f.teamA, "Handbook", "upload")
	f.addDoc(f.teamA, src, doc{})
	f.answers(f.teamA, f.served(f.teamA, src), 120, asOf.AddDate(0, 0, -10), "ui")
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

// A scope narrows which documents are judged, not which events are read: the answers counted and the citations that count are the
// team's, whatever the scope, so a narrower scope does not make the event scan smaller (only a shorter window does).
func TestNeverCitedScopeNarrowsDocumentsNotEvents(t *testing.T) {
	f := newFixture(t)
	one, two := f.source(f.teamA, "One", "upload"), f.source(f.teamA, "Two", "upload")
	inOne := f.addDoc(f.teamA, one, doc{})
	inTwo := f.addDoc(f.teamA, two, doc{})
	agent := f.served(f.teamA, one, two)
	f.answers(f.teamA, agent, 60, asOf.AddDate(0, 0, -10), "ui", inTwo)
	whole := f.collect(f.teamA, asOf, 365, 90, nil, nil).signal(SignalNeverCited)
	res := f.collect(f.teamA, asOf, 365, 90, &one, nil)
	if got := ids(res.findings(SignalNeverCited)); len(got) != 1 || got[0] != inOne {
		t.Fatalf("scoped to one source: %v, want only %v", got, uuid.UUID(inOne))
	}
	if s := res.signal(SignalNeverCited); s.Counts["answers"] != whole.Counts["answers"] || s.Counts["answers"] != 60 {
		t.Errorf("answers counted with a scope = %d, whole team = %d: the scope must not narrow the events read", s.Counts["answers"], whole.Counts["answers"])
	}
	// Too many answers is a team-wide limit, so a narrow scope does not get around it.
	f.svc.AnswerScanLimit = 10
	if s := f.collect(f.teamA, asOf, 365, 90, &one, nil).signal(SignalNeverCited); s.Reason != ReasonTooManyAnswers {
		t.Errorf("a narrow scope under the scan bound: %+v, want unavailable (too many answers)", s)
	}
}
