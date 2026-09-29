// SystemOne handlers (ADR-0020, docs/systemone.md): the platform settings,
// the status editors read, Test model for SystemOne models, and the
// playground's judgments.

package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/systemone"
)

// systemOneRoutes: the platform SystemOne settings and status.
func (a *api) systemOneRoutes() []route {
	return []route{
		{"GET", "/v1/admin/systemone", a.admin(a.adminGetSystemOne)},
		{"PUT", "/v1/admin/systemone", a.admin(a.adminPutSystemOne)},
		{"GET", "/v1/systemone/status", a.session(a.getSystemOneStatus)},
	}
}

func toAPISystemOne(st systemone.Stored, use systemone.AgentUse) apitypes.SystemOneSettings {
	return apitypes.SystemOneSettings{ModelId: st.ModelID, Judging: viaJSON[apitypes.SystemOneJudging](st.Settings.Judging),
		Citations: viaJSON[apitypes.SystemOneCitations](st.Settings.Citations), Scope: viaJSON[apitypes.SystemOneScope](st.Settings.Scope),
		Agents:   apitypes.SystemOneAgentUse{Judging: use.Judging, Citations: use.Citations, Scope: use.Scope, Any: use.Any},
		Revision: st.Revision, UpdatedAt: st.UpdatedAt}
}

// writeSystemOne writes the settings with how many agents use each check.
func (a *api) writeSystemOne(w http.ResponseWriter, r *http.Request, st systemone.Stored) {
	use, err := a.SystemOne.AgentUse(r.Context(), st)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPISystemOne(st, use))
}

func (a *api) adminGetSystemOne(w http.ResponseWriter, r *http.Request) {
	st, err := a.SystemOne.Get(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	a.writeSystemOne(w, r, st)
}

func (a *api) adminPutSystemOne(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.SystemOneSettingsInput](w, r)
	if !ok {
		return
	}
	put := systemone.Input{ModelID: in.ModelId, Settings: systemone.Settings{Judging: viaJSON[systemone.Judging](in.Judging)},
		KeepCitations: in.Citations == nil, KeepScope: in.Scope == nil}
	if in.Citations != nil {
		put.Settings.Citations = viaJSON[systemone.Citations](*in.Citations)
	}
	if in.Scope != nil {
		put.Settings.Scope = viaJSON[systemone.Scope](*in.Scope)
	}
	st, err := a.SystemOne.Put(r.Context(), a.actor(r), put, rev)
	if failed(w, r, err) {
		return
	}
	a.writeSystemOne(w, r, st)
}

func (a *api) getSystemOneStatus(w http.ResponseWriter, r *http.Request) {
	st, err := a.SystemOne.Status(r.Context())
	if failed(w, r, err) {
		return
	}
	out := apitypes.SystemOneStatus{Available: st.Available}
	out.Judging.Enabled, out.Judging.Candidates = st.JudgingEnabled, st.JudgingCandidates
	out.Citations.Enabled, out.Citations.Mode = st.Citations.Enabled, apitypes.SystemOneStatusCitationsMode(st.Citations.Mode)
	out.Scope.Enabled = st.Scope.Enabled
	httpx.JSON(w, http.StatusOK, out)
}

// testSystemOneModel is "Test model" for a SystemOne model: one fixed noul
// and one fixed score question.
func (a *api) testSystemOneModel(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	res, err := a.SystemOne.TestModel(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ModelTestResult{Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), Error: toAPIProxyError(res.Error), Timings: probeTimings(r)}
	if res.OK {
		out.SystemOne = &apitypes.SystemOneModelTest{
			NoulState: systemone.TestNoulState, NoulQuestion: systemone.TestNoulQuestion, Noul: res.Noul,
			ScoreState: systemone.TestScoreState, ScoreQuestion: systemone.TestScoreQuestion,
			ScoreLevels: systemone.TestScoreLevels, Score: res.Score,
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func toAPIJudgment(j systemone.Judgment) *apitypes.PassageJudgment {
	out := &apitypes.PassageJudgment{Relevant: j.Scores.Relevant, Evidence: j.Scores.Evidence, Contradicts: j.Scores.Contradicts,
		Injection: j.Scores.Injection, Route: apitypes.PassageJudgmentRoute(j.Route), Skipped: j.Skipped}
	if j.Reason != "" {
		reason := apitypes.PassageJudgmentReason(j.Reason)
		out.Reason = &reason
	}
	return out
}

func toAPIRetrieveJudging(j *kbs.Judging) *apitypes.RetrieveJudging {
	if j == nil {
		return nil
	}
	out := &apitypes.RetrieveJudging{Mode: apitypes.RetrieveJudgingMode(j.Mode), Judged: len(j.Judgments),
		Requests: j.Stats.Requests, LatencyMs: j.Stats.Latency.Milliseconds()}
	for _, x := range j.Judgments {
		switch {
		case x.Skipped:
			out.Skipped++
			out.Kept++
		case x.Route == systemone.RouteDropped:
			out.Dropped++
		default:
			out.Kept++
		}
	}
	return out
}
