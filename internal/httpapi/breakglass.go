package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/breakglass"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// Break-glass (docs/phase5-deploy.md §5 P4, ADR-0024): sessions and their
// setting in the admin API, the reading admin's open sessions (the banner),
// a team's active sessions (the owners' notice) and the team conversation
// list read under a session. Documents are read through the normal source
// routes, transcripts through GET /v1/conversations/{id}.

// breakGlassRoutes: sessions, settings and the reads only break-glass allows.
func (a *api) breakGlassRoutes() []route {
	return []route{
		{"GET", "/v1/me/break-glass", a.session(a.listMyBreakGlass)},
		{"GET", "/v1/teams/{team}/break-glass", a.session(a.listTeamBreakGlass)},
		{"GET", "/v1/teams/{team}/conversations", a.session(a.listTeamConversations)},
		{"GET", "/v1/admin/settings/break-glass", a.admin(a.adminGetBreakGlassSettings)},
		{"PUT", "/v1/admin/settings/break-glass", a.admin(a.adminPutBreakGlassSettings)},
		{"GET", "/v1/admin/break-glass", a.admin(a.adminListBreakGlass)},
		{"POST", "/v1/admin/break-glass", a.admin(a.adminStartBreakGlass)},
		{"GET", "/v1/admin/break-glass/{sessionId}", a.admin(a.adminGetBreakGlass)},
		{"GET", "/v1/admin/break-glass/{sessionId}/reads", a.admin(a.adminListBreakGlassReads)},
		{"POST", "/v1/admin/break-glass/{sessionId}/approve", a.admin(a.adminApproveBreakGlass)},
		{"POST", "/v1/admin/break-glass/{sessionId}/deny", a.admin(a.adminDenyBreakGlass)},
		{"POST", "/v1/admin/break-glass/{sessionId}/end", a.admin(a.adminEndBreakGlass)},
	}
}

func (a *api) listMyBreakGlass(w http.ResponseWriter, r *http.Request) {
	list, err := a.BreakGlass.Mine(r.Context(), a.actor(r))
	writeList(w, r, list, err, toAPIBreakGlassSession)
}

func (a *api) listTeamBreakGlass(w http.ResponseWriter, r *http.Request) {
	list, err := a.BreakGlass.ForTeam(r.Context(), a.actor(r), r.PathValue("team"))
	writeList(w, r, list, err, toAPIBreakGlassSession)
}

func (a *api) listTeamConversations(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	var agentID *uuid.UUID
	if raw := r.URL.Query().Get("agentId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid agentId")
			return
		}
		agentID = &id
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	var after *agents.TeamConversationCursor
	if keys != nil {
		t, err1 := time.Parse(time.RFC3339Nano, keys[0])
		id, err2 := uuid.Parse(keys[1])
		if err1 != nil || err2 != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		after = &agents.TeamConversationCursor{UpdatedAt: t, ID: id}
	}
	rows, next, err := a.Agents.ListTeamConversations(r.Context(), a.actor(r), r.PathValue("team"), agentID, after, limit)
	if failed(w, r, err) {
		return
	}
	out := apitypes.TeamConversationPage{Items: make([]apitypes.TeamConversation, len(rows))}
	for i, c := range rows {
		out.Items[i] = apitypes.TeamConversation{
			Id: c.ID, AgentId: c.AgentID, AgentName: c.AgentName, AgentSlug: c.AgentSlug, TeamSlug: c.TeamSlug,
			AgentDeleted: c.AgentDeleted, Title: c.Title, Anonymous: c.Anonymous, Questions: int(c.Questions),
			CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		}
	}
	if next != nil {
		out.NextCursor = encodeCursor(next.UpdatedAt.Format(time.RFC3339Nano), next.ID.String())
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminGetBreakGlassSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.BreakGlass.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIBreakGlassSettings(st))
}

