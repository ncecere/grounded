// Answer cache handlers (docs/answer-cache.md): an agent's settings and
// Clear cache (Agent → Settings), and the platform switch (Admin →
// Overview → Features).

package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/answercache"
	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// answerCacheRoutes: an agent's cache and the platform switch.
func (a *api) answerCacheRoutes() []route {
	return []route{
		{"GET", "/v1/teams/{team}/agents/{agentId}/answer-cache", a.session(a.getAgentAnswerCache)},
		{"PUT", "/v1/teams/{team}/agents/{agentId}/answer-cache", a.session(a.updateAgentAnswerCache)},
		{"POST", "/v1/teams/{team}/agents/{agentId}/answer-cache/clear", a.session(a.clearAgentAnswerCache)},
		{"GET", "/v1/admin/settings/answer-cache", a.admin(a.adminGetAnswerCacheSettings)},
		{"PUT", "/v1/admin/settings/answer-cache", a.admin(a.adminPutAnswerCacheSettings)},
	}
}

func toAPIAnswerCache(v agents.AnswerCacheView) apitypes.AgentAnswerCache {
	return apitypes.AgentAnswerCache{Enabled: v.Enabled, On: v.On, Audience: apitypes.Audience(v.Audience), NearIdentical: v.NearIdentical,
		NearIdenticalAvailable: v.NearIdenticalAvailable, ExpiryHours: v.ExpiryHours, PlatformEnabled: v.PlatformEnabled,
		Entries: v.Stats.Entries, Hits: v.Stats.Hits, Revision: v.Revision, UpdatedAt: v.UpdatedAt}
}

func (a *api) getAgentAnswerCache(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	v, err := a.Agents.AnswerCache(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.Revision, toAPIAnswerCache(v))
}

func (a *api) updateAgentAnswerCache(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.AgentAnswerCacheUpdate](w, r)
	if !ok {
		return
	}
	v, err := a.Agents.SetAnswerCache(r.Context(), a.actor(r), r.PathValue("team"), id,
		answercache.AgentInput{Enabled: in.Enabled, NearIdentical: in.NearIdentical, ExpiryHours: in.ExpiryHours}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.Revision, toAPIAnswerCache(v))
}

func (a *api) clearAgentAnswerCache(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	n, err := a.Agents.ClearAnswerCache(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.AnswerCacheCleared{Cleared: n})
}

var errNoAnswerCache = apperr.New(http.StatusServiceUnavailable, "answer_cache_unavailable", "The answer cache is not available")

func (a *api) adminGetAnswerCacheSettings(w http.ResponseWriter, r *http.Request) {
	if a.AnswerCache == nil {
		failed(w, r, errNoAnswerCache)
		return
	}
	st, err := a.AnswerCache.Platform(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, apitypes.AnswerCacheSettings{Enabled: st.Enabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}

func (a *api) adminPutAnswerCacheSettings(w http.ResponseWriter, r *http.Request) {
	if a.AnswerCache == nil {
		failed(w, r, errNoAnswerCache)
		return
	}
	in, rev, ok := decodeRevised[apitypes.AnswerCacheSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.AnswerCache.SetPlatform(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, apitypes.AnswerCacheSettings{Enabled: st.Enabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}
