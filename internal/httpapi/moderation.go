// Moderation admin handlers (docs/phase4-publishing.md §4, ADR-0019):
// per-audience policies and the provider test box.

package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/moderation"
)

// moderationAdminRoutes: moderation policies and provider tests.
func (a *api) moderationAdminRoutes() []route {
	return []route{
		{"GET", "/v1/admin/moderation/policies/{audience}", a.admin(a.adminGetModerationPolicy)},
		{"PUT", "/v1/admin/moderation/policies/{audience}", a.admin(a.adminPutModerationPolicy)},
		{"POST", "/v1/admin/moderation/test", a.admin(a.adminTestModeration)},
	}
}

func toAPIModerationPolicy(st moderation.Stored) apitypes.ModerationPolicy {
	return apitypes.ModerationPolicy{
		Audience: apitypes.Audience(st.Audience), ModelId: st.ModelID,
		Categories: viaJSON[map[string]apitypes.ModerationCategoryRules](st.Policy.Categories),
		OutputMode: apitypes.ModerationOutputMode(st.Policy.OutputMode), FailClosed: st.Policy.FailClosed,
		Notice: st.Policy.Notice, Revision: st.Revision, UpdatedAt: st.UpdatedAt,
		SeverityBlock: st.Policy.SeverityBlock, SupportMessage: st.Policy.SupportMessage,
		UncalibratedBlockThreshold: st.Policy.UncalibratedBlockThreshold,
	}
}

// toAPIModerationResult lists the scores in category order.
func toAPIModerationResult(r moderation.Result) apitypes.ModerationResult {
	out := apitypes.ModerationResult{Provider: r.Provider, Calibrated: r.Calibrated, LatencyMs: r.Latency.Milliseconds(),
		Scores: make([]apitypes.ModerationScore, 0, len(moderation.Categories)), Severity: r.Severity}
	for _, c := range moderation.Categories {
		s := r.Scores[c]
		out.Scores = append(out.Scores, apitypes.ModerationScore{Category: apitypes.ModerationCategory(c), Probability: s.Probability, Supported: s.Supported})
	}
	return out
}

func (a *api) adminGetModerationPolicy(w http.ResponseWriter, r *http.Request) {
	st, err := a.Moderation.GetPolicy(r.Context(), a.actor(r), r.PathValue("audience"))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIModerationPolicy(st))
}

func (a *api) adminPutModerationPolicy(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.ModerationPolicyInput](w, r)
	if !ok {
		return
	}
	pol := moderation.Policy{
		Categories: viaJSON[map[string]moderation.CategoryRules](in.Categories),
		OutputMode: string(in.OutputMode), FailClosed: in.FailClosed, Notice: deref(in.Notice, ""),
		SeverityBlock: in.SeverityBlock, SupportMessage: deref(in.SupportMessage, ""),
		UncalibratedBlockThreshold: deref(in.UncalibratedBlockThreshold, moderation.DefaultUncalibratedBlockThreshold),
	}
	st, err := a.Moderation.PutPolicy(r.Context(), a.actor(r), r.PathValue("audience"),
		moderation.PolicyInput{ModelID: in.ModelId, Policy: pol}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIModerationPolicy(st))
}

func (a *api) adminTestModeration(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ModerationTestRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	stage := ""
	if in.Stage != nil {
		stage = string(*in.Stage)
	}
	res, err := a.Moderation.Test(r.Context(), a.actor(r), in.ModelId, stage, in.Text)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIModerationResult(res))
}

// testModerationModel is "Test model" for a moderation model: a benign and
// a harmful sample.
func (a *api) testModerationModel(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	res, err := a.Moderation.TestModel(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ModelTestResult{Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), Error: toAPIProxyError(res.Error), Timings: probeTimings(r)}
	if res.OK {
		out.Moderation = &apitypes.ModerationModelTest{
			BenignText: res.BenignText, HarmfulText: res.HarmfulText,
			Benign: toAPIModerationResult(res.Benign), Harmful: toAPIModerationResult(res.Harmful),
		}
	}
	a.writeModelTest(w, r, id, out)
}
