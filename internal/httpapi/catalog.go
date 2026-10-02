package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/catalog"
	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func deref[T any](p *T, fallback T) T {
	if p == nil {
		return fallback
	}
	return *p
}

// ---- conversions ------------------------------------------------------------

func toAPIConnection(c catalog.Connection) apitypes.Connection {
	return apitypes.Connection{
		Id: c.ID, Name: c.Name, Description: c.Description, BaseUrl: c.BaseURL,
		HasApiKey: c.ApiKeyCiphertext != nil, ApiKeyHint: c.ApiKeyHint,
		TimeoutSeconds: c.TimeoutSeconds, RequestsPerMinute: c.RequestsPerMinute, MaxConcurrentRequests: c.MaxConcurrentRequests,
		Enabled: c.Enabled, ModelCount: c.ModelCount,
		Revision: c.Revision, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

func toAPICompat(c catalog.Compat) apitypes.ModelCompat {
	out := apitypes.ModelCompat{
		SupportsDeveloperRole:   c.SupportsDeveloperRole,
		SupportsReasoningEffort: c.SupportsReasoningEffort,
		SupportsStreamUsage:     c.SupportsStreamUsage,
		MaxTokensField:          (*apitypes.ModelCompatMaxTokensField)(c.MaxTokensField),
		SupportsToolChoice:      c.SupportsToolChoice,
		ThinkingField:           (*apitypes.ModelCompatThinkingField)(c.ThinkingField),
		ThinkingOff:             (*apitypes.ModelCompatThinkingOff)(c.ThinkingOff),
		SupportsDimensionsParam: c.SupportsDimensionsParam,
		RerankDocumentsField:    (*apitypes.ModelCompatRerankDocumentsField)(c.RerankDocumentsField),
		SupportsRerankTopN:      c.SupportsRerankTopN,
	}
	if len(c.ExtraBody) > 0 {
		out.ExtraBody = &c.ExtraBody
	}
	return out
}

func fromAPICompat(c *apitypes.ModelCompat) *catalog.Compat {
	if c == nil {
		return nil
	}
	return &catalog.Compat{
		SupportsDeveloperRole:   c.SupportsDeveloperRole,
		SupportsReasoningEffort: c.SupportsReasoningEffort,
		SupportsStreamUsage:     c.SupportsStreamUsage,
		MaxTokensField:          (*string)(c.MaxTokensField),
		SupportsToolChoice:      c.SupportsToolChoice,
		ThinkingField:           (*string)(c.ThinkingField),
		ThinkingOff:             (*string)(c.ThinkingOff),
		SupportsDimensionsParam: c.SupportsDimensionsParam,
		RerankDocumentsField:    (*string)(c.RerankDocumentsField),
		SupportsRerankTopN:      c.SupportsRerankTopN,
		ExtraBody:               deref(c.ExtraBody, nil),
	}
}

func toAPIFusionWeights(vector, keyword *float64) *apitypes.FusionWeights {
	if vector == nil || keyword == nil {
		return nil
	}
	return &apitypes.FusionWeights{Vector: *vector, Keyword: *keyword}
}

func fromAPIProfileWeights(w *apitypes.FusionWeights) *catalog.FusionWeights {
	if w == nil {
		return nil
	}
	return &catalog.FusionWeights{Vector: w.Vector, Keyword: w.Keyword}
}

func toAPIModel(m dbgen.Model) apitypes.Model {
	return apitypes.Model{
		Id: m.ID, ConnectionId: m.ConnectionID, Key: m.Key, UpstreamModel: m.UpstreamModel,
		DisplayName: m.DisplayName, Description: m.Description, Kind: apitypes.ModelKind(m.Kind),
		MaxClassification: m.MaxClassification, Enabled: m.Enabled,
		ContextWindow: m.ContextWindow, MaxOutputTokens: m.MaxOutputTokens,
		SupportsTools: m.SupportsTools, SupportsVision: m.SupportsVision,
		Dimensions: m.Dimensions, MaxInputTokens: m.MaxInputTokens,
		Compat: toAPICompat(catalog.DecodeCompat(m.Compat)), Revision: m.Revision,
		CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
		ModerationProvider:       (*apitypes.ModerationProvider)(m.ModerationProvider),
		ModerationFamily:         (*apitypes.GuardrailFamily)(m.ModerationFamily),
		ModerationTimeoutSeconds: m.ModerationTimeoutSeconds,
	}
}

func toAPIProfile(p catalog.Profile) apitypes.EmbeddingProfile {
	return apitypes.EmbeddingProfile{
		Id: p.ID, Key: p.Key, Name: p.Name, Description: p.Description,
		Model: apitypes.ModelRef{
			Id: p.Model.ID, Key: p.Model.Key, DisplayName: p.Model.DisplayName,
			MaxClassification: p.Model.MaxClassification, Enabled: p.Model.Enabled,
		},
		Dimensions: p.Dimensions, StorageType: apitypes.EmbeddingProfileStorageType(p.StorageType),
		DocumentPrefix: p.DocumentPrefix, QueryPrefix: p.QueryPrefix,
		ChunkSize: p.ChunkSize, ChunkOverlap: p.ChunkOverlap, ChunkerVersion: p.ChunkerVersion,
		Status: apitypes.EmbeddingProfileStatus(p.Status), IsDefault: p.IsDefault,
		Revision: p.Revision, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		OutputDimensions:     p.OutputDimensions,
		DefaultFusionWeights: toAPIFusionWeights(p.DefaultVectorWeight, p.DefaultKeywordWeight),
	}
}

func toAPIProxyError(e *catalog.ProbeError) *apitypes.ProxyError {
	if e == nil {
		return nil
	}
	out := &apitypes.ProxyError{Kind: apitypes.ProxyErrorKind(e.Kind), Message: e.Message}
	if e.Status > 0 {
		out.Status = &e.Status
	}
	return out
}

func toAPIUsage(u gateway.Usage) *apitypes.TokenUsage {
	return &apitypes.TokenUsage{PromptTokens: u.PromptTokens, CompletionTokens: u.CompletionTokens, TotalTokens: u.TotalTokens}
}

// ---- connections --------------------------------------------------------------

func (a *api) adminListConnections(w http.ResponseWriter, r *http.Request) {
	conns, err := a.Catalog.ListConnections(r.Context(), a.actor(r))
	writeList(w, r, conns, err, toAPIConnection)
}

func (a *api) adminCreateConnection(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ConnectionCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	c, err := a.Catalog.CreateConnection(r.Context(), a.actor(r), catalog.ConnectionInput{
		Name: in.Name, Description: deref(in.Description, ""), BaseURL: in.BaseUrl,
		APIKey: deref(in.ApiKey, ""), TimeoutSeconds: deref(in.TimeoutSeconds, 0), Enabled: deref(in.Enabled, true),
		RequestsPerMinute: deref(in.RequestsPerMinute, 0), MaxConcurrentRequests: deref(in.MaxConcurrentRequests, 0),
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, c.Revision, toAPIConnection(c))
}

func (a *api) adminGetConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "connectionId")
	if !ok {
		return
	}
	c, err := a.Catalog.GetConnection(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, c.Revision, toAPIConnection(c))
}

func (a *api) adminUpdateConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "connectionId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.ConnectionUpdate](w, r)
	if !ok {
		return
	}
	c, err := a.Catalog.UpdateConnection(r.Context(), a.actor(r), id, catalog.ConnectionUpdate{
		Name: in.Name, Description: in.Description, BaseURL: in.BaseUrl, APIKey: in.ApiKey,
		TimeoutSeconds: in.TimeoutSeconds, Enabled: in.Enabled, RequestsPerMinute: in.RequestsPerMinute,
		MaxConcurrentRequests: in.MaxConcurrentRequests,
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, c.Revision, toAPIConnection(c))
}

func (a *api) adminDeleteConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "connectionId")
	if !ok {
		return
	}
	writeOK(w, r, a.Catalog.DeleteConnection(r.Context(), a.actor(r), id))
}

