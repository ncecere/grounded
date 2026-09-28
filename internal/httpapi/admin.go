package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/platform"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/teams"
)

// requirePlatformRead admits platform admins and auditors. Services check
// again (defence in depth); this gives admin routes a uniform 403.
func (a *api) requirePlatformRead(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.actor(r).CanReadPlatform() {
			httpx.Error(w, http.StatusForbidden, "forbidden", "Platform administration requires the platform admin or auditor role")
			return
		}
		next(w, r)
	}
}

func (a *api) adminListUsers(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	q, ok := search(w, r)
	if !ok {
		return
	}
	keys, ok := decodeCursor(w, r, 2)
	if !ok {
		return
	}
	p := platform.UserListParams{Search: q, Limit: limit + 1}
	if !userFilters(w, r, &p) {
		return
	}
	if keys != nil {
		id, err := uuid.Parse(keys[1])
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		p.AfterEmail, p.AfterID = &keys[0], &id
	}
	users, err := a.Platform.ListUsers(r.Context(), a.actor(r), p)
	if failed(w, r, err) {
		return
	}
	page := apitypes.UserPage{Items: []apitypes.User{}}
	if len(users) > int(limit) {
		users = users[:limit]
		last := users[len(users)-1]
		page.NextCursor = encodeCursor(last.Email, last.ID.String())
	}
	ids := make([]uuid.UUID, len(users))
	for i, u := range users {
		ids[i] = u.ID
	}
	counts, err := a.q.UserTeamCounts(r.Context(), ids)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	teamsOf := make(map[uuid.UUID]int64, len(counts))
	for _, c := range counts {
		teamsOf[c.UserID] = c.Teams
	}
	for _, u := range users {
		out := toAPIUser(u)
		n := teamsOf[u.ID]
		out.TeamCount = &n
		page.Items = append(page.Items, out)
	}
	httpx.JSON(w, http.StatusOK, page)
}

// userFilters reads ?role= and ?status= for the admin user list.
func userFilters(w http.ResponseWriter, r *http.Request, p *platform.UserListParams) bool {
	q := r.URL.Query()
	if v := q.Get("role"); v != "" {
		if v != "none" && v != "platform_admin" && v != "platform_auditor" {
			httpx.Error(w, http.StatusBadRequest, "invalid_role", "role must be none, platform_admin or platform_auditor")
			return false
		}
		p.Role = &v
	}
	if v := q.Get("status"); v != "" {
		if v != "active" && v != "suspended" {
			httpx.Error(w, http.StatusBadRequest, "invalid_status", "status must be active or suspended")
			return false
		}
		p.Status = &v
	}
	return true
}

func (a *api) adminGetUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "userId")
	if !ok {
		return
	}
	d, err := a.Platform.GetUser(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, d.User.Revision, apitypes.UserDetail{User: toAPIUser(d.User), Teams: toAPIMyTeams(d.Teams)})
}

func (a *api) adminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "userId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.UserUpdate](w, r)
	if !ok {
		return
	}
	u, err := a.Platform.UpdateUser(r.Context(), a.actor(r), id, platform.UserUpdate{
		PlatformRole: (*string)(in.PlatformRole), Status: (*string)(in.Status),
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, u.Revision, toAPIUser(u))
}

func (a *api) adminListTeams(w http.ResponseWriter, r *http.Request) {
	limit, ok := pageLimit(w, r)
	if !ok {
		return
	}
	q, ok := search(w, r)
	if !ok {
		return
	}
	keys, ok := decodeCursor(w, r, 1)
	if !ok {
		return
	}
	p := teams.ListParams{Limit: limit + 1}
	if q != nil {
		escaped := store.EscapeLike(*q)
		p.Search = &escaped
	}
	if st := r.URL.Query().Get("status"); st != "" {
		if st != teams.StatusActive && st != teams.StatusArchived {
			httpx.Error(w, http.StatusBadRequest, "invalid_status", "status must be active or archived")
			return
		}
		p.Status = &st
	}
	if keys != nil {
		p.AfterSlug = &keys[0]
	}
	rows, err := a.Teams.ListAll(r.Context(), a.actor(r), p)
	if failed(w, r, err) {
		return
	}
	page := apitypes.TeamPage{Items: []apitypes.TeamSummary{}}
	if len(rows) > int(limit) {
		rows = rows[:limit]
		page.NextCursor = encodeCursor(rows[len(rows)-1].Team.Slug)
	}
	for _, s := range rows {
		page.Items = append(page.Items, toAPISummary(s))
	}
	httpx.JSON(w, http.StatusOK, page)
}

func (a *api) adminCreateTeam(w http.ResponseWriter, r *http.Request) {
	var in apitypes.TeamCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	sum, owner, err := a.Teams.Create(r.Context(), a.actor(r), teams.CreateInput{
		Slug: in.Slug, Name: in.Name, Description: desc,
		MaxClassification: in.MaxClassification, OwnerEmail: string(in.OwnerEmail),
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, sum.Team.Revision, apitypes.TeamCreated{Team: toAPISummary(sum), Owner: toAPIAddResult(owner)})
}

func (a *api) adminGetTeam(w http.ResponseWriter, r *http.Request) {
	sum, err := a.Teams.GetSummary(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, sum.Team.Revision, toAPISummary(sum))
}

func (a *api) adminUpdateTeam(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.TeamUpdate](w, r)
	if !ok {
		return
	}
	sum, err := a.Teams.Update(r.Context(), a.actor(r), r.PathValue("team"), teams.UpdateInput{
		Name: in.Name, Description: in.Description, MaxClassification: in.MaxClassification, Status: (*string)(in.Status),
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, sum.Team.Revision, toAPISummary(sum))
}

func (a *api) adminAssignOwner(w http.ResponseWriter, r *http.Request) {
	var in apitypes.OwnerAssign
	if !httpx.Decode(w, r, &in) {
		return
	}
	res, err := a.Teams.AssignOwner(r.Context(), a.actor(r), r.PathValue("team"), string(in.Email))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIAddResult(res))
}

func (a *api) adminCreateClassification(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ClassificationCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	c, err := a.Platform.CreateClassification(r.Context(), a.actor(r), platform.ClassificationInput{
		Key: in.Key, Name: in.Name, Description: desc, Rank: in.Rank, MaxAudience: string(in.MaxAudience),
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, c.Revision, toAPIClassification(c))
}

func (a *api) adminUpdateClassification(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.ClassificationUpdate](w, r)
	if !ok {
		return
	}
	up := platform.ClassificationUpdate{
		Name: in.Name, Description: in.Description, MaxAudience: (*string)(in.MaxAudience), AnonymousRetentionHours: in.AnonymousRetentionHours,
		DirectRetrieve: in.DirectRetrieve,
	}
	if d := in.ConversationRetentionDays; d != nil {
		up.ConversationRetentionDays, up.ClearConversationRetention = d, *d == 0
	}
	if in.AllowedSourceTypes != nil {
		up.AllowedSourceTypes = make([]string, len(*in.AllowedSourceTypes))
		for i, t := range *in.AllowedSourceTypes {
			up.AllowedSourceTypes[i] = string(t)
		}
	}
	c, err := a.Platform.UpdateClassification(r.Context(), a.actor(r), r.PathValue("key"), up, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, c.Revision, toAPIClassification(c))
}

func (a *api) adminListAudit(w http.ResponseWriter, r *http.Request) {
	a.writeAuditPage(w, r, uuid.NullUUID{})
}
