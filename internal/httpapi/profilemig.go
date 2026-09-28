package httpapi

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/authz"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/profilemig"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Profile migrations (docs/phase5-deploy.md §5 P2): platform admins move a
// knowledge base to another embedding profile; auditors read; team members
// see their knowledge base's migration.

func (a *api) profileMigrationRoutes() []route {
	return []route{
		{"GET", "/v1/admin/knowledge-bases", a.admin(a.adminListKnowledgeBases)},
		{"GET", "/v1/admin/profile-migrations", a.admin(a.adminListProfileMigrations)},
		{"POST", "/v1/admin/profile-migrations", a.admin(a.adminStartProfileMigration)},
		{"POST", "/v1/admin/profile-migrations/preflight", a.admin(a.adminPreflightProfileMigration)},
		{"GET", "/v1/admin/profile-migrations/{migrationId}", a.admin(a.adminGetProfileMigration)},
		{"POST", "/v1/admin/profile-migrations/{migrationId}/cancel", a.admin(a.migrationAction(a.ProfileMigrations.Cancel))},
		{"POST", "/v1/admin/profile-migrations/{migrationId}/switch-back", a.admin(a.migrationAction(a.ProfileMigrations.SwitchBack))},
		{"POST", "/v1/admin/profile-migrations/{migrationId}/retry", a.admin(a.migrationAction(a.ProfileMigrations.Retry))},
		{"POST", "/v1/admin/profile-migrations/{migrationId}/finish", a.admin(a.migrationAction(a.ProfileMigrations.Finish))},
		{"GET", "/v1/teams/{team}/kbs/{kbId}/profile-migration", a.session(a.getKBProfileMigration)},
	}
}

func (a *api) adminListKnowledgeBases(w http.ResponseWriter, r *http.Request) {
	rows, err := a.ProfileMigrations.ListKBs(r.Context(), a.actor(r))
	writeList(w, r, rows, err, toAPIAdminKB)
}

func (a *api) adminListProfileMigrations(w http.ResponseWriter, r *http.Request) {
	var kbID *uuid.UUID
	if raw := r.URL.Query().Get("kbId"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid kbId")
			return
		}
		kbID = &id
	}
	list, err := a.ProfileMigrations.List(r.Context(), a.actor(r), kbID)
	writeList(w, r, list, err, toAPIProfileMigration)
}

func (a *api) adminPreflightProfileMigration(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ProfileMigrationTarget
	if !httpx.Decode(w, r, &in) {
		return
	}
	pf, err := a.ProfileMigrations.Preflight(r.Context(), a.actor(r), in.KbId, in.TargetProfileId)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIPreflight(pf))
}

func (a *api) adminStartProfileMigration(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ProfileMigrationStart
	if !httpx.Decode(w, r, &in) {
		return
	}
	m, err := a.ProfileMigrations.Start(r.Context(), a.actor(r), profilemig.StartInput{
		KBID: in.KbId, TargetProfileID: in.TargetProfileId, GraceDays: in.GraceDays,
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, m.ProfileMigration.Revision, toAPIProfileMigration(m))
}

func (a *api) adminGetProfileMigration(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "migrationId")
	if !ok {
		return
	}
	m, err := a.ProfileMigrations.Get(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, m.ProfileMigration.Revision, toAPIProfileMigration(m))
}

type migrationActionFunc func(ctx context.Context, a authz.Actor, id uuid.UUID, rev int64) (profilemig.Migration, error)

// migrationAction runs an admin action at the If-Match revision.
func (a *api) migrationAction(fn migrationActionFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := pathUUID(w, r, "migrationId")
		if !ok {
			return
		}
		rev, ok := ifMatch(w, r)
		if !ok {
			return
		}
		m, err := fn(r.Context(), a.actor(r), id, rev)
		if failed(w, r, err) {
			return
		}
		writeRevised(w, http.StatusOK, m.ProfileMigration.Revision, toAPIProfileMigration(m))
	}
}

func (a *api) getKBProfileMigration(w http.ResponseWriter, r *http.Request) {
	kbID, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	m, err := a.ProfileMigrations.ForKB(r.Context(), a.actor(r), r.PathValue("team"), kbID)
	if failed(w, r, err) {
		return
	}
	if m == nil {
		httpx.JSON(w, http.StatusOK, nil)
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIProfileMigration(*m))
}

func toAPIAdminKB(r dbgen.AdminKBListRow) apitypes.AdminKnowledgeBase {
	out := apitypes.AdminKnowledgeBase{Id: r.ID, Name: r.Name, TeamSlug: r.TeamSlug, TeamName: r.TeamName,
		Profile: apitypes.ProfileRef{Id: r.EmbeddingProfileID, Name: r.ProfileName}, Sources: r.Sources, Passages: r.Passages}
	if r.MigrationID.Valid {
		out.Migration = &struct {
			Id     uuid.UUID                       `json:"id"`
			Status apitypes.ProfileMigrationStatus `json:"status"`
		}{Id: r.MigrationID.UUID, Status: apitypes.ProfileMigrationStatus(r.MigrationStatus)}
	}
	return out
}