func (a *api) adminTestConnection(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "connectionId")
	if !ok {
		return
	}
	r = probeRequest(r)
	res, err := a.Catalog.TestConnection(r.Context(), a.actor(r), id)
	if a.actor(r).IsPlatformAdmin() {
		// Stored health; an error that proves nothing is not stored.
		a.recordConnectionTest(r, id, res, err)
	}
	if failed(w, r, err) {
		return
	}
	models := res.Models
	if models == nil {
		models = []string{}
	}
	out := apitypes.ConnectionTestResult{
		Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), Models: models, Error: toAPIProxyError(res.Error),
		Probe: apitypes.ConnectionTestResultProbe(res.Probe), Timings: probeTimings(r),
	}
	if res.SystemOneModel != "" {
		out.SystemOneModel = &res.SystemOneModel
	}
	httpx.JSON(w, http.StatusOK, out)
}

// ---- models -------------------------------------------------------------------

func (a *api) adminListModels(w http.ResponseWriter, r *http.Request) {
	var f catalog.ModelFilter
	if k := r.URL.Query().Get("kind"); k != "" {
		f.Kind = &k
	}
	if c := r.URL.Query().Get("connectionId"); c != "" {
		id, err := uuid.Parse(c)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid connectionId")
			return
		}
		f.ConnectionID = &id
	}
	models, err := a.Catalog.ListModels(r.Context(), a.actor(r), f)
	writeList(w, r, models, err, toAPIModel)
}

