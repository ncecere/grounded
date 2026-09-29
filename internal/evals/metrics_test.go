package evals

import (
	"math"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
)

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestSummarizeRetrieval(t *testing.T) {
	s := Summarize(KindRetrieval, 5, []Scored{
		{Status: StatusPass, Rank: 1},
		{Status: StatusPass, Rank: 4},
		{Status: StatusFail},
		{Status: StatusFail},
		{Status: StatusMissing},
		{Status: StatusError},
	})
	if s.K != 5 || s.Questions != 6 || s.Passed != 2 || s.Failed != 2 || s.Missing != 1 || s.Errors != 1 {
		t.Fatalf("counts = %+v", s)
	}
	// recall@k over the 4 scored questions; MRR = (1 + 1/4 + 0 + 0) / 4.
	if s.Recall == nil || !near(*s.Recall, 0.5) || s.MRR == nil || !near(*s.MRR, 1.25/4) || s.PassRate != nil {
		t.Errorf("recall %v mrr %v passRate %v", s.Recall, s.MRR, s.PassRate)
	}
	if empty := Summarize(KindRetrieval, 5, []Scored{{Status: StatusMissing}}); empty.Recall != nil || empty.MRR != nil {
		t.Errorf("nothing scored: %+v", empty)
	}
}

func TestSummarizeAnswers(t *testing.T) {
	half, one := 0.5, 1.0
	s := Summarize(KindAnswer, 0, []Scored{
		{Status: StatusPass, Answer: &AnswerScores{Cited: true, SupportedShare: &one}},
		{Status: StatusFail, Answer: &AnswerScores{Cited: true, SupportedShare: &half}},
		{Status: StatusFail, Answer: &AnswerScores{Refused: true}},
	})
	if s.PassRate == nil || !near(*s.PassRate, 1.0/3) || s.Recall != nil || s.Cited != 2 || s.Refused != 1 {
		t.Errorf("summary = %+v", s)
	}
	if s.SupportedShare == nil || !near(*s.SupportedShare, 0.75) {
		t.Errorf("supported share = %v", s.SupportedShare)
	}
}

// claimsWith are n claims of each verdict, in that order.
func claimsWith(supported, notSupported, uncited, unchecked int) []agents.Claim {
	var out []agents.Claim
	for v, n := range map[string]int{agents.ClaimSupported: supported, agents.ClaimNotSupported: notSupported,
		agents.ClaimUncited: uncited, agents.ClaimUnchecked: unchecked} {
		for range n {
			out = append(out, agents.Claim{Index: len(out), Verdict: v, Sources: []int{}})
		}
	}
	return out
}

func TestScoreAnswer(t *testing.T) {
	id := uuid.New()
	e := Expected{DocumentIDs: []uuid.UUID{id}}
	text := "Transcripts cost $10 [1]. Order them at the\n Registrar's   Office [1]."
	sc, pass := ScoreAnswer(e, []string{"registrar's office", "$10"}, text, []Doc{{DocumentID: uuid.New()}, {DocumentID: id}}, false,
		&agents.CitationsRecord{Checked: 4, Verified: 3, ClaimList: claimsWith(3, 1, 0, 0)})
	if !pass || !sc.Cited || len(sc.Mentions) != 2 || !sc.Mentions[0].Found || !sc.Mentions[1].Found {
		t.Errorf("scores = %+v pass %v", sc, pass)
	}
	if sc.SupportedShare == nil || !near(*sc.SupportedShare, 0.75) || sc.SupportedClaims != 3 || sc.ClaimsScored != 4 || len(sc.Claims) != 4 {
		t.Errorf("supported share = %v (%+v)", sc.SupportedShare, sc)
	}
	if sc, pass := ScoreAnswer(e, []string{"notary"}, text, []Doc{{DocumentID: id}}, false, nil); pass || sc.Mentions[0].Found || sc.SupportedShare != nil {
		t.Errorf("missing phrase: %+v %v", sc, pass)
	}
	if sc, pass := ScoreAnswer(e, nil, text, []Doc{{DocumentID: uuid.New()}}, true, &agents.CitationsRecord{}); pass || sc.Cited || !sc.Refused {
		t.Errorf("not cited: %+v %v", sc, pass)
	}
}

