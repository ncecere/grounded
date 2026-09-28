package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/ncecere/grounded/internal/apperr"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
	"github.com/ncecere/grounded/internal/retention"
)

// Retention and legal holds (docs/phase5-deploy.md §5 P3): the period
// settings, the dry-run report, runs and "Run now", and legal holds.
// Platform admins and auditors only (a.admin); writes need a platform admin
// with a session (checked in the service).

func (a *api) retentionRoutes() []route {
	return []route{
		{"GET", "/v1/admin/retention", a.admin(a.adminGetRetention)},
		{"PUT", "/v1/admin/retention", a.admin(a.adminPutRetention)},
		{"GET", "/v1/admin/retention/report", a.admin(a.adminGetRetentionReport)},
		{"GET", "/v1/admin/retention/runs", a.admin(a.adminListRetentionRuns)},
		{"POST", "/v1/admin/retention/runs", a.admin(a.adminStartRetentionRun)},
		{"GET", "/v1/admin/legal-holds", a.admin(a.adminListLegalHolds)},
		{"POST", "/v1/admin/legal-holds", a.admin(a.adminCreateLegalHold)},
		{"GET", "/v1/admin/legal-holds/{holdId}", a.admin(a.adminGetLegalHold)},
		{"POST", "/v1/admin/legal-holds/{holdId}/release", a.admin(a.adminReleaseLegalHold)},
	}
}

func (a *api) adminGetRetention(w http.ResponseWriter, r *http.Request) {
	st, err := a.Retention.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIRetentionSettings(st))
}

func (a *api) adminPutRetention(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.RetentionUpdate](w, r)
	if !ok {
		return
	}
	updates := make([]retention.PeriodUpdate, 0, len(in.Periods))
	for _, p := range in.Periods {
		updates = append(updates, retention.PeriodUpdate{Kind: retention.Kind(p.Kind), Mode: string(p.Mode), Days: deref(p.Days, -1)})
	}
	st, err := a.Retention.SetPeriods(r.Context(), a.actor(r), updates, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIRetentionSettings(st))
}

func (a *api) adminGetRetentionReport(w http.ResponseWriter, r *http.Request) {
	rep, err := a.Retention.Report(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.RetentionReport{GeneratedAt: rep.GeneratedAt, Kinds: make([]apitypes.RetentionKindReport, 0, len(rep.Kinds))}
	for _, k := range rep.Kinds {
		kr := apitypes.RetentionKindReport{Kind: apitypes.RetentionKind(k.Kind), Kept: k.Kept, Due: k.Due, Held: k.Held, Groups: make([]apitypes.RetentionGroup, 0, len(k.Groups))}
		for _, g := range k.Groups {
			ag := apitypes.RetentionGroup{TeamName: g.TeamName, Audience: g.Audience, Reason: apitypes.RetentionGroupReason(g.Reason), Due: g.Due, Held: g.HeldCount}
			if g.TeamID.Valid {
				ag.TeamId = &g.TeamID.UUID
			}
			if g.Level != nil {
				ag.Level = &struct {
					Key  string `json:"key"`
					Name string `json:"name"`
				}{Key: g.Level.Key, Name: g.Level.Name}
			}
			kr.Groups = append(kr.Groups, ag)
		}
		out.Kinds = append(out.Kinds, kr)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminListRetentionRuns(w http.ResponseWriter, r *http.Request) {
	limit := int32(50)
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 200 {
			httpx.Fail(w, r, apperr.Invalid("invalid_limit", "limit must be from 1 to 200"))
			return
		}
		limit = int32(n)
	}
	runs, err := a.Retention.Runs(r.Context(), a.actor(r), limit)
	writeList(w, r, runs, err, toAPIRetentionRun)
}

func (a *api) adminStartRetentionRun(w http.ResponseWriter, r *http.Request) {
	var in apitypes.RetentionRunRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	var kinds []retention.Kind
	for _, k := range deref(in.Kinds, nil) {
		kinds = append(kinds, retention.Kind(k))
	}
	run, err := a.Retention.RequestRun(r.Context(), a.actor(r), kinds)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusAccepted, toAPIRetentionRun(run))
}

func (a *api) adminListLegalHolds(w http.ResponseWriter, r *http.Request) {
	holds, err := a.Retention.Holds(r.Context(), a.actor(r), r.URL.Query().Get("status"))
	writeList(w, r, holds, err, toAPILegalHold)
}

func (a *api) adminCreateLegalHold(w http.ResponseWriter, r *http.Request) {
	var in apitypes.LegalHoldCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	h := retention.NewHold{ScopeType: string(in.ScopeType), Scope: in.Scope, Reason: in.Reason}
	if in.CoversFrom != nil {
		t := in.CoversFrom.Time.UTC().Truncate(24 * time.Hour)
		h.CoversFrom = &t
	}
	if in.CoversTo != nil {
		t := in.CoversTo.Time.UTC().Truncate(24*time.Hour).AddDate(0, 0, 1) // inclusive day → exclusive time
		h.CoversTo = &t
	}
	hold, err := a.Retention.PlaceHold(r.Context(), a.actor(r), h)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPILegalHold(hold))
}

