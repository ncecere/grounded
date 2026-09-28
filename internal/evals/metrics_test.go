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

func TestScoreAnswer(t *testing.T) {
	id := uuid.New()
	e := Expected{DocumentIDs: []uuid.UUID{id}}
	text := "Transcripts cost $10 [1]. Order them at the\n Registrar's   Office [1]."
	sc, pass := ScoreAnswer(e, []string{"registrar's office", "$10"}, text, []Doc{{DocumentID: uuid.New()}, {DocumentID: id}}, false,
		&agents.CitationsRecord{Checked: 4, Verified: 3})
	if !pass || !sc.Cited || len(sc.Mentions) != 2 || !sc.Mentions[0].Found || !sc.Mentions[1].Found {
		t.Errorf("scores = %+v pass %v", sc, pass)
	}
	if sc.SupportedShare == nil || !near(*sc.SupportedShare, 0.75) {
		t.Errorf("supported share = %v", sc.SupportedShare)
	}
	if sc, pass := ScoreAnswer(e, []string{"notary"}, text, []Doc{{DocumentID: id}}, false, nil); pass || sc.Mentions[0].Found || sc.SupportedShare != nil {
		t.Errorf("missing phrase: %+v %v", sc, pass)
	}
	if sc, pass := ScoreAnswer(e, nil, text, []Doc{{DocumentID: uuid.New()}}, true, &agents.CitationsRecord{}); pass || sc.Cited || !sc.Refused {
		t.Errorf("not cited: %+v %v", sc, pass)
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
