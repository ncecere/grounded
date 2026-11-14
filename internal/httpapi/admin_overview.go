package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// adminGetOverview serves the admin Overview's counts and attention items
// that no other endpoint gives (docs/ui-review A1): platform counts, failed
// ingestion by team, teams near their resource limits and near or over
// their monthly budget. Pending domain
// requests come from /v1/admin/attention; agents, moderation, analytics and
// recent changes from their own endpoints.
func (a *api) adminGetOverview(w http.ResponseWriter, r *http.Request) {
	ov, err := a.Platform.Overview(r.Context(), a.actor(r), a.Config)
	if failed(w, r, err) {
		return
	}
	c := ov.Counts
	near, err := a.Limits.TeamsNearLimits(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	nearBudget, err := a.nearBudget(r)
	if failed(w, r, err) {
		return
	}
	warnings := make([]apitypes.AdminWarning, len(ov.Warnings))
	for i, f := range ov.Warnings {
		warnings[i] = apitypes.AdminWarning{Code: f.Code, Severity: apitypes.AdminWarningSeverity(f.Severity), Message: f.Message, Fix: f.Fix}
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
		TeamsNearBudget: &nearBudget,
		Warnings:        &warnings,
	}
	for _, f := range ov.FailedByTeam {
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

// adminGetCatalogUsage serves what uses each model and embedding profile,
// for the catalog pages' "Used by" (docs/ui-review A5).
func (a *api) adminGetCatalogUsage(w http.ResponseWriter, r *http.Request) {
	models, profiles, err := a.Catalog.Usage(r.Context(), a.actor(r))
	if failed(w, r, err) {
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
			ModerationAudiences: aud, SystemOne: m.Systemone, Rerank: m.Rerank,
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
	rows, err := a.Platform.SharedSourceAttachments(r.Context(), a.actor(r))
	if failed(w, r, err) {
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
