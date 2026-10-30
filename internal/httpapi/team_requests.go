package httpapi

import (
	"context"
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/teamrequests"
)

// In-app team requests (v0.6.0, E3): anyone signed in asks for a team, platform admins review, approving creates the team. A platform
// switch (off by default) turns the feature on and off.

func (a *api) teamRequestRoutes() []route {
	return []route{
		{"GET", "/v1/team-requests", a.session(a.listMyTeamRequests)},
		{"POST", "/v1/team-requests", a.session(a.createTeamRequest)},
		{"POST", "/v1/team-requests/{requestId}/withdraw", a.session(a.withdrawTeamRequest)},
		{"GET", "/v1/admin/team-requests", a.admin(a.adminListTeamRequests)},
		{"GET", "/v1/admin/team-requests/{requestId}", a.admin(a.adminGetTeamRequest)},
		{"POST", "/v1/admin/team-requests/{requestId}/approve", a.admin(a.adminApproveTeamRequest)},
		{"POST", "/v1/admin/team-requests/{requestId}/decline", a.admin(a.adminDeclineTeamRequest)},
		{"GET", "/v1/admin/settings/team-requests", a.admin(a.adminGetTeamRequestSettings)},
		{"PUT", "/v1/admin/settings/team-requests", a.admin(a.adminPutTeamRequestSettings)},
	}
}

// teamRequestsOn reports the platform switch (the app's capability for the request page and its entry points).
func (a *api) teamRequestsOn(ctx context.Context) bool {
	if a.TeamRequests == nil {
		return false
	}
	on, err := a.TeamRequests.Enabled(ctx)
	return err == nil && on
}

func toAPITeamRequest(r teamrequests.Request) apitypes.TeamRequest {
	return apitypes.TeamRequest{
		Id: r.ID, Name: r.Name, Purpose: r.Purpose, OwnerEmail: r.OwnerEmail, Classification: r.Classification, ApprovedClassification: r.ApprovedClassification,
		Status: apitypes.TeamRequestStatus(r.Status), DecisionReason: r.DecisionReason, DecidedAt: r.DecidedAt,
		TeamSlug: r.TeamSlug, TeamName: r.TeamName, Revision: r.Revision, CreatedAt: r.CreatedAt,
	}
}

func toAPIAdminTeamRequest(r teamrequests.AdminRequest) apitypes.AdminTeamRequest {
	return apitypes.AdminTeamRequest{
		Id: r.ID, Name: r.Name, Purpose: r.Purpose, OwnerEmail: r.OwnerEmail, Classification: r.Classification, ApprovedClassification: r.ApprovedClassification,
		Status: apitypes.TeamRequestStatus(r.Status), DecisionReason: r.DecisionReason, DecidedAt: r.DecidedAt,
		TeamSlug: r.TeamSlug, TeamName: r.TeamName, Revision: r.Revision, CreatedAt: r.CreatedAt,
		RequesterId: r.RequesterID, RequesterEmail: r.RequesterEmail, RequesterName: r.RequesterName, DeciderEmail: r.DeciderEmail, OwnerSuspended: r.OwnerSuspended,
	}
}

func toAPITeamRequestSettings(s teamrequests.Settings) apitypes.TeamRequestSettings {
	return apitypes.TeamRequestSettings{Enabled: s.Enabled, MaxOpen: s.MaxOpen, AllowedGroup: s.AllowedGroup, Revision: s.Revision, UpdatedAt: s.UpdatedAt}
}

func (a *api) listMyTeamRequests(w http.ResponseWriter, r *http.Request) {
	m, err := a.TeamRequests.Mine(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	items := make([]apitypes.TeamRequest, len(m.Items))
	for i, it := range m.Items {
		items[i] = toAPITeamRequest(it)
	}
	httpx.JSON(w, http.StatusOK, apitypes.TeamRequestsOverview{
		Enabled: m.Enabled, CanAsk: m.CanAsk, Blocked: apitypes.TeamRequestsOverviewBlocked(m.Blocked), MaxOpen: m.MaxOpen, OpenCount: m.OpenCount, Items: items,
	})
}

func (a *api) createTeamRequest(w http.ResponseWriter, r *http.Request) {
	var in apitypes.TeamRequestCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	req, err := a.TeamRequests.Ask(r.Context(), a.actor(r), teamrequests.RequestInput{
		Name: in.Name, Purpose: in.Purpose, OwnerEmail: deref(in.OwnerEmail, ""), Classification: in.Classification,
	})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPITeamRequest(req))
}

func (a *api) withdrawTeamRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "requestId")
	if !ok {
		return
	}
	writeOK(w, r, a.TeamRequests.Withdraw(r.Context(), a.actor(r), id))
}

func (a *api) adminListTeamRequests(w http.ResponseWriter, r *http.Request) {
	list, err := a.TeamRequests.List(r.Context(), a.actor(r), r.URL.Query().Get("status"))
	writeList(w, r, list, err, toAPIAdminTeamRequest)
}

func (a *api) adminGetTeamRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "requestId")
	if !ok {
		return
	}
	req, err := a.TeamRequests.Get(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, req.Revision, toAPIAdminTeamRequest(req))
}

func (a *api) adminApproveTeamRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "requestId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.TeamRequestApprove](w, r)
	if !ok {
		return
	}
	req, err := a.TeamRequests.Approve(r.Context(), a.actor(r), id, teamrequests.ApproveInput{
		Slug: in.Slug, Name: deref(in.Name, ""), MaxClassification: deref(in.MaxClassification, ""), OwnerEmail: deref(in.OwnerEmail, ""), StarterTemplateID: deref(in.StarterTemplateId, ""),
	}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, req.Revision, toAPIAdminTeamRequest(req))
}

func (a *api) adminDeclineTeamRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "requestId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.TeamRequestDecline](w, r)
	if !ok {
		return
	}
	req, err := a.TeamRequests.Decline(r.Context(), a.actor(r), id, in.Reason, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, req.Revision, toAPIAdminTeamRequest(req))
}

func (a *api) adminGetTeamRequestSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.TeamRequests.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPITeamRequestSettings(st))
}

func (a *api) adminPutTeamRequestSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.TeamRequestSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.TeamRequests.SetSettings(r.Context(), a.actor(r), teamrequests.SettingsInput{Enabled: in.Enabled, MaxOpen: in.MaxOpen, AllowedGroup: in.AllowedGroup}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPITeamRequestSettings(st))
}
