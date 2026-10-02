package gaps_test

import (
	"context"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/gaps"
	"github.com/ncecere/grounded/internal/systemone"
	"github.com/ncecere/grounded/internal/testutil"
)

// at gives the question of a conversation a vector at deg degrees in a
// plane of the profile's space, so the cosine similarity of two questions
// is cos(their angle difference).
func (f *fixture) at(conv uuid.UUID, deg float64) {
	f.t.Helper()
	parts := make([]string, 64)
	for i := range parts {
		parts[i] = "0"
	}
	rad := deg * math.Pi / 180
	parts[0], parts[1] = fmt.Sprintf("%g", math.Cos(rad)), fmt.Sprintf("%g", math.Sin(rad))
	f.exec(`UPDATE gap_questions SET embedding = $2::text::vector, profile_id = $3 WHERE conversation_id = $1`,
		conv, "["+strings.Join(parts, ",")+"]", f.profile)
}

// askAt asks with a vector at deg degrees.
func (f *fixture) askAt(asker, question string, deg float64) uuid.UUID {
	conv := f.ask(asker, question, false, "no_context")
	f.at(conv, deg)
	return conv
}

func (f *fixture) topicOf(conv uuid.UUID) uuid.UUID {
	f.t.Helper()
	var id uuid.UUID
	if err := f.pool.QueryRow(f.ctx, `SELECT topic_id FROM gap_questions WHERE conversation_id = $1`, conv).Scan(&id); err != nil {
		f.t.Fatalf("topic of %s: %v", conv, err)
	}
	return id
}

// deg is the angle whose cosine is sim.
func deg(sim float64) float64 { return math.Acos(sim) * 180 / math.Pi }

// TestGroupingByNearestQuestion: a question joins the topic of its nearest
// question at 0.72 or more even when the topic's centroid is far (owner
// decision 4); below that it starts a topic.
func TestGroupingByNearestQuestion(t *testing.T) {
	f := newFixture(t)
	a := f.askAt("a1", "How do I request a parking permit?", 0)
	b := f.askAt("a2", "Where do I apply for a parking permit?", deg(0.85)) // the centroid's 0.85
	f.run()
	if f.topicOf(a) != f.topicOf(b) {
		t.Fatal("a question at 0.85 of the centroid started a topic")
	}
	// 0.75 from b, about 0.54 from the topic's centroid.
	c := f.askAt("a3", "How do I renew my campus parking permit for next semester?", deg(0.85)+deg(0.75))
	// 0.6 from the nearest question: a topic of its own.
	d := f.askAt("a4", "How much does a gym membership cost?", -deg(0.6))
	sum := f.run()
	if f.topicOf(c) != f.topicOf(a) || f.topicOf(d) == f.topicOf(a) || sum.NewTopics != 1 {
		t.Fatalf("by nearest question: c in %s, d in %s, a in %s; %+v", f.topicOf(c), f.topicOf(d), f.topicOf(a), sum)
	}
}

