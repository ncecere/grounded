// The content health report (docs/content-health.md, ADR-0027): a team's editors, admins and owners make a report, a background
// job collects it, and these routes read what it stored. Session only; internal/contenthealth answers 404 to everyone else
// (members, API keys, platform staff, break-glass). Opening anything here reads stored rows: it computes nothing and makes no
// network request.

package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ncecere/grounded/internal/contenthealth"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

func (a *api) contentHealthRoutes() []route {
	const report = "/v1/teams/{team}/content-health/reports/{reportId}"
	return []route{
		{"GET", "/v1/teams/{team}/content-health/reports", a.session(a.listContentHealthReports)},
		{"POST", "/v1/teams/{team}/content-health/reports", a.session(a.createContentHealthReport)},
		{"GET", report, a.session(a.getContentHealthReport)},
		{"DELETE", report, a.session(a.deleteContentHealthReport)},
		{"POST", report + "/cancel", a.session(a.cancelContentHealthReport)},
		{"GET", report + "/findings", a.session(a.listContentHealthFindings)},
		{"GET", "/v1/admin/settings/content-health", a.admin(a.adminGetContentHealthSettings)},
		{"PUT", "/v1/admin/settings/content-health", a.admin(a.adminPutContentHealthSettings)},
	}
}

func (a *api) listContentHealthReports(w http.ResponseWriter, r *http.Request) {
	list, err := a.ContentHealth.List(r.Context(), a.actor(r), r.PathValue("team"))
	if failed(w, r, err) {
		return
	}
	out := apitypes.ContentHealthReportList{Enabled: list.Enabled, Limits: contentHealthLimits(a.ContentHealth.Cooldown), Reports: make([]apitypes.ContentHealthReport, len(list.Reports))}
	for i, rep := range list.Reports {
		out.Reports[i] = toAPIContentHealthReport(rep)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) createContentHealthReport(w http.ResponseWriter, r *http.Request) {
	var in apitypes.ContentHealthReportInput
	if r.ContentLength != 0 && !httpx.Decode(w, r, &in) {
		return
	}
	rep, err := a.ContentHealth.Create(r.Context(), a.actor(r), r.PathValue("team"), contenthealth.CreateInput{
		StaleDays: int(deref(in.StaleDays, 0)), CitationWindowDays: int(deref(in.CitationWindowDays, 0)), SourceID: in.SourceId, KBID: in.KnowledgeBaseId,
	})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusAccepted, toAPIContentHealthReport(rep))
}

func (a *api) getContentHealthReport(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "reportId")
	if !ok {
		return
	}
	d, err := a.ContentHealth.Detail(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ContentHealthReportDetail{Report: toAPIContentHealthReport(d.Report), Sources: make([]apitypes.ContentHealthSourceCoverage, len(d.Sources))}
	for i, c := range d.Sources {
		out.Sources[i] = apitypes.ContentHealthSourceCoverage{
			SourceId: c.SourceID, Name: c.Name, Type: c.Type, Documents: c.Documents, Ready: c.Ready, ReadyWithoutDate: c.ReadyNoDate, ReadyWithoutHash: c.ReadyNoHash,
			LinkState: apitypes.ContentHealthSourceCoverageLinkState(c.LinkState), LinkReason: c.LinkReason, LinkCrawlAt: c.LinkCrawlAt, LinkTruncated: c.LinkTruncated,
			LinkFailed: c.LinkFailed, LinkRefs: apitypes.ContentHealthSourceCoverageLinkRefs(c.LinkRefs), CiteState: apitypes.ContentHealthSourceCoverageCiteState(c.CiteState),
			ExposedSince: c.ExposedSince, ExposureAnswers: c.ExposureAnswers,
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) deleteContentHealthReport(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "reportId")
	if !ok {
		return
	}
	if failed(w, r, a.ContentHealth.Delete(r.Context(), a.actor(r), r.PathValue("team"), id)) {
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *api) cancelContentHealthReport(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "reportId")
	if !ok {
		return
	}
	rep, err := a.ContentHealth.Cancel(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIContentHealthReport(rep))
}

func (a *api) listContentHealthFindings(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "reportId")
	if !ok {
		return
	}
	limit := contenthealth.DefaultPageSize
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > contenthealth.PageSize {
			httpx.Error(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 100")
			return
		}
		limit = n
	}
	keys, ok := decodeCursor(w, r, 1)
	if !ok {
		return
	}
	var after int32
	if keys != nil {
		n, err := strconv.ParseInt(keys[0], 10, 32)
		if err != nil || n < 0 {
			httpx.Error(w, http.StatusBadRequest, "invalid_cursor", "Invalid cursor")
			return
		}
		after = int32(n)
	}
	page, err := a.ContentHealth.Findings(r.Context(), a.actor(r), r.PathValue("team"), id, r.URL.Query().Get("signal"), after, limit)
	if failed(w, r, err) {
		return
	}
	out := apitypes.ContentHealthFindingPage{Items: make([]apitypes.ContentHealthFinding, len(page.Items))}
	for i, f := range page.Items {
		out.Items[i] = toAPIContentHealthFinding(f)
	}
	if page.After > 0 {
		out.NextCursor = encodeCursor(strconv.Itoa(int(page.After)))
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminGetContentHealthSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.ContentHealth.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIContentHealthSettings(st))
}

