package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/apikeys"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/kbs"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func (a *api) toAPIKB(kb kbs.KB) apitypes.KnowledgeBase {
	eff, source := kb.Weights(a.KBs.Weights)
	src := apitypes.KnowledgeBaseFusionWeightsSource(source)
	out := apitypes.KnowledgeBase{
		Id: kb.ID, Name: kb.Name, Description: kb.Description, EmbeddingProfileId: kb.EmbeddingProfileID,
		TopK: kb.TopK, Sources: make([]apitypes.KBSource, len(kb.Sources)), Revision: kb.Revision,
		EffectiveFusionWeights: &apitypes.FusionWeights{Vector: eff.Vector, Keyword: eff.Keyword},
		FusionWeightsSource:    &src,
		CreatedAt:              kb.CreatedAt, UpdatedAt: kb.UpdatedAt,
	}
	if kb.VectorWeight != nil && kb.KeywordWeight != nil {
		out.FusionWeights = &apitypes.FusionWeights{Vector: *kb.VectorWeight, Keyword: *kb.KeywordWeight}
	}
	for i, s := range kb.Sources {
		out.Sources[i] = apitypes.KBSource{Id: s.ID, Name: s.Name, Classification: s.Classification, Shared: s.Shared}
	}
	if kb.EffectiveClassification != "" {
		out.EffectiveClassification = &kb.EffectiveClassification
	}
	return out
}

func fromAPIWeights(w *apitypes.FusionWeights) *kbs.Weights {
	if w == nil {
		return nil
	}
	return &kbs.Weights{Vector: w.Vector, Keyword: w.Keyword}
}