func toAPIEstimate(e profilemig.Estimate) apitypes.ProfileMigrationEstimate {
	return apitypes.ProfileMigrationEstimate{Documents: e.Documents, Passages: e.Passages, Tokens: e.Tokens,
		EmbeddingCalls: e.EmbeddingCalls, RequestsPerMinute: e.RequestsPerMinute, Minutes: e.Minutes, Rechunk: e.Rechunk}
}

func toAPIIssues(list []profilemig.Issue) []apitypes.ProfileMigrationIssue {
	out := make([]apitypes.ProfileMigrationIssue, len(list))
	for i, is := range list {
		out[i] = apitypes.ProfileMigrationIssue{Code: is.Code, Message: is.Message}
	}
	return out
}

func toAPIPreflight(pf profilemig.Preflight) apitypes.ProfileMigrationPreflight {
	out := apitypes.ProfileMigrationPreflight{
		Estimate: toAPIEstimate(pf.Estimate), Blockers: toAPIIssues(pf.Blockers), Warnings: toAPIIssues(pf.Warnings),
		Maintenance: pf.Maintenance, DefaultGraceDays: int32(pf.DefaultGraceDays),
		Sources: make([]apitypes.ProfileMigrationPreflightSource, len(pf.Sources)),
	}
	out.Kb.Id, out.Kb.Name, out.Kb.TeamSlug, out.Kb.TeamName = pf.KB.ID, pf.KB.Name, pf.TeamSlug, pf.TeamName
	out.Kb.Profile = apitypes.ProfileRef{Id: pf.From.ID, Name: pf.From.Name}
	t := pf.Target
	out.Target.Id, out.Target.Name, out.Target.Model = t.ID, t.Name, t.Model.DisplayName
	out.Target.Dimensions, out.Target.StorageType, out.Target.ChunkSize, out.Target.ChunkOverlap = t.Dimensions, t.StorageType, t.ChunkSize, t.ChunkOverlap
	out.Target.MaxClassification = pf.TargetCeiling
	for i, s := range pf.Sources {
		out.Sources[i] = apitypes.ProfileMigrationPreflightSource{Id: s.ID, Name: s.Name, Shared: s.Shared, OtherKnowledgeBases: s.OtherKBs,
			Documents: s.Documents, Passages: s.Passages, Tokens: s.Tokens, InProgress: s.InProgress, Failed: s.Failed,
			AlreadyEmbedded: s.AlreadyEmbedded}
	}
	return out
}

func toAPIProfileMigration(m profilemig.Migration) apitypes.ProfileMigration {
	pm := m.ProfileMigration
	out := apitypes.ProfileMigration{
		Id: pm.ID, Status: apitypes.ProfileMigrationStatus(pm.Status),
		Kb: apitypes.ProfileRef{Id: pm.KBID, Name: m.KbName}, TeamSlug: m.TeamSlug, TeamName: m.TeamName,
		FromProfile: apitypes.ProfileRef{Id: pm.FromProfileID, Name: m.FromProfileName},
		ToProfile:   apitypes.ProfileRef{Id: pm.ToProfileID, Name: m.ToProfileName},
		GraceDays:   pm.GraceDays, Estimate: toAPIEstimate(m.Estimate),
		StartedAt: pm.StartedAt, StartedBy: personRef(pm.StartedBy, m.StartedByName, m.StartedByEmail),
		SwitchedAt: pm.SwitchedAt, OldVectorsUntil: pm.OldVectorsUntil, FinishedAt: pm.FinishedAt,
		CanSwitchBack: m.CanSwitchBack(), Revision: pm.Revision,
	}
	p := m.Progress
	out.Progress.Sources, out.Progress.SourcesComplete, out.Progress.Documents = p.Sources, p.SourcesComplete, p.Documents
	out.Progress.Done, out.Progress.Failed, out.Progress.Waiting = p.Done, p.Failed, p.Waiting
	if m.Sources != nil {
		list := make([]apitypes.ProfileMigrationSource, len(m.Sources))
		for i, s := range m.Sources {
			list[i] = apitypes.ProfileMigrationSource{Id: s.ID, Name: s.Name, Shared: s.Shared, State: apitypes.ProfileMigrationSourceState(s.State),
				Documents: s.Documents, Done: s.Done, Failed: s.Failed, Waiting: s.Waiting, Error: s.Error}
		}
		out.Sources = &list
	}
	if m.Failures != nil {
		list := make([]apitypes.ProfileMigrationFailure, len(m.Failures))
		for i, f := range m.Failures {
			title := f.Title
			if title == "" {
				title = f.Filename
			}
			if title == "" {
				title = f.URL
			}
			list[i] = apitypes.ProfileMigrationFailure{DocumentId: f.DocumentID, SourceId: f.SourceID, SourceName: f.SourceName, Title: title,
				Code: f.ErrorCode, Message: f.ErrorMessage, Attempts: f.Attempts, FailedAt: f.FailedAt}
		}
		out.Failures = &list
	}
	return out
}
