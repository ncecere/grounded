package httpapi

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/store/dbgen"
	"github.com/ncecere/grounded/internal/web"
)

func toAPIDomainRequest(r web.DomainRequest) apitypes.DomainRequest {
	return apitypes.DomainRequest{
		Id: r.ID, TeamId: r.TeamID, TeamSlug: r.TeamSlug, TeamName: r.TeamName, Pattern: r.Pattern, Reason: r.Reason,
		Status: apitypes.DomainRequestStatus(r.Status), RequestedBy: nullUUID(r.RequestedBy), ReviewedBy: nullUUID(r.ReviewedBy),
		Requester:  personRef(r.RequestedBy, r.RequesterName, r.RequesterEmail),
		Reviewer:   personRef(r.ReviewedBy, r.ReviewerName, r.ReviewerEmail),
		ReviewNote: r.ReviewNote, ReviewedAt: r.ReviewedAt, CreatedAt: r.CreatedAt,
	}
}

// personRef names a user; nil when there is no user or it no longer exists.
func personRef(id uuid.NullUUID, name, email string) *apitypes.PersonRef {
	if !id.Valid || email == "" {
		return nil
	}
	return &apitypes.PersonRef{Id: id.UUID, DisplayName: name, Email: email}
}

func toAPIDomainRequests(list []web.DomainRequest) []apitypes.DomainRequest {
	out := make([]apitypes.DomainRequest, len(list))
	for i, r := range list {
		out[i] = toAPIDomainRequest(r)
	}
	return out
}

func toAPIAllowlistEntry(e dbgen.CrawlAllowlist) apitypes.AllowlistEntry {
	return apitypes.AllowlistEntry{Id: e.ID, Pattern: e.Pattern, Note: e.Note, CreatedBy: nullUUID(e.CreatedBy), CreatedAt: e.CreatedAt}
}

func (a *api) mapSite(w http.ResponseWriter, r *http.Request) {
	var in apitypes.MapRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	res, err := a.WebSources.Map(r.Context(), a.actor(r), r.PathValue("team"), web.MapInput{
		URL: in.Url, UseSitemaps: deref(in.UseSitemaps, false), Limit: deref(in.Limit, 0),
		IncludePrefixes: deref(in.IncludePrefixes, nil), Exclude: deref(in.Exclude, nil),
		AllowSubdomains: deref(in.AllowSubdomains, false),
	})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.MapResult{Urls: res.URLs, Truncated: res.Truncated, SitemapUrls: res.SitemapURLs})
}

func (a *api) listTeamDomainRequests(w http.ResponseWriter, r *http.Request) {
	list, err := a.WebSources.ListTeamRequests(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIDomainRequests(list))
}

func (a *api) createDomainRequest(w http.ResponseWriter, r *http.Request) {
	var in apitypes.DomainRequestCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	req, err := a.WebSources.CreateRequest(r.Context(), a.actor(r), r.PathValue("team"), in.Pattern, in.Reason)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIDomainRequest(req))
}

// withdrawDomainRequest removes a pending request (its requester, or a team
// admin or owner; roadmap J4).
func (a *api) withdrawDomainRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "requestId")
	if !ok {
		return
	}
	writeOK(w, r, a.WebSources.Withdraw(r.Context(), a.actor(r), r.PathValue("team"), id))
}

func (a *api) adminListDomainRequests(w http.ResponseWriter, r *http.Request) {
	list, err := a.WebSources.ListRequests(r.Context(), a.actor(r), r.URL.Query().Get("status"))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIDomainRequests(list))
}

// adminGetAttention counts what waits for a platform admin (the sidebar
// badge, docs/ui-review P-16).
func (a *api) adminGetAttention(w http.ResponseWriter, r *http.Request) {
	n, err := a.WebSources.PendingRequests(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.AdminAttention{PendingDomainRequests: n})
}

func (a *api) adminReviewDomainRequest(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "requestId")
	if !ok {
		return
	}
	var in apitypes.DomainReview
	if !httpx.Decode(w, r, &in) {
		return
	}
	req, err := a.WebSources.Review(r.Context(), a.actor(r), id, string(in.Decision), deref(in.Note, ""))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIDomainRequest(req))
}

func (a *api) adminListAllowlist(w http.ResponseWriter, r *http.Request) {
	list, err := a.WebSources.ListAllowlist(r.Context(), a.actor(r))
	writeList(w, r, list, err, toAPIAllowlistEntry)
}

func (a *api) adminAddAllowlist(w http.ResponseWriter, r *http.Request) {
	var in apitypes.AllowlistCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	e, err := a.WebSources.AddAllowlist(r.Context(), a.actor(r), in.Pattern, deref(in.Note, ""))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIAllowlistEntry(e))
}

func (a *api) adminRemoveAllowlist(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "entryId")
	if !ok {
		return
	}
	writeOK(w, r, a.WebSources.RemoveAllowlist(r.Context(), a.actor(r), id))
}
