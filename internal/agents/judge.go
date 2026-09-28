// Passage judging in the chat pipeline (docs/systemone.md §2, ADR-0020):
// after hybrid retrieval and fusion, the top candidates are judged by the
// platform's SystemOne model and routed to evidence, conflicting evidence
// or dropped. It runs in always mode and for each search_knowledge call.
// Judging is quality, not safety: a failed or slow request keeps the
// passage at its fused rank (fail-open). Only counts are recorded, never
// text (ADR-0010).

package agents

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/systemone"
)

// NoContextJudgedOut is the no-context reason of a strict agent whose
// candidates were all dropped by judging: it refused without a chat-model
// call.
const NoContextJudgedOut = "judged_out"

// maxConflicting bounds the conflicting passages given to the model per
// search.
const maxConflicting = 3

// planSystemOne resolves the SystemOne features of this chat: passage
// judging, citation checks and the scope check (nil: off, and the pipeline
// is exactly as without SystemOne). A settings failure is logged and the
// features skipped: they are quality features.
func (ru *run) planSystemOne(ctx context.Context) {
	if ru.s.SystemOne == nil {
		return
	}
	var o systemone.Override
	if ru.cfg.SystemOne != nil {
		o = *ru.cfg.SystemOne
	}
	plans, err := ru.s.SystemOne.Plans(ctx, o)
	if err != nil {
		ru.s.Log.Warn("SystemOne features unavailable; skipping them", "err", err, "agent", ru.agent.ID)
		return
	}
	ru.retr.judge, ru.cite, ru.scope = plans.Judge, plans.Citations, plans.Scope
}

// JudgingRecord is the content-free record of an answer's judging
// (message_events.judging).
type JudgingRecord struct {
	Mode        string         `json:"mode"`
	Searches    int            `json:"searches"`
	Candidates  int            `json:"candidates"`
	Evidence    int            `json:"evidence"`
	Conflicting int            `json:"conflicting"`
	Kept        int            `json:"kept"` // passages given to the model
	Dropped     map[string]int `json:"dropped"`
	Skipped     int            `json:"skipped"`
	Requests    int            `json:"requests"`
	LatencyMs   int64          `json:"latencyMs"`
	// NoContextReason is judged_out when a strict agent refused because
	// judging dropped every candidate.
	NoContextReason string `json:"noContextReason,omitempty"`
}

// searchJudging is one search's judging outcome.
type searchJudging struct {
	judged, kept, dropped int
}

// judgeCandidates judges the fused candidates of one search and returns
// the evidence and conflicting passages, each best first. The step is
// bounded by twice the per-request timeout; requests still waiting for a
// slot then are skipped.
func (r *retriever) judgeCandidates(ctx context.Context, query string, merged []*fusedHit) (evidence, conflicting []*fusedHit, js []systemone.Judgment) {
	plan := r.judge
	cands := merged[:min(len(merged), plan.Candidates)]
	ps := make([]systemone.Passage, len(cands))
	for i, f := range cands {
		ps[i] = kbs.PassageOf(f.hit)
	}
	jctx, cancel := context.WithTimeout(ctx, 2*plan.Options.Timeout) // fail-open beyond this

	defer cancel()
	js, st := plan.Client.Judge(jctx, query, ps, plan.Options)
	for _, i := range systemone.Rank(js, func(j systemone.Judgment) bool { return j.Route == systemone.RouteEvidence }) {
		evidence = append(evidence, cands[i])
	}
	for _, i := range systemone.Rank(js, func(j systemone.Judgment) bool { return j.Route == systemone.RouteConflicting }) {
		conflicting = append(conflicting, cands[i])
	}
	r.mu.Lock()
	r.addJudging(plan.Options.Mode, js, st)
	r.mu.Unlock()
	return evidence, conflicting, js
}

// addJudging adds one search to the answer's record. r.mu must be held.
func (r *retriever) addJudging(mode string, js []systemone.Judgment, st systemone.JudgeStats) {
	if r.judging == nil {
		r.judging = &JudgingRecord{Mode: mode, Dropped: map[string]int{}}
	}
	rec := r.judging
	rec.Searches++
	rec.Candidates += len(js)
	rec.Requests += st.Requests
	rec.LatencyMs += st.Latency.Milliseconds()
	for _, j := range js {
		switch {
		case j.Skipped:
			rec.Skipped++
		case j.Route == systemone.RouteEvidence:
			rec.Evidence++
		case j.Route == systemone.RouteConflicting:
			rec.Conflicting++
		default:
			rec.Dropped[j.Reason]++
		}
	}
}

// countDropped counts the dropped judgments.
func countDropped(js []systemone.Judgment) int {
	n := 0
	for _, j := range js {
		if j.Route == systemone.RouteDropped {
			n++
		}
	}
	return n
}

// judgingJSON is the message_events.judging value (nil when nothing was
// judged).
func (ru *run) judgingJSON(ans *Answer) json.RawMessage {
	ru.retr.mu.Lock()
	defer ru.retr.mu.Unlock()
	rec := ru.retr.judging
	if rec == nil {
		return nil
	}
	rec.Kept = len(ru.retr.all)
	if ans.noContextReason != "" {
		rec.NoContextReason = ans.noContextReason
	}
	b, _ := json.Marshal(rec)
	return b
}

// judgedOut reports whether this search judged candidates and kept none.
func (sj *searchJudging) judgedOut() bool { return sj != nil && sj.judged > 0 && sj.kept == 0 }

// event is the SSE retrieval event's counts (nil when not judged).
func (sj *searchJudging) event() *RetrievalJudging {
	if sj == nil {
		return nil
	}
	return &RetrievalJudging{Judged: sj.judged, Kept: sj.kept, Dropped: sj.dropped}
}

// systemOneUsage are the usage events of the chat's SystemOne requests
// (judging and moderation), by model and feature.
func (ru *run) systemOneUsage() []dbgen.InsertUsageParams {
	var out []dbgen.InsertUsageParams
	for _, e := range ru.meter.Entries() {
		if e.InputTokens <= 0 {
			continue
		}
		meta, _ := json.Marshal(map[string]any{"channel": ru.channel, "agentVersion": ru.versionNum(), "feature": e.Feature})
		out = append(out, dbgen.InsertUsageParams{Kind: systemone.UsageKind, Quantity: e.InputTokens,
			ModelID: uuid.NullUUID{UUID: e.ModelID, Valid: e.ModelID != uuid.Nil}, Metadata: meta})
	}
	return out
}
