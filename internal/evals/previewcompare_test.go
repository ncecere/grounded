package evals

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/store/dbgen"
)

func previewRun(set uuid.UUID, side, status string, at time.Time) dbgen.EvalRun {
	cfg, _ := json.Marshal(RunConfig{Preview: &PreviewRef{MigrationID: uuid.New(), Side: side}})
	return dbgen.EvalRun{ID: uuid.New(), SetID: set, Status: status, CreatedAt: at, Config: cfg}
}

// A set's comparison shows the newest pair (live and candidate made in the same batch, so at the same time) that both completed; while a
// newer pair is still going it keeps showing the last finished one; before any has finished it shows the newest.
func TestPickPair(t *testing.T) {
	set, other := uuid.New(), uuid.New()
	t0 := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	t1, t2 := t0.Add(time.Hour), t0.Add(2*time.Hour)
	live0, cand0 := previewRun(set, PreviewLive, "completed", t0), previewRun(set, PreviewCandidate, "completed", t0)
	live1, cand1 := previewRun(set, PreviewLive, "completed", t1), previewRun(set, PreviewCandidate, "completed", t1)
	live2, cand2 := previewRun(set, PreviewLive, "running", t2), previewRun(set, PreviewCandidate, "queued", t2)
	otherLive, otherCand := previewRun(other, PreviewLive, "completed", t2), previewRun(other, PreviewCandidate, "completed", t2)

	for _, tc := range []struct {
		name       string
		runs       []dbgen.EvalRun // newest first
		live, cand *dbgen.EvalRun
	}{
		{"no runs", nil, nil, nil},
		{"one finished pair", []dbgen.EvalRun{cand0, live0}, &live0, &cand0},
		{"the newest finished pair", []dbgen.EvalRun{cand1, live1, cand0, live0}, &live1, &cand1},
		{"a newer pair still going: the last finished one", []dbgen.EvalRun{cand2, live2, cand1, live1, cand0, live0}, &live1, &cand1},
		{"another set's runs are not this set's", []dbgen.EvalRun{otherCand, otherLive, cand0, live0}, &live0, &cand0},
		{"nothing finished: the newest pair", []dbgen.EvalRun{cand2, live2}, &live2, &cand2},
		{"a candidate without its live run is skipped", []dbgen.EvalRun{cand1, cand0, live0}, &live0, &cand0},
		{"only a candidate", []dbgen.EvalRun{cand1}, nil, nil},
	} {
		live, cand := pickPair(tc.runs, set)
		if (live == nil) != (tc.live == nil) || (cand == nil) != (tc.cand == nil) ||
			(live != nil && live.ID != tc.live.ID) || (cand != nil && cand.ID != tc.cand.ID) {
			t.Errorf("%s: got live %v, candidate %v; want %v, %v", tc.name, id(live), id(cand), id(tc.live), id(tc.cand))
		}
	}
}

func id(r *dbgen.EvalRun) any {
	if r == nil {
		return nil
	}
	return r.ID.String()[:8]
}

func TestFirstPlaces(t *testing.T) {
	rank := func(n int32) *int32 { return &n }
	rs := []Result{
		{EvalResult: dbgen.EvalResult{Status: StatusPass, Rank: rank(1)}},
		{EvalResult: dbgen.EvalResult{Status: StatusPass, Rank: rank(3)}},
		{EvalResult: dbgen.EvalResult{Status: StatusFail}},
		{EvalResult: dbgen.EvalResult{Status: StatusPass, Rank: rank(1)}},
		{EvalResult: dbgen.EvalResult{Status: StatusMissing, Rank: rank(1)}}, // a rank without a pass is not a first place
	}
	if got := firstPlaces(rs); got != 2 {
		t.Errorf("firstPlaces = %d, want 2", got)
	}
}