// TestMergeKeepsOlderTopic: topics whose centroids come within 0.8 merge;
// the older keeps its ID, state and history (the newer one's too), is
// labelled again, and a newer topic dismissed as not for the agent passes
// that on.
func TestMergeKeepsOlderTopic(t *testing.T) {
	f := newFixture(t)
	a := f.askAt("a1", parking, 0)
	f.run()
	b := f.askAt("a2", "Where can staff park on campus?", 50) // 0.64: a topic of its own
	f.run()
	older, newer := f.topicOf(a), f.topicOf(b)
	if older == newer {
		t.Fatal("0.64 apart joined one topic")
	}
	f.exec(`UPDATE gap_topics SET label = 'Parking permits', labelled_questions = 1 WHERE id = $1`, older)
	f.exec(`UPDATE gap_topics SET state = 'dismissed', dismiss_kind = 'not_for_agent', state_reason = 'Transport answers this.' WHERE id = $1`, newer)
	f.exec(`INSERT INTO gap_topic_events (topic_id, kind, dismiss_kind, reason) VALUES ($1, 'dismissed', 'not_for_agent', 'Transport answers this.')`, newer)
	// Questions pulling the centroids together: 0 and 50 become about 0.9 apart.
	f.exec(`UPDATE gap_topics SET centroid = (SELECT centroid FROM gap_topics WHERE id = $2) WHERE id = $1`, newer, older)
	sum := f.run()
	if sum.Merged != 1 {
		t.Fatalf("run = %+v, want one merge", sum)
	}
	if f.topicOf(b) != older || f.count(`SELECT count(*) FROM gap_topics WHERE id = $1`, newer) != 0 {
		t.Fatal("the newer topic's questions didn't move into the older one")
	}
	var state, kind, reason string
	var labelled int
	if err := f.pool.QueryRow(f.ctx, `SELECT state, coalesce(dismiss_kind, ''), state_reason, labelled_questions FROM gap_topics WHERE id = $1`,
		older).Scan(&state, &kind, &reason, &labelled); err != nil {
		t.Fatal(err)
	}
	if state != gaps.StateDismissed || kind != gaps.DismissNotForAgent || reason != "Transport answers this." || labelled != 0 {
		t.Fatalf("merged topic = %s %s %q labelled %d", state, kind, reason, labelled)
	}
	if n := f.count(`SELECT count(*) FROM gap_topic_events WHERE topic_id = $1 AND kind IN ('dismissed', 'merged')`, older); n != 2 {
		t.Fatalf("history = %d events, want the moved dismissal and the merge", n)
	}
}