func (a *api) adminCreateModel(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ModelCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	compat := catalog.Compat{}
	if c := fromAPICompat(in.Compat); c != nil {
		compat = *c
	}
	m, err := a.Catalog.CreateModel(r.Context(), a.actor(r), catalog.ModelInput{
		ConnectionID: in.ConnectionId, Key: in.Key, Kind: string(in.Kind),
		ModelSpec: catalog.ModelSpec{
			UpstreamModel: in.UpstreamModel, DisplayName: in.DisplayName, Description: deref(in.Description, ""),
			MaxClassification: in.MaxClassification, Enabled: deref(in.Enabled, true),
			ContextWindow: in.ContextWindow, MaxOutputTokens: in.MaxOutputTokens,
			SupportsTools: deref(in.SupportsTools, false), SupportsVision: deref(in.SupportsVision, false),
			Dimensions: in.Dimensions, MaxInputTokens: in.MaxInputTokens, Compat: compat,
			ModerationProvider: string(deref(in.ModerationProvider, "")), ModerationFamily: string(deref(in.ModerationFamily, "")),
			ModerationTimeoutSeconds: in.ModerationTimeoutSeconds,
		},
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, m.Revision, toAPIModel(m))
}

func (a *api) adminGetModel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	m, err := a.Catalog.GetModel(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, m.Revision, toAPIModel(m))
}

func (a *api) adminUpdateModel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.ModelUpdate](w, r)
	if !ok {
		return
	}
	m, err := a.Catalog.UpdateModel(r.Context(), a.actor(r), id, catalog.ModelUpdate{
		UpstreamModel: in.UpstreamModel, DisplayName: in.DisplayName, Description: in.Description,
		MaxClassification: in.MaxClassification, Enabled: in.Enabled,
		ContextWindow: in.ContextWindow, MaxOutputTokens: in.MaxOutputTokens,
		SupportsTools: in.SupportsTools, SupportsVision: in.SupportsVision,
		Dimensions: in.Dimensions, MaxInputTokens: in.MaxInputTokens, Compat: fromAPICompat(in.Compat),
		ModerationProvider: (*string)(in.ModerationProvider), ModerationFamily: (*string)(in.ModerationFamily),
		ModerationTimeoutSeconds: in.ModerationTimeoutSeconds,
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, m.Revision, toAPIModel(m))
}

func (a *api) adminDeleteModel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	writeOK(w, r, a.Catalog.DeleteModel(r.Context(), a.actor(r), id))
}

func (a *api) adminTestModel(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "modelId")
	if !ok {
		return
	}
	r = probeRequest(r)
	if m, err := a.Catalog.GetModel(r.Context(), a.actor(r), id); err == nil {
		switch m.Kind {
		case catalog.KindModeration:
			a.testModerationModel(w, r, id)
			return
		case catalog.KindSystemOne:
			a.testSystemOneModel(w, r, id)
			return
		case catalog.KindVision:
			a.testVisionModel(w, r, id)
			return
		}
	}
	res, err := a.Catalog.TestModel(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ModelTestResult{
		Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), Error: toAPIProxyError(res.Error),
		Dimensions: res.Dimensions, DimensionsMatch: res.DimensionsMatch, Timings: probeTimings(r), Rerank: toAPIRerankTest(res.Rerank),
	}
	if res.OK {
		out.Usage = toAPIUsage(res.Usage)
		if res.Reply != "" {
			out.Reply = &res.Reply
		}
	}
	a.writeModelTest(w, r, id, out)
}

// ---- embedding profiles ---------------------------------------------------------

func (a *api) adminListEmbeddingProfiles(w http.ResponseWriter, r *http.Request) {
	profiles, err := a.Catalog.ListProfiles(r.Context(), a.actor(r))
	writeList(w, r, profiles, err, toAPIProfile)
}

func (a *api) adminCreateEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	var in apitypes.EmbeddingProfileCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	p, err := a.Catalog.CreateProfile(r.Context(), a.actor(r), catalog.ProfileInput{
		Key: in.Key, Name: in.Name, Description: deref(in.Description, ""), ModelID: in.ModelId,
		StorageType: string(deref(in.StorageType, "")), DocumentPrefix: deref(in.DocumentPrefix, ""),
		QueryPrefix: deref(in.QueryPrefix, ""), ChunkSize: deref(in.ChunkSize, 0),
		ChunkOverlap: deref(in.ChunkOverlap, 0), IsDefault: deref(in.IsDefault, false),
		OutputDimensions: in.OutputDimensions, DefaultWeights: fromAPIProfileWeights(in.DefaultFusionWeights),
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, p.Revision, toAPIProfile(p))
}

func (a *api) adminGetEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "profileId")
	if !ok {
		return
	}
	p, err := a.Catalog.GetProfile(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, p.Revision, toAPIProfile(p))
}

func (a *api) adminUpdateEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "profileId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.EmbeddingProfileUpdate](w, r)
	if !ok {
		return
	}
	p, err := a.Catalog.UpdateProfile(r.Context(), a.actor(r), id, catalog.ProfileUpdate{
		Name: in.Name, Description: in.Description, Status: (*string)(in.Status), IsDefault: in.IsDefault,
		DefaultWeights: fromAPIProfileWeights(in.DefaultFusionWeights), PlatformWeights: deref(in.UsePlatformFusionWeights, false),
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, p.Revision, toAPIProfile(p))
}

func (a *api) adminDeleteEmbeddingProfile(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "profileId")
	if !ok {
		return
	}
	writeOK(w, r, a.Catalog.DeleteProfile(r.Context(), a.actor(r), id))
}