func (a *api) adminPutBreakGlassSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.BreakGlassSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.BreakGlass.SetSettings(r.Context(), a.actor(r), authz.BreakGlassPolicy{
		ApprovalRequired: in.ApprovalRequired,
		MaxDuration:      time.Duration(in.MaxDurationMinutes) * time.Minute,
		ApprovalTimeout:  time.Duration(in.ApprovalTimeoutMinutes) * time.Minute,
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIBreakGlassSettings(st))
}

func (a *api) adminListBreakGlass(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	actor := a.actor(r)
	var f breakglass.Filter
	switch r.URL.Query().Get("state") {
	case "":
	case "open", "closed":
		open := r.URL.Query().Get("state") == "open"
		f.Open = &open
	default:
		httpx.Error(w, http.StatusBadRequest, "invalid_state", "state must be open or closed")
		return
	}
	if ref := r.URL.Query().Get("team"); ref != "" {
		acc, err := a.Teams.Get(r.Context(), actor, ref)
		if failed(w, r, err) {
			return
		}
		f.TeamID = &acc.Team.ID
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	var after *breakglass.Cursor
	if keys != nil {
		t, err1 := time.Parse(time.RFC3339Nano, keys[0])
		id, err2 := uuid.Parse(keys[1])
		if err1 != nil || err2 != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		after = &breakglass.Cursor{RequestedAt: t, ID: id}
	}
	list, next, err := a.BreakGlass.List(r.Context(), actor, f, after, limit)
	if failed(w, r, err) {
		return
	}
	out := apitypes.BreakGlassSessionPage{Items: make([]apitypes.BreakGlassSession, len(list))}
	for i, s := range list {
		out.Items[i] = toAPIBreakGlassSession(s)
	}
	if next != nil {
		out.NextCursor = encodeCursor(next.RequestedAt.Format(time.RFC3339Nano), next.ID.String())
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminStartBreakGlass(w http.ResponseWriter, r *http.Request) {
	var in apitypes.BreakGlassStart
	if !httpx.Decode(w, r, &in) {
		return
	}
	scopes := make([]string, len(in.Scopes))
	for i, s := range in.Scopes {
		scopes[i] = string(s)
	}
	s, err := a.BreakGlass.Start(r.Context(), a.actor(r), breakglass.StartInput{
		Team: in.Team, Reason: in.Reason, Scopes: scopes, Duration: time.Duration(deref(in.DurationMinutes, 0)) * time.Minute,
	})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIBreakGlassDetail(s))
}

func (a *api) adminGetBreakGlass(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sessionId")
	if !ok {
		return
	}
	s, err := a.BreakGlass.Get(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIBreakGlassDetail(s))
}

func (a *api) adminListBreakGlassReads(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "sessionId")
	if !ok {
		return
	}
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	keys, ok := decodeCursor(w, r, 1)
	if !ok {
		return
	}
	var before int64
	if keys != nil {
		n, err := strconv.ParseInt(keys[0], 10, 64)
		if err != nil || n <= 0 {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		before = n
	}
	rows, next, err := a.BreakGlass.Reads(r.Context(), a.actor(r), id, before, limit)
	if failed(w, r, err) {
		return
	}
	out := apitypes.BreakGlassReadPage{Items: make([]apitypes.BreakGlassRead, len(rows))}
	for i, e := range rows {
		out.Items[i] = apitypes.BreakGlassRead{
			Id: e.ID, OccurredAt: e.OccurredAt, Kind: apitypes.BreakGlassReadKind(e.Kind),
			TargetType: apitypes.BreakGlassReadTargetType(e.TargetType), TargetId: e.TargetID, TargetLabel: e.TargetLabel,
		}
	}
	if next != nil {
		out.NextCursor = encodeCursor(strconv.FormatInt(*next, 10))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminApproveBreakGlass(w http.ResponseWriter, r *http.Request) {
	a.breakGlassAction(w, r, func(actor authz.Actor, id uuid.UUID) (breakglass.Session, error) {
		return a.BreakGlass.Approve(r.Context(), actor, id)
	})
}

func (a *api) adminDenyBreakGlass(w http.ResponseWriter, r *http.Request) {
	var in apitypes.BreakGlassDeny
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.breakGlassAction(w, r, func(actor authz.Actor, id uuid.UUID) (breakglass.Session, error) {
		return a.BreakGlass.Deny(r.Context(), actor, id, in.Reason)
	})
}

func (a *api) adminEndBreakGlass(w http.ResponseWriter, r *http.Request) {
	a.breakGlassAction(w, r, func(actor authz.Actor, id uuid.UUID) (breakglass.Session, error) {
		return a.BreakGlass.End(r.Context(), actor, id)
	})
}

func (a *api) breakGlassAction(w http.ResponseWriter, r *http.Request, do func(authz.Actor, uuid.UUID) (breakglass.Session, error)) {
	id, ok := pathUUID(w, r, "sessionId")
	if !ok {
		return
	}
	s, err := do(a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIBreakGlassDetail(s))
}

func toAPIBreakGlassSettings(st breakglass.Settings) apitypes.BreakGlassSettings {
	return apitypes.BreakGlassSettings{
		ApprovalRequired:       st.ApprovalRequired,
		MaxDurationMinutes:     int(st.MaxDuration / time.Minute),
		ApprovalTimeoutMinutes: int(st.ApprovalTimeout / time.Minute),
		DefaultDurationMinutes: int(st.DefaultDuration() / time.Minute),
		MinReasonLength:        authz.BreakGlassMinReason,
		UpdatedAt:              st.UpdatedAt, UpdatedBy: breakGlassPerson(st.UpdatedBy), Revision: st.Revision,
	}
}

func breakGlassPerson(p breakglass.Person) *apitypes.PersonRef {
	return personRef(uuid.NullUUID{UUID: p.ID, Valid: p.ID != uuid.Nil}, p.DisplayName, p.Email)
}

func toAPIBreakGlassSession(s breakglass.Session) apitypes.BreakGlassSession {
	scopes := make([]apitypes.BreakGlassScope, len(s.Scopes))
	for i, sc := range s.Scopes {
		scopes[i] = apitypes.BreakGlassScope(sc)
	}
	out := apitypes.BreakGlassSession{
		Id: s.ID, Team: apitypes.TeamRef{Id: s.Team.ID, Slug: s.Team.Slug, Name: s.Team.Name},
		Reason: s.Reason, Scopes: scopes, DurationMinutes: int(s.DurationMinutes), Status: apitypes.BreakGlassStatus(s.Status),
		RequestedAt: s.RequestedAt, ApprovalDeadline: s.ApprovalDeadline, DecidedBy: breakGlassPerson(s.DecidedBy),
		DecidedAt: s.DecidedAt, DecisionNote: s.DecisionNote, StartedAt: s.StartedAt, ExpiresAt: s.ExpiresAt,
		EndedAt: s.EndedAt, EndedBy: breakGlassPerson(s.EndedBy),
	}
	if p := breakGlassPerson(s.RequestedBy); p != nil {
		out.RequestedBy = *p
	} else {
		out.RequestedBy = apitypes.PersonRef{Id: s.BreakGlassSession.RequestedBy}
	}
	return out
}

func toAPIBreakGlassDetail(s breakglass.Session) apitypes.BreakGlassSessionDetail {
	d := viaJSON[apitypes.BreakGlassSessionDetail](toAPIBreakGlassSession(s))
	d.Reads = make([]apitypes.BreakGlassReadCount, len(s.Reads))
	for i, c := range s.Reads {
		d.Reads[i] = apitypes.BreakGlassReadCount{Kind: apitypes.BreakGlassReadKind(c.Kind), Reads: int(c.Reads), Targets: int(c.Targets)}
	}
	return d
}
