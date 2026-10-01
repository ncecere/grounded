package agents

import (
	"slices"
	"testing"
)

func TestGapSignals(t *testing.T) {
	cases := []struct {
		name  string
		ans   Answer
		scope *ScopeRecord
		cite  *CitationsRecord
		want  []string
	}{
		{name: "good", ans: Answer{Citations: []Citation{{N: 1}}}, cite: &CitationsRecord{Verified: 2}},
		{name: "strict refusal", ans: Answer{Refused: true, NoContext: true}, want: []string{GapRefused, GapNoContext}},
		{name: "judged out", ans: Answer{Refused: true, NoContext: true, noContextReason: NoContextJudgedOut}, want: []string{GapRefused, GapJudgedOut}},
		{name: "out of scope", ans: Answer{Refused: true, NoContext: true, noContextReason: NoContextOutOfScope},
			scope: &ScopeRecord{Decision: "out_of_scope"}, want: []string{GapRefused, GapOutOfScope}},
		{name: "unsupported and uncited", ans: Answer{}, cite: &CitationsRecord{Unsupported: 1, Uncited: 2}, want: []string{GapUnsupported, GapUncited}},
		{name: "small talk", ans: Answer{NoContext: true, noContextReason: NoContextSmallTalk}},
		{name: "error", ans: Answer{NoContext: true, ErrorCode: ErrCodeModelUnavailable}},
		{name: "moderated", ans: Answer{NoContext: true, Moderation: &ModerationEvent{}}},
	}
	for _, c := range cases {
		ru := &run{scopeRec: c.scope, citeRec: c.cite}
		if got := ru.gapSignals(&c.ans); !slices.Equal(got, c.want) {
			t.Errorf("%s: signals = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestVectorText(t *testing.T) {
	if VectorText(nil) != nil {
		t.Error("nil vector has text")
	}
	if got := *VectorText([]float32{0.5, -1, 2e-7}); got != "[0.5,-1,2e-07]" {
		t.Errorf("text = %s", got)
	}
}