func (a *api) listKBs(w http.ResponseWriter, r *http.Request) {
	list, err := a.KBs.List(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	out := make([]apitypes.KnowledgeBase, len(list))
	for i, kb := range list {
		out[i] = a.toAPIKB(kb)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) createKB(w http.ResponseWriter, r *http.Request) {
	var in apitypes.KnowledgeBaseCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	kb, err := a.KBs.Create(r.Context(), a.actor(r), r.PathValue("team"), kbs.Input{
		Name: in.Name, Description: deref(in.Description, ""), ProfileID: in.EmbeddingProfileId, TopK: deref(in.TopK, 0),
		Weights: fromAPIWeights(in.FusionWeights),
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, kb.Revision, a.toAPIKB(kb))
}

func (a *api) getKB(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	kb, err := a.KBs.Get(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, kb.Revision, a.toAPIKB(kb))
}

func (a *api) updateKB(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.KnowledgeBaseUpdate](w, r)
	if !ok {
		return
	}
	cur, err := a.KBs.Get(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	kb, err := a.KBs.Update(r.Context(), a.actor(r), r.PathValue("team"), id, kbs.Input{
		Name: deref(in.Name, cur.Name), Description: deref(in.Description, cur.Description), TopK: deref(in.TopK, cur.TopK),
		Weights: fromAPIWeights(in.FusionWeights), DefaultWeights: deref(in.UseDefaultFusionWeights, false),
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, kb.Revision, a.toAPIKB(kb))
}

func (a *api) deleteKB(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	writeOK(w, r, a.KBs.Delete(r.Context(), a.actor(r), r.PathValue("team"), id))
}

func (a *api) kbSource(w http.ResponseWriter, r *http.Request, attach bool) {
	kbID, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	srcID, ok := pathUUID(w, r, "sourceId")
	if !ok {
		return
	}
	var (
		kb  kbs.KB
		err error
	)
	if attach {
		kb, err = a.KBs.AttachSource(r.Context(), a.actor(r), r.PathValue("team"), kbID, srcID)
	} else {
		kb, err = a.KBs.DetachSource(r.Context(), a.actor(r), r.PathValue("team"), kbID, srcID)
	}
	if err != nil {
		a.fail(w, r, err) // classification_impact carries details
		return
	}
	httpx.JSON(w, http.StatusOK, a.toAPIKB(kb))
}

func (a *api) attachSource(w http.ResponseWriter, r *http.Request) { a.kbSource(w, r, true) }
func (a *api) detachSource(w http.ResponseWriter, r *http.Request) { a.kbSource(w, r, false) }

func (a *api) retrieve(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	var in apitypes.RetrieveRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	res, err := a.KBs.Retrieve(r.Context(), a.actor(r), r.PathValue("team"), id, kbs.Query{Text: in.Query, TopK: deref(in.TopK, 0),
		Filter: metadataFilter(in.Filters), Judge: deref(in.Judge, false), NoRerank: !deref(in.Rerank, true)})
	if failed(w, r, err) {
		return
	}
	out := apitypes.RetrieveResult{Hits: make([]apitypes.RetrieveHit, len(res.Hits)), LatencyMs: res.Latency.Milliseconds(),
		Judging: toAPIRetrieveJudging(res.Judging), Rerank: toAPIRetrieveRerank(res.Rerank)}
	for i, h := range res.Hits {
		hit := apitypes.RetrieveHit{
			ChunkId: h.ChunkID, DocumentId: h.DocumentID, SourceId: h.SourceID, Content: h.Content,
			HeadingPath: h.HeadingPath, Title: h.Title, Filename: h.Filename, Url: h.URL, Score: h.Score, RerankScore: h.RerankScore,
		}
		if hit.HeadingPath == nil {
			hit.HeadingPath = []string{}
		}
		if h.PageStart > 0 {
			hit.PageStart, hit.PageEnd = &h.PageStart, &h.PageEnd
		}
		if h.VectorRank > 0 {
			v := h.VectorRank
			hit.VectorRank = &v
		}
		if h.LexicalRank > 0 {
			l := h.LexicalRank
			hit.LexicalRank = &l
		}
		if res.Judging != nil {
			hit.Judgment = toAPIJudgment(res.Judging.Judgments[i])
		}
		out.Hits[i] = hit
	}
	httpx.JSON(w, http.StatusOK, out)
}

// ---- API keys ----

// toAPIListedKey is a listed key with its owner or contact named.
func toAPIListedKey(l apikeys.Listed) apitypes.APIKey {
	out := toAPIKey(l.APIKey)
	if l.APIKey.UserID.Valid && l.UserEmail != "" {
		out.Contact = &apitypes.APIKeyContact{UserId: l.APIKey.UserID.UUID, Name: l.UserName, Email: l.UserEmail}
	}
	return out
}

func toAPIKey(k dbgen.APIKey) apitypes.APIKey {
	out := apitypes.APIKey{
		Id: k.ID, Name: k.Name, Kind: apitypes.APIKeyKind(k.Kind), Prefix: k.Prefix,
		Scopes: make([]apitypes.APIKeyScope, len(k.Scopes)), ExpiresAt: k.ExpiresAt, LastUsedAt: k.LastUsedAt,
		CreatedAt: k.CreatedAt, UserId: nullUUID(k.UserID), RevokedAt: k.RevokedAt,
	}
	for i, s := range k.Scopes {
		out.Scopes[i] = apitypes.APIKeyScope(s)
	}
	if k.KBIDs != nil {
		ids := k.KBIDs
		out.KnowledgeBaseIds = &ids
	}
	if k.AgentIDs != nil {
		ids := k.AgentIDs
		out.AgentIds = &ids
	}
	return out
}

func (a *api) listAPIKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := a.APIKeys.List(r.Context(), a.actor(r), r.PathValue("team"))
	writeList(w, r, keys, err, toAPIListedKey)
}

func (a *api) getAPIKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "keyId")
	if !ok {
		return
	}
	k, err := a.APIKeys.Get(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIListedKey(k))
}

func (a *api) createAPIKey(w http.ResponseWriter, r *http.Request) {
	var in apitypes.APIKeyCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	scopes := make([]string, len(in.Scopes))
	for i, s := range in.Scopes {
		scopes[i] = string(s)
	}
	var kbIDs []uuid.UUID
	if in.KnowledgeBaseIds != nil {
		kbIDs = *in.KnowledgeBaseIds
	}
	created, err := a.APIKeys.Create(r.Context(), a.actor(r), r.PathValue("team"), apikeys.CreateInput{
		Name: in.Name, Kind: string(deref(in.Kind, "personal")), Scopes: scopes, KBIDs: kbIDs, ExpiresAt: in.ExpiresAt,
		AgentIDs: deref(in.AgentIds, nil), ResponsibleUserID: in.ResponsibleUserId,
	})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, apitypes.APIKeyCreated{Key: toAPIKey(created.Key), Secret: created.Secret})
}

func (a *api) updateAPIKeyContact(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "keyId")
	if !ok {
		return
	}
	var in struct {
		ResponsibleUserID uuid.UUID `json:"responsibleUserId"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	k, err := a.APIKeys.SetContact(r.Context(), a.actor(r), r.PathValue("team"), id, in.ResponsibleUserID)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIKey(k))
}

func (a *api) revokeAPIKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "keyId")
	if !ok {
		return
	}
	writeOK(w, r, a.APIKeys.Revoke(r.Context(), a.actor(r), r.PathValue("team"), id))
}

// metadataFilter converts the API filter.
func metadataFilter(f *apitypes.MetadataFilter) kbs.MetadataFilter {
	if f == nil {
		return kbs.MetadataFilter{}
	}
	out := kbs.MetadataFilter{UpdatedAfter: f.UpdatedAfter, UpdatedBefore: f.UpdatedBefore}
	if f.SourceIds != nil {
		out.SourceIDs = *f.SourceIds
	}
	if f.Kinds != nil {
		for _, k := range *f.Kinds {
			out.Kinds = append(out.Kinds, string(k))
		}
	}
	if f.Tags != nil {
		out.Tags = *f.Tags
	}
	if f.UrlPrefixes != nil {
		out.URLPrefixes = *f.UrlPrefixes
	}
	return out
}