// The share of supported claims counts claims, the units the chat's summary
// shows (v0.2.1, I9): a claim citing two sources counts once, uncited claims
// count as not supported, and claims whose check failed are left out.
func TestScoreAnswerCountsClaims(t *testing.T) {
	e := Expected{DocumentIDs: []uuid.UUID{uuid.New()}}
	// Pairs don't matter any more: 5 verified pairs, but 3 of 4 claims supported.
	sc, _ := ScoreAnswer(e, nil, "x", nil, false, &agents.CitationsRecord{Checked: 6, Verified: 5, Uncited: 1, ClaimList: claimsWith(3, 0, 1, 0)})
	if sc.SupportedShare == nil || !near(*sc.SupportedShare, 0.75) || sc.Uncited != 1 {
		t.Errorf("with an uncited sentence: %+v", sc)
	}
	// No citation at all: nothing is supported.
	sc, _ = ScoreAnswer(e, nil, "x", nil, false, &agents.CitationsRecord{Uncited: 2, ClaimList: claimsWith(0, 0, 2, 0)})
	if sc.SupportedShare == nil || *sc.SupportedShare != 0 || sc.Uncited != 2 {
		t.Errorf("without citations: %+v", sc)
	}
	// Unchecked claims are left out: 1 of 2.
	sc, _ = ScoreAnswer(e, nil, "x", nil, false, &agents.CitationsRecord{ClaimList: claimsWith(1, 1, 0, 3)})
	if sc.SupportedShare == nil || !near(*sc.SupportedShare, 0.5) || sc.ClaimsScored != 2 {
		t.Errorf("with unchecked claims: %+v", sc)
	}
	// Nothing but unchecked claims: no share.
	if sc, _ = ScoreAnswer(e, nil, "x", nil, false, &agents.CitationsRecord{Unchecked: 2, ClaimList: claimsWith(0, 0, 0, 2)}); sc.SupportedShare != nil {
		t.Errorf("nothing checked: %+v", sc)
	}
}

func TestDetectDrop(t *testing.T) {
	r := func(v float64) Summary { return Summary{Recall: &v} }
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	prev := map[uuid.UUID]string{a: StatusPass, b: StatusFail, c: StatusPass}
	same := map[uuid.UUID]string{a: StatusPass, b: StatusFail, c: StatusPass}
	if d := DetectDrop(r(0.9), r(0.86), prev, same); d.Notify() {
		t.Errorf("a 4-point drop notified: %+v", d)
	}
	if d := DetectDrop(r(0.9), r(0.85), prev, same); d.Notify() {
		t.Errorf("exactly 5 points notified: %+v", d)
	}
	if d := DetectDrop(r(0.9), r(0.84), prev, same); !d.Notify() {
		t.Errorf("a 6-point drop didn't notify: %+v", d)
	}
	worse := map[uuid.UUID]string{a: StatusFail, b: StatusPass, c: StatusMissing}
	if d := DetectDrop(r(0.9), r(0.9), prev, worse); !d.Notify() || d.NewlyFailing != 1 {
		t.Errorf("newly failing: %+v", d)
	}
	if d := DetectDrop(r(0.5), r(0.9), prev, same); d.Notify() {
		t.Errorf("an improvement notified: %+v", d)
	}
	if d := DetectDrop(Summary{}, r(0.2), nil, same); d.Notify() {
		t.Errorf("no previous recall notified: %+v", d)
	}
}

func TestCompare(t *testing.T) {
	o := func(st string, rank int) *Outcome { return &Outcome{Status: st, Rank: rank} }
	cases := []struct {
		a, b *Outcome
		want string
	}{
		{o(StatusFail, 0), o(StatusPass, 3), ChangeBetter},
		{o(StatusPass, 1), o(StatusFail, 0), ChangeWorse},
		{o(StatusPass, 4), o(StatusPass, 1), ChangeBetter},
		{o(StatusPass, 1), o(StatusPass, 2), ChangeWorse},
		{o(StatusPass, 2), o(StatusPass, 2), ChangeSame},
		{o(StatusFail, 0), o(StatusFail, 0), ChangeSame},
		{o(StatusMissing, 0), o(StatusFail, 0), ChangeSame},
		{nil, o(StatusPass, 1), ChangeOnlyB},
		{o(StatusPass, 1), nil, ChangeOnlyA},
	}
	for i, c := range cases {
		if got := Compare(c.a, c.b); got != c.want {
			t.Errorf("case %d: %s, want %s", i, got, c.want)
		}
	}
}
