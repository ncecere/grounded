// Publishing handlers (docs/phase4-publishing.md §3, §6, §7): an agent's
// sharing (audience options, links, widget), publishable keys, short names
// and the platform's public access settings.

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/public"
)

// publishingRoutes: sharing, publishable keys, short names and public access.
func (a *api) publishingRoutes() []route {
	keys := "/v1/teams/{team}/agents/{agentId}/publishable-keys"
	return []route{
		{"GET", "/v1/teams/{team}/agents/{agentId}/sharing", a.session(a.getAgentSharing)},
		{"GET", keys, a.session(a.listPublishableKeys)},
		{"POST", keys, a.session(a.createPublishableKey)},
		{"PATCH", keys + "/{keyId}", a.session(a.updatePublishableKey)},
		{"DELETE", keys + "/{keyId}", a.session(a.revokePublishableKey)},
		{"POST", "/v1/widget-origins/check", a.session(a.checkWidgetOrigins)},
		{"PUT", "/v1/admin/agents/{agentId}/short-name", a.admin(a.adminSetAgentShortName)},
		{"GET", "/v1/admin/settings/public-access", a.admin(a.adminGetPublicAccess)},
		{"PUT", "/v1/admin/settings/public-access", a.admin(a.adminPutPublicAccess)},
	}
}

func (a *api) getAgentProfileByShortName(w http.ResponseWriter, r *http.Request) {
	c, err := a.Agents.ProfileByShortName(r.Context(), a.actor(r), r.PathValue("shortName"))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPICard(c))
}

func (a *api) getAgentSharing(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	sh, err := a.Agents.Sharing(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	base := a.Config.AppURL
	out := apitypes.AgentSharing{
		AgentId: sh.Agent.ID, Audience: apitypes.Audience(sh.Audience), DraftAudience: apitypes.Audience(sh.DraftAudience),
		ShortName: sh.ShortName, PublicAgentsEnabled: sh.PublicAgentsEnabled, Classification: sh.Classification,
		MaxAudience: apitypes.Audience(sh.MaxAudience), Options: make([]apitypes.AudienceOption, len(sh.Options)),
	}
	for i, o := range sh.Options {
		out.Options[i] = apitypes.AudienceOption{Audience: apitypes.Audience(o.Audience), Allowed: o.Allowed, Reasons: o.Reasons}
	}
	out.Links.Team = base + "/a/" + url.PathEscape(sh.TeamSlug) + "/" + url.PathEscape(sh.Agent.Slug)
	out.Links.Id = base + "/a/id/" + sh.Agent.ID.String()
	if sh.ShortName != nil {
		short := base + "/a/" + *sh.ShortName
		out.Links.Short = &short
	}
	out.Widget.ScriptUrl = base + "/widget.js"
	out.Widget.Integrity = a.assets().integrity
	out.Widget.MaxMessageChars = a.publicMessageLimit(r.Context(), sh.Agent.TeamID)
	httpx.JSON(w, http.StatusOK, out)
}

func toAPIPublishableKey(k public.Key) apitypes.PublishableKey {
	out := apitypes.PublishableKey{
		Id: k.ID, AgentId: k.AgentID, Name: k.Name, KeyPreview: public.KeyDisplay(k.Prefix), AllowedOrigins: k.AllowedOrigins,
		Enabled: k.Enabled, Revision: k.Revision, LastUsedAt: k.LastUsedAt, CreatedAt: k.CreatedAt, UpdatedAt: k.UpdatedAt,
	}
	if out.AllowedOrigins == nil {
		out.AllowedOrigins = []string{}
	}
	_ = json.Unmarshal(k.RateLimits, &out.RateLimits)
	return out
}

func keyInput(in apitypes.PublishableKeyInput) public.KeyInput {
	out := public.KeyInput{Name: in.Name, AllowedOrigins: in.AllowedOrigins, Enabled: in.Enabled}
	if in.RateLimits != nil {
		out.RateLimits = &public.KeyLimits{PerIPPerMinute: in.RateLimits.PerIpPerMinute, PerSessionPerMinute: in.RateLimits.PerSessionPerMinute}
	}
	return out
}

func (a *api) listPublishableKeys(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	keys, err := a.Public.ListKeys(r.Context(), a.actor(r), r.PathValue("team"), id)
	writeList(w, r, keys, err, toAPIPublishableKey)
}

func (a *api) createPublishableKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.PublishableKeyInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	k, raw, err := a.Public.CreateKey(r.Context(), a.actor(r), r.PathValue("team"), id, keyInput(in))
	if failed(w, r, err) {
		return
	}
	out := viaJSON[apitypes.PublishableKeyCreated](toAPIPublishableKey(k))
	out.Key = raw
	writeRevised(w, http.StatusCreated, k.Revision, out)
}