func (a *api) adminGetLegalHold(w http.ResponseWriter, r *http.Request) {
	id, ok := holdID(w, r)
	if !ok {
		return
	}
	h, err := a.Retention.Hold(r.Context(), a.actor(r), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPILegalHold(h))
}

func (a *api) adminReleaseLegalHold(w http.ResponseWriter, r *http.Request) {
	id, ok := holdID(w, r)
	if !ok {
		return
	}
	var in apitypes.LegalHoldRelease
	if !httpx.Decode(w, r, &in) {
		return
	}
	h, err := a.Retention.ReleaseHold(r.Context(), a.actor(r), id, in.Reason)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPILegalHold(h))
}

func holdID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("holdId"))
	if err != nil {
		httpx.Fail(w, r, apperr.NotFound("legal_hold_not_found", "No such legal hold"))
		return uuid.Nil, false
	}
	return id, true
}

// ---- conversions -------------------------------------------------------------------------

func toAPIRetentionSettings(st retention.Settings) apitypes.RetentionSettings {
	out := apitypes.RetentionSettings{Revision: st.Revision, UpdatedAt: st.UpdatedAt, UpdatedBy: retentionPerson(st.UpdatedBy),
		Periods: []apitypes.RetentionPeriod{}, Levels: make([]apitypes.RetentionLevel, 0, len(st.Levels))}
	for _, k := range retention.Kinds {
		p, ok := st.Periods[k]
		if !ok {
			continue
		}
		out.Periods = append(out.Periods, apitypes.RetentionPeriod{
			Kind: apitypes.RetentionKind(k), Days: p.Days, Source: apitypes.RetentionPeriodSource(p.Source),
			PlatformSet: p.PlatformSet, PlatformDays: p.PlatformDays, EnvironmentDays: p.EnvDays, MinDays: p.Min, MaxDays: p.Max,
		})
	}
	for _, l := range st.Levels {
		lv := apitypes.RetentionLevel{Key: l.Key, Name: l.Name, Rank: int(l.Rank), AnonymousRetentionHours: int(l.AnonymousHours)}
		if l.ConversationDays != nil {
			d := int(*l.ConversationDays)
			lv.ConversationRetentionDays = &d
		}
		out.Levels = append(out.Levels, lv)
	}
	return out
}

func toAPIRetentionRun(r retention.Run) apitypes.RetentionRun {
	out := apitypes.RetentionRun{
		Id: r.ID, Trigger: apitypes.RetentionRunTrigger(r.Trigger), RequestedBy: retentionPerson(r.RequestedBy),
		Kinds: make([]apitypes.RetentionKind, 0, len(r.Kinds)), Status: apitypes.RetentionRunStatus(r.Status),
		Results: []apitypes.RetentionRunResult{}, Error: r.Error, CreatedAt: r.CreatedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt,
	}
	for _, k := range r.Kinds {
		out.Kinds = append(out.Kinds, apitypes.RetentionKind(k))
	}
	for _, k := range retention.Kinds {
		if res, ok := r.Results[k]; ok {
			out.Results = append(out.Results, apitypes.RetentionRunResult{Kind: apitypes.RetentionKind(k), Deleted: res.Deleted, Held: res.Held, Kept: res.Kept, Error: res.Error})
		}
	}
	return out
}

func toAPILegalHold(h retention.Hold) apitypes.LegalHold {
	out := apitypes.LegalHold{
		Id: h.ID, ScopeType: apitypes.LegalHoldScopeType(h.ScopeType), ScopeId: h.ScopeID, ScopeLabel: h.ScopeLabel,
		ScopeExists: h.ScopeExists, ScopeContext: h.ScopeContext, Reason: h.Reason, Status: "active",
		CreatedAt: h.CreatedAt, CreatedBy: retentionPerson(h.CreatedBy), ReleasedAt: h.ReleasedAt,
		ReleasedBy: retentionPerson(h.ReleasedBy), ReleaseReason: h.ReleaseReason,
		Conversations: h.Conversations, DeletedConversations: h.Deleted,
	}
	if !h.Active() {
		out.Status = "released"
	}
	if h.CoversFrom != nil {
		out.CoversFrom = &openapi_types.Date{Time: h.CoversFrom.UTC()}
	}
	if h.CoversTo != nil {
		out.CoversTo = &openapi_types.Date{Time: h.CoversTo.UTC().AddDate(0, 0, -1)} // exclusive time → inclusive day
	}
	return out
}

func retentionPerson(p retention.Person) *apitypes.PersonRef {
	return personRef(uuid.NullUUID{UUID: p.ID, Valid: p.ID != uuid.Nil}, p.DisplayName, p.Email)
}
