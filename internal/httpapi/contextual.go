package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/contextual"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Contextual chunks (A4, #21; docs/contextual-chunks.md): a source's opt-in and settings are for platform admins (auditors read), and the
// estimate is a read. Nothing here returns generated text.

func (a *api) contextualRoutes() []route {
	return []route{
		{"GET", "/v1/admin/sources/{sourceId}/contextual", a.admin(a.adminGetSourceContextual)},
		{"PUT", "/v1/admin/sources/{sourceId}/contextual", a.admin(a.adminPutSourceContextual)},
		{"POST", "/v1/admin/sources/{sourceId}/contextual/estimate", a.adminRead(a.adminEstimateSourceContextual)},
		{"POST", "/v1/admin/profile-migrations/contextual-estimate", a.adminRead(a.adminEstimateContextualKB)},
		{"GET", "/v1/teams/{team}/sources/{sourceId}/contextual", a.session(a.getSourceContextual)},
	}
}

func (a *api) adminGetSourceContextual(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	st, err := a.Contextual.Get(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIContextual(st))
}

func (a *api) adminPutSourceContextual(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.ContextualSettingsInput](w, r)
	if !ok {
		return
	}
	st, err := a.Contextual.Put(r.Context(), a.actor(r), id, contextual.PutInput{Enabled: in.Enabled, ModelID: in.ModelId,
		FailurePolicy: string(in.FailurePolicy), MaxCalls: int(in.MaxCalls), MaxCallsPerDay: int(in.MaxCallsPerDay)}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIContextual(st))
}

func (a *api) getSourceContextual(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	st, err := a.Contextual.GetForTeam(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIContextual(st))
}

func (a *api) adminEstimateSourceContextual(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	var in struct {
		ModelID *uuid.UUID `json:"modelId"`
	}
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	est, err := a.Contextual.EstimateSource(r.Context(), a.actor(r), id, contextual.EstimateInput{ModelID: in.ModelID})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPISourceEstimate(est))
}

func (a *api) adminEstimateContextualKB(w http.ResponseWriter, r *http.Request) {
	var in struct {
		KbID uuid.UUID `json:"kbId"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	est, err := a.Contextual.EstimateKB(r.Context(), a.actor(r), in.KbID)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ContextualKBEstimate{KbId: est.KBID, Sources: make([]apitypes.ContextualSourceEstimate, len(est.Sources)),
		SourcesWithout: int32(len(est.Skipped)), Cost: toAPICost(est.Cost), Blockers: toAPIContextualIssues(est.Blockers),
		Calls: est.Calls, Documents: est.Documents, DocumentsOver: est.DocumentsOver, EmbeddingTokensAdded: est.EmbeddingTokensAdded,
		InputTokensMax: est.InputTokensMax, OutputTokensMax: est.OutputTokensMax, Passages: est.Passages, PassagesOver: est.PassagesOver, Units: est.Units}
	for i, s := range est.Sources {
		out.Sources[i] = toAPISourceEstimate(s)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func toAPIContextualIssues(list []contextual.Issue) []apitypes.ContextualIssue {
	out := make([]apitypes.ContextualIssue, len(list))
	for i, is := range list {
		out[i] = apitypes.ContextualIssue{Code: is.Code, Message: is.Message}
	}
	return out
}

func toAPICost(c contextual.Cost) apitypes.ContextualCost {
	out := apitypes.ContextualCost{PriceKnown: c.PriceKnown, Currency: c.Currency}
	if c.PriceKnown {
		out.InputPerMillion, out.OutputPerMillion, out.MaxAmount = &c.InputPerMillion, &c.OutputPerMillion, &c.MaxAmount
	}
	return out
}

func toAPISourceEstimate(e contextual.SourceEstimate) apitypes.ContextualSourceEstimate {
	return apitypes.ContextualSourceEstimate{SourceId: e.SourceID, Name: e.Name, Classification: e.Classification, Enabled: e.Enabled,
		ModelId: nullUUID(e.Model), ModelName: e.ModelName, CachedContexts: e.CachedContexts, MaxCalls: int32(e.MaxCalls),
		MaxCallsPerDay: int32(e.MaxCallsPerDay), UnknownCallTokensIn: int32(e.UnknownCallTokensIn), UnknownCallTokensOut: int32(e.UnknownCallTokensOut),
		Cost: toAPICost(e.Cost), Blockers: toAPIContextualIssues(e.Blockers),
		Calls: e.Calls, Documents: e.Documents, DocumentsOver: e.DocumentsOver, EmbeddingTokensAdded: e.EmbeddingTokensAdded,
		InputTokensMax: e.InputTokensMax, OutputTokensMax: e.OutputTokensMax, Passages: e.Passages, PassagesOver: e.PassagesOver, Units: e.Units}
}

func toAPICalls(c contextual.CallStats) apitypes.ContextualCallStats {
	return apitypes.ContextualCallStats{Attempts: c.Attempts, Ok: c.OK, Unusable: c.Unusable, Unknown: c.Unknown, TokensIn: c.TokensIn, TokensOut: c.TokensOut}
}

func toAPIContextualSet(s contextual.SetState) apitypes.ContextualSet {
	return apitypes.ContextualSet{ProfileId: s.ProfileID, ProfileKey: s.ProfileKey, Live: s.Live, DocumentsWithContext: s.Context,
		DocumentsFallback: s.Fallback, DocumentsTooLarge: s.TooLarge, DocumentsOff: s.Off, DocumentsNoRoom: s.NoRoom,
		Passages: s.Passages, PassagesWithContext: s.ContextualPassages, Calls: toAPICalls(s.Calls)}
}

func toAPIContextual(st contextual.State) apitypes.ContextualChunks {
	out := apitypes.ContextualChunks{SourceId: st.SourceID, SourceName: st.SourceName, Classification: st.Classification,
		PlatformEnabled: st.PlatformOn, Enabled: st.Enabled, ModelId: nullUUID(st.ModelID), ModelName: st.ModelName,
		FailurePolicy: apitypes.ContextualChunksFailurePolicy(st.FailurePolicy), MaxCalls: int32(st.MaxCalls), MaxCallsPerDay: int32(st.MaxCallsPerDay),
		CachedContexts: st.CachedContexts, Calls: toAPICalls(st.Calls), Sets: make([]apitypes.ContextualSet, len(st.Sets)), Revision: st.Revision}
	for i, s := range st.Sets {
		out.Sets[i] = toAPIContextualSet(s)
	}
	return out
}
