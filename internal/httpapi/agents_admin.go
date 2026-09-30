// Platform administration of agents: the cross-team list, the kill switch
// and the access log.

package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func toAPIAdminAgent(ag agents.AdminAgent, levels []dbgen.ClassificationLevel) apitypes.AdminAgent {
	out := apitypes.AdminAgent{
		Id: ag.ID, TeamId: ag.TeamID, TeamSlug: ag.TeamSlug, TeamName: ag.TeamName, Slug: ag.Slug, Name: ag.Name,
		Status: apitypes.AgentStatus(ag.Status), DisabledReason: ag.DisabledReason, DisabledAt: ag.DisabledAt,
		PublishedVersion: ag.PublishedVersion, PublishedAt: ag.PublishedAt, ChatModelName: ag.ChatModelName,
		Audience: apitypes.Audience(ag.Audience), ShortName: ag.ShortName, CreatedAt: ag.CreatedAt, UpdatedAt: ag.UpdatedAt,
	}
	if ag.PublishedRank != nil {
		for _, l := range levels { // sorted by rank
			if l.Rank <= *ag.PublishedRank {
				k := l.Key
				out.Classification = &k
			}
		}
	}
	return out
}

func (a *api) adminListAgents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var team, status *string
	if v := strings.TrimSpace(q.Get("team")); v != "" {
		team = &v
	}
	if v := q.Get("status"); v != "" {
		status = &v
	}
	list, err := a.Agents.AdminList(r.Context(), a.actor(r), team, status)
	if failed(w, r, err) {
		return
	}
	levels, err := a.q.ListClassificationLevels(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := make([]apitypes.AdminAgent, len(list))
	for i, ag := range list {
		out[i] = toAPIAdminAgent(ag, levels)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminSetAgentStatus(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "agentId")
	if !ok {
		return
	}
	var in apitypes.AdminAgentStatusChange
	if !httpx.Decode(w, r, &in) {
		return
	}
	ag, err := a.Agents.AdminSetStatus(r.Context(), a.actor(r), id, string(in.Status), deref(in.Reason, ""))
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

// parseTimeParam reads an RFC 3339 time or a UTC date; endOfDay moves a
// date to the following midnight (an exclusive upper bound).
func parseTimeParam(w http.ResponseWriter, r *http.Request, name string, endOfDay bool) (*time.Time, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil, true
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return &t, true
	}
	t, err := time.Parse(time.DateOnly, raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_"+name, name+" must be an RFC 3339 time or a date")
		return nil, false
	}
	if endOfDay {
		t = t.AddDate(0, 0, 1)
	}
	return &t, true
}

// accessChannels are the access log's channels (?channel=).
var accessChannels = map[string]bool{"ui": true, "api": true, "openai": true, "test": true, "public": true, "widget": true, "mcp": true}

func (a *api) adminListAccessLog(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	f := agents.AccessLogFilter{Limit: limit}
	if f.From, ok = parseTimeParam(w, r, "from", false); !ok {
		return
	}
	if f.To, ok = parseTimeParam(w, r, "to", true); !ok {
		return
	}
	for _, p := range []struct {
		name string
		dst  **uuid.UUID
	}{{"agentId", &f.AgentID}, {"userId", &f.UserID}} {
		if raw := r.URL.Query().Get(p.name); raw != "" {
			id, err := uuid.Parse(raw)
			if err != nil {
				httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid "+p.name)
				return
			}
			*p.dst = &id
		}
	}
	if f.Channel = r.URL.Query().Get("channel"); f.Channel != "" && !accessChannels[f.Channel] {
		httpx.Error(w, http.StatusBadRequest, "invalid_channel", "channel must be ui, api, openai, test, public or widget")
		return
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	if keys != nil {
		t, err1 := time.Parse(time.RFC3339Nano, keys[0])
		n, err2 := strconv.ParseInt(keys[1], 10, 64)
		if err1 != nil || err2 != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		f.BeforeAt, f.BeforeID = &t, &n
	}
	rows, more, err := a.Agents.AccessLog(r.Context(), a.actor(r), f)
	if failed(w, r, err) {
		return
	}
	out := apitypes.AccessLogPage{Items: make([]apitypes.AccessLogEntry, len(rows))}
	for i, e := range rows {
		out.Items[i] = apitypes.AccessLogEntry{
			Id: e.ID, At: e.At, UserId: nullUUID(e.UserID), UserEmail: e.UserEmail, UserName: e.UserName,
			ApiKeyId: nullUUID(e.APIKeyID), AgentId: e.AgentID, AgentName: e.AgentName, AgentSlug: e.AgentSlug,
			TeamSlug: e.TeamSlug, AgentVersion: e.AgentVersion, Rank: e.Rank, Classification: e.Classification,
			Channel: apitypes.AccessLogEntryChannel(e.Channel),
		}
	}
	if more && len(rows) > 0 {
		last := rows[len(rows)-1]
		out.NextCursor = encodeCursor(last.At.Format(time.RFC3339Nano), strconv.FormatInt(last.ID, 10))
	}
	httpx.JSON(w, http.StatusOK, out)
}