// TestConfirmWithSystemOne: with the team's setting on, a borderline
// question (0.65-0.72 from its nearest) joins its topic when SystemOne says
// it's the same subject, and the check is metered to the team; a "no"
// keeps it apart, and the setting off never asks.
func TestConfirmWithSystemOne(t *testing.T) {
	f := newFixture(t)
	s1 := systemone.New(f.pool, f.cat, testutil.Logger())
	f.runner.SystemOne = func(ctx context.Context) (*systemone.Client, error) { return s1.Client(ctx, f.systemOne) }
	a := f.askAt("a1", parking, 0)
	f.run()
	b := f.askAt("a2", "Can visitors park by the library?", deg(0.68))
	if sum := f.run(); f.topicOf(b) == f.topicOf(a) || sum.Confirmed != 0 {
		t.Fatalf("setting off: joined or asked (%+v)", sum)
	}
	st, err := f.svc.Settings(f.ctx, f.editor, f.slug)
	if err != nil || st.ConfirmSimilar {
		t.Fatalf("default settings = %+v, %v", st, err)
	}
	if _, err := f.svc.SetSettings(f.ctx, f.member, f.slug, true, st.Revision); !isStatus(err, 404) {
		t.Fatalf("a member's save = %v", err)
	}
	if _, err := f.svc.SetSettings(f.ctx, f.editor, f.slug, true, st.Revision); err != nil {
		t.Fatal(err)
	}
	c := f.askAt("a3", "Where is visitor parking?", -deg(0.68))
	d := f.askAt("a4", "DIFFERENT: is there a staff gym?", -deg(0.68)-deg(0.7)) // 0.7 from c only
	sum := f.run()
	if f.topicOf(c) != f.topicOf(a) || sum.Confirmed < 1 {
		t.Fatalf("confirmed question in %s, want %s (%+v)", f.topicOf(c), f.topicOf(a), sum)
	}
	if f.topicOf(d) == f.topicOf(a) {
		t.Fatal("SystemOne said different, but the question joined")
	}
	if n := f.count(`SELECT count(*) FROM usage_events WHERE team_id = $1 AND kind = 'systemone_requests' AND metadata->>'source' = 'gaps'`, f.team); n < 1 {
		t.Fatalf("metered SystemOne checks = %d", n)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action = 'gap_settings.update' AND team_id = $1`, f.team); n != 1 {
		t.Fatalf("settings audit entries = %d", n)
	}
}

// TestDismissKindsAndHistory (owner decision 5): "Dismiss for now" reopens
// on a newer failure; "Not for this agent" stays closed while new questions
// join and are counted; both can be undone; the history keeps every
// dismissal's reason and who; audit entries carry the kind and hasReason,
// never the reason.
func TestDismissKindsAndHistory(t *testing.T) {
	f := newFixture(t)
	for _, a := range []string{"a1", "a2", "a3"} {
		f.ask(a, parking, false, "no_context")
	}
	f.run()
	list, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, "")
	id := list.Topics[0].ID
	if _, err := f.svc.Dismiss(f.ctx, f.editor, f.slug, id, "sideways", ""); !isCode(err, "invalid_kind") {
		t.Fatalf("bad kind = %v", err)
	}
	if _, err := f.svc.Dismiss(f.ctx, f.editor, f.slug, id, gaps.DismissForNow, "Covered by the transport office."); err != nil {
		t.Fatal(err)
	}
	time.Sleep(10 * time.Millisecond)
	f.ask("a4", parking, false, "no_context")
	if sum := f.run(); sum.Reopened != 1 {
		t.Fatalf("for now: %+v, want reopened", sum)
	}
	top, err := f.svc.Dismiss(f.ctx, f.editor, f.slug, id, gaps.DismissNotForAgent, "Transport answers parking.")
	if err != nil || top.State != gaps.StateDismissed || top.DismissKind == nil || *top.DismissKind != gaps.DismissNotForAgent {
		t.Fatalf("not for this agent = %+v, %v", top, err)
	}
	time.Sleep(10 * time.Millisecond)
	f.ask("a5", parking, false, "no_context")
	if sum := f.run(); sum.Reopened != 0 || sum.Assigned != 1 {
		t.Fatalf("not for this agent: %+v, want the question joined and no reopening", sum)
	}
	d, err := f.svc.Get(f.ctx, f.editor, f.slug, id)
	if err != nil || d.Topic.State != gaps.StateDismissed || d.Topic.SinceClosed != 1 {
		t.Fatalf("after a new question = %+v, %v", d.Topic, err)
	}
	if open, _ := f.svc.List(f.ctx, f.editor, f.slug, nil, "open"); len(open.Topics) != 0 {
		t.Fatal("a topic not for this agent shows as open")
	}
	reasons := []string{}
	for _, e := range d.History {
		if e.Kind == gaps.EventDismissed {
			if e.ActorName == nil || *e.ActorName != "editor" {
				t.Errorf("dismissed by %v", e.ActorName)
			}
			reasons = append(reasons, e.Reason)
		}
	}
	if strings.Join(reasons, "|") != "Transport answers parking.|Covered by the transport office." {
		t.Fatalf("history reasons = %q", reasons)
	}
	if _, err := f.svc.Reopen(f.ctx, f.editor, f.slug, id); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Reopen(f.ctx, f.editor, f.slug, id); !isCode(err, "gap_topic_open") {
		t.Fatalf("reopen an open topic = %v", err)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE team_id = $1 AND action IN ('gap_topic.dismiss', 'gap_topic.reopen')
		AND (metadata->>'kind' IS NOT NULL OR action = 'gap_topic.reopen')`, f.team); n != 3 {
		t.Fatalf("audit entries = %d", n)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE action = 'gap_topic.dismiss' AND (metadata->>'hasReason')::boolean`); n != 2 {
		t.Fatalf("dismissals with hasReason = %d", n)
	}
	if n := f.count(`SELECT count(*) FROM audit_log WHERE coalesce(before_state::text, '') || coalesce(after_state::text, '') || metadata::text
		ILIKE ANY (ARRAY['%transport%', '%parking%'])`); n != 0 {
		t.Fatalf("%d audit entries carry a reason or the topic", n)
	}
}