func (a *api) adminPutContentHealthSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.ContentHealthSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.ContentHealth.SetEnabled(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, toAPIContentHealthSettings(st))
}

func toAPIContentHealthSettings(s contenthealth.Settings) apitypes.ContentHealthSettings {
	return apitypes.ContentHealthSettings{Enabled: s.Enabled, Revision: s.Revision, UpdatedAt: s.UpdatedAt}
}

func contentHealthLimits(cooldown time.Duration) apitypes.ContentHealthLimits {
	return apitypes.ContentHealthLimits{
		DefaultStaleDays: contenthealth.DefaultStaleDays, MinStaleDays: contenthealth.MinStaleDays, MaxStaleDays: contenthealth.MaxStaleDays,
		DefaultCitationWindowDays: contenthealth.DefaultCitationWindowDays, MinCitationWindowDays: contenthealth.MinCitationWindowDays,
		MaxCitationWindowDays: contenthealth.MaxCitationWindowDays, MinAnswers: contenthealth.MinAnswers, MaxFindingsPerSignal: contenthealth.MaxFindingsPerSignal,
		KeepReports: contenthealth.KeepReports, RetentionDays: contenthealth.RetentionDays, CooldownSeconds: int32(max(cooldown.Seconds(), 0)), PageSize: contenthealth.PageSize,
	}
}

func toAPIContentHealthReport(r contenthealth.Report) apitypes.ContentHealthReport {
	out := apitypes.ContentHealthReport{
		Id: r.ID, Status: apitypes.ContentHealthReportStatus(r.Status), SourceId: r.SourceID, KnowledgeBaseId: r.KBID, StaleDays: int32(r.StaleDays),
		CitationWindowDays: int32(r.CitationWindowDays), AsOf: r.AsOf, CreatedAt: r.CreatedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt, ExpiresAt: r.ExpiresAt,
		ErrorCode: r.ErrorCode, Signals: make([]apitypes.ContentHealthSignal, len(r.Signals)),
	}
	for i, s := range r.Signals {
		counts := s.Counts
		if counts == nil {
			counts = map[string]int64{}
		}
		out.Signals[i] = apitypes.ContentHealthSignal{
			Signal: apitypes.ContentHealthSignalName(s.Signal), State: apitypes.ContentHealthSignalState(s.State), Reason: s.Reason, Found: s.Found, Listed: s.Listed,
			Truncated: s.Truncated, Counts: counts, ObservedSince: s.ObservedSince,
		}
	}
	return out
}

func toAPIContentHealthFinding(f contenthealth.FindingView) apitypes.ContentHealthFinding {
	out := apitypes.ContentHealthFinding{
		Signal: apitypes.ContentHealthSignalName(f.Signal), Ord: f.Ord, SourceId: f.SourceID, SourceName: f.SourceName, SourceType: f.SourceType, Title: f.Title,
		Filename: f.Filename, Url: f.URL, Kind: f.Kind, Ref: f.Ref, GroupNo: f.GroupNo, GroupSize: f.GroupSize, Code: f.Code, Detail: f.Detail, Value: f.Value,
		ObservedAt: f.ObservedAt, ConfirmedAt: f.ConfirmedAt, ChangedSinceReport: f.ChangedSince,
	}
	if f.DocumentID != nil {
		id := *f.DocumentID
		out.DocumentId = &id
	}
	return out
}
