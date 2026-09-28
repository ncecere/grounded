package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/preflight"
)

// adminGetOverview serves the admin Overview's counts and attention items
// that no other endpoint gives (docs/ui-review A1): platform counts, failed
// ingestion by team and teams near their resource limits. Pending domain
// requests come from /v1/admin/attention; agents, moderation, analytics and
// recent changes from their own endpoints.
func (a *api) adminGetOverview(w http.ResponseWriter, r *http.Request) {
	if !a.actor(r).CanReadPlatform() {
		httpx.Error(w, http.StatusForbidden, "forbidden", "Platform administration requires the platform admin or auditor role")
		return
	}
	c, err := a.q.AdminOverviewCounts(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	failedRows, err := a.q.FailedDocumentsByTeam(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	near, err := a.Limits.TeamsNearLimits(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	warnings, err := a.overviewWarnings(r)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := apitypes.AdminOverview{
		Teams: apitypes.AdminOverviewTeams{Active: c.ActiveTeams, Archived: c.ArchivedTeams},
		Users: apitypes.AdminOverviewUsers{Total: c.Users, Suspended: c.SuspendedUsers, SignedInLast7Days: c.UsersSignedIn7d, PlatformAdmins: c.PlatformAdmins},
		Content: apitypes.AdminOverviewContent{
			Documents: c.Documents, FailedDocuments: c.FailedDocuments, Passages: c.Passages,
			StorageBytes: c.StorageBytes, SharedSources: c.SharedSources,
		},
		FailedIngest:    []apitypes.AdminFailedIngest{},
		TeamsNearLimits: []apitypes.AdminNearLimit{},
		Warnings:        &warnings,
	}
	for _, f := range failedRows {
		item := apitypes.AdminFailedIngest{Failed: f.Failed}
		if f.TeamID.Valid {
			item.TeamSlug, item.TeamName = &f.TeamSlug, &f.TeamName
		}
		out.FailedIngest = append(out.FailedIngest, item)
	}
	for _, n := range near {
		out.TeamsNearLimits = append(out.TeamsNearLimits, apitypes.AdminNearLimit{
			TeamSlug: n.TeamSlug, TeamName: n.TeamName, Key: apitypes.LimitKey(n.Def.Key), Label: n.Def.Label,
			Unit: apitypes.LimitUnit(n.Def.Unit), Used: n.Used, Max: n.Max,
		})
	}
	httpx.JSON(w, http.StatusOK, out)
}

// overviewWarnings are the production-readiness warnings (E7), the same
// ones logged at startup and printed by `grounded doctor`.
func (a *api) overviewWarnings(r *http.Request) ([]apitypes.AdminWarning, error) {
	findings, err := preflight.Check(r.Context(), a.Config, a.q)
	if err != nil {
		return nil, err
	}
	out := make([]apitypes.AdminWarning, len(findings))
	for i, f := range findings {
		out[i] = apitypes.AdminWarning{Code: f.Code, Severity: apitypes.AdminWarningSeverity(f.Severity), Message: f.Message, Fix: f.Fix}
	}
	return out, nil
}

// adminGetCatalogUsage serves what uses each model and embedding profile,
// for the catalog pages' "Used by" (docs/ui-review A5).
func (a *api) adminGetCatalogUsage(w http.ResponseWriter, r *http.Request) {
	models, err := a.q.ModelUsage(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	profiles, err := a.q.ProfileUsage(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := apitypes.CatalogUsage{Models: make([]apitypes.ModelUsage, len(models)), Profiles: make([]apitypes.ProfileUsage, len(profiles))}
	for i, m := range models {
		aud := make([]apitypes.Audience, len(m.ModerationAudiences))
		for j, s := range m.ModerationAudiences {
			aud[j] = apitypes.Audience(s)
		}
		out.Models[i] = apitypes.ModelUsage{
			ModelId: m.ID, PublishedAgents: m.PublishedAgents, DraftAgents: m.DraftAgents, Profiles: m.Profiles,
			ModerationAudiences: aud, SystemOne: m.Systemone,
		}
	}
	for i, p := range profiles {
		out.Profiles[i] = apitypes.ProfileUsage{ProfileId: p.ID, Sources: p.Sources, KnowledgeBases: p.KnowledgeBases}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// adminListSharedSourceUsage lists the knowledge bases (and their teams)
// that attach each platform-shared source (docs/ui-review A6).
func (a *api) adminListSharedSourceUsage(w http.ResponseWriter, r *http.Request) {
	rows, err := a.q.SharedSourceAttachments(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := make([]apitypes.SharedSourceAttachment, len(rows))
	for i, row := range rows {
		out[i] = apitypes.SharedSourceAttachment{
			SourceId: row.SourceID, KbId: row.KBID, KbName: row.KbName,
			TeamSlug: row.TeamSlug, TeamName: row.TeamName, TeamMaxClassification: row.TeamMaxClassification,
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}