func (a *api) updatePublishableKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	keyID, ok := pathUUID(w, r, "keyId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.PublishableKeyInput](w, r)
	if !ok {
		return
	}
	k, err := a.Public.UpdateKey(r.Context(), a.actor(r), r.PathValue("team"), id, keyID, keyInput(in), rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, k.Revision, toAPIPublishableKey(k))
}

func (a *api) revokePublishableKey(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	keyID, ok := pathUUID(w, r, "keyId")
	if !ok {
		return
	}
	writeOK(w, r, a.Public.RevokeKey(r.Context(), a.actor(r), r.PathValue("team"), id, keyID))
}

func (a *api) adminSetAgentShortName(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.ShortNameUpdate
	if !httpx.Decode(w, r, &in) {
		return
	}
	ag, err := a.Agents.SetShortName(r.Context(), a.actor(r), id, in.ShortName)
	if failed(w, r, err) {
		return
	}
	levels, err := a.q.ListClassificationLevels(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIAdminAgent(ag, levels))
}

func (a *api) publicAccess(w http.ResponseWriter, r *http.Request, st apitypes.PublicAccessSettings) {
	st.AnonSessionTtlSeconds = int(a.Config.Public.AnonSessionTTL.Seconds())
	if a.Public != nil {
		st.AnonSessionTtlSeconds = int(a.Public.SessionTTL.Seconds())
		st.Captcha = apitypes.CaptchaInfo{Provider: apitypes.CaptchaInfoProvider(a.Public.Captcha.Provider()), SiteKey: a.Public.Captcha.SiteKey()}
	} else {
		st.Captcha = apitypes.CaptchaInfo{Provider: apitypes.CaptchaInfoProviderNone}
	}
	writeRevised(w, http.StatusOK, st.Revision, st)
}

func (a *api) adminGetPublicAccess(w http.ResponseWriter, r *http.Request) {
	st, err := a.Platform.Settings(r.Context())
	if failed(w, r, err) {
		return
	}
	a.publicAccess(w, r, apitypes.PublicAccessSettings{PublicAgentsEnabled: st.PublicAgentsEnabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}

func (a *api) adminPutPublicAccess(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.PublicAccessUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.Platform.SetPublicAgentsEnabled(r.Context(), a.actor(r), in.PublicAgentsEnabled, rev)
	if failed(w, r, err) {
		return
	}
	a.publicAccess(w, r, apitypes.PublicAccessSettings{PublicAgentsEnabled: st.PublicAgentsEnabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}

// checkWidgetOrigins shows how typed origins would be saved (F-08).
func (a *api) checkWidgetOrigins(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Origins []string `json:"origins"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if len(in.Origins) > 50 {
		httpx.Error(w, http.StatusBadRequest, "too_many_origins", "Check at most 50 origins at a time")
		return
	}
	out := []apitypes.WidgetOriginCheck{}
	for _, c := range public.CheckOrigins(in.Origins) {
		item := apitypes.WidgetOriginCheck{Input: c.Input}
		if c.Origin != "" {
			item.Origin = &c.Origin
		}
		if c.Problem != "" {
			item.Problem = &c.Problem
		}
		out = append(out, item)
	}
	httpx.JSON(w, http.StatusOK, out)
}
