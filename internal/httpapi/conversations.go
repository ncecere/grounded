// Conversation and feedback handlers (ADR-0010).

package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

func toAPIConversation(c agents.ConversationSummary) apitypes.Conversation {
	return apitypes.Conversation{
		Id: c.ID, AgentId: c.AgentID, AgentName: c.AgentName, AgentSlug: c.AgentSlug, TeamSlug: c.TeamSlug,
		AgentDeleted: c.AgentDeleted, Title: c.Title, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}
}

func toAPIConversationDetail(v agents.ConversationView) apitypes.ConversationDetail {
	c := v.Conversation
	out := apitypes.ConversationDetail{
		Conversation: apitypes.Conversation{
			Id: c.ID, AgentId: c.AgentID, AgentName: v.Agent.Name, AgentSlug: v.Agent.Slug, TeamSlug: v.TeamSlug,
			AgentDeleted: v.AgentDeleted, Title: c.Title, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		},
		Messages: viaJSON[[]apitypes.ConversationMessage](v.Messages),
	}
	if out.Messages == nil {
		out.Messages = []apitypes.ConversationMessage{}
	}
	return out
}

func (a *api) listConversations(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	var f agents.ConversationFilter
	if raw := r.URL.Query().Get("agentId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid agentId")
			return
		}
		f.AgentID = &id
	}
	if f.Search = r.URL.Query().Get("q"); len(f.Search) > 200 {
		httpx.Error(w, http.StatusBadRequest, "invalid_q", "q must be at most 200 characters")
		return
	}
	if f.From, ok = parseTimeParam(w, r, "from", false); !ok {
		return
	}
	if f.To, ok = parseTimeParam(w, r, "to", true); !ok {
		return
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	var after *agents.ConversationCursor
	if keys != nil {
		t, err1 := time.Parse(time.RFC3339Nano, keys[0])
		id, err2 := uuid.Parse(keys[1])
		if err1 != nil || err2 != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		after = &agents.ConversationCursor{UpdatedAt: t, ID: id}
	}
	rows, next, err := a.Agents.ListConversations(r.Context(), a.actor(r), f, after, limit)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ConversationPage{Items: make([]apitypes.Conversation, len(rows))}
	for i, c := range rows {
		out.Items[i] = toAPIConversation(c)
	}
	if next != nil {
		out.NextCursor = encodeCursor(next.UpdatedAt.Format(time.RFC3339Nano), next.ID.String())
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) getConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	// The owner, or a platform admin under break-glass (audited; ADR-0024).
	v, err := a.Agents.ReadConversation(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIConversationDetail(v))
}

func (a *api) renameConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	var in apitypes.ConversationUpdate
	if !httpx.Decode(w, r, &in) {
		return
	}
	if _, err := a.Agents.RenameConversation(r.Context(), a.actor(r), id, in.Title); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	v, err := a.Agents.GetConversation(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIConversationDetail(v).Conversation)
}

func (a *api) deleteConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	writeOK(w, r, a.Agents.DeleteConversation(r.Context(), a.actor(r), id))
}

func (a *api) exportConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "conversationId")
	if !ok {
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "markdown"
	}
	if format != "markdown" && format != "json" {
		httpx.Error(w, http.StatusBadRequest, "invalid_format", "format must be markdown or json")
		return
	}
	v, err := a.Agents.GetConversation(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	// Numbered as the chat shows the answers (US-03).
	v = agents.ExportNumbers(v)
	name := "conversation-" + id.String()[:8]
	w.Header().Set("Cache-Control", "no-store")
	if format == "json" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.json"`)
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(toAPIConversationDetail(v))
		return
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`.md"`)
	_, _ = w.Write([]byte(agents.ExportMarkdown(v, exportZone(r.URL.Query().Get("tz")))))
}

func (a *api) setMessageFeedback(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "messageId")
	if !ok {
		return
	}
	var in apitypes.Feedback
	if !httpx.Decode(w, r, &in) {
		return
	}
	var reason *string
	if in.Reason != nil {
		s := string(*in.Reason)
		reason = &s
	}
	share := in.Share != nil && *in.Share && in.Rating == apitypes.FeedbackRatingDown
	if err := a.Agents.SetFeedback(r.Context(), a.actor(r), id, string(in.Rating), reason, share); err != nil {
		httpx.Fail(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.FeedbackResult{MessageId: id, Rating: in.Rating, Reason: in.Reason, Shared: share})
}

// exportZone is the reader's time zone for an export's times, UTC when
// absent or unknown.
func exportZone(name string) *time.Location {
	if name == "" || len(name) > 64 {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}
