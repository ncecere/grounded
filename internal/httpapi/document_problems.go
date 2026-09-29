// Admin -> Parsing & OCR: documents that failed or need OCR, by team,
// source and reason, with Retry these and Notify owners (owner decision 3 of
// docs/v0.2.0.md §7). Counts only: no document names, titles or text.

package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

func (a *api) documentProblemRoutes() []route {
	return []route{
		{"GET", "/v1/admin/parsing/document-problems", a.admin(a.adminListDocumentProblems)},
		{"POST", "/v1/admin/parsing/document-problems/retry", a.admin(a.adminRetryDocumentProblems)},
		{"POST", "/v1/admin/parsing/document-problems/notify", a.admin(a.adminNotifyDocumentProblems)},
	}
}

func (a *api) adminListDocumentProblems(w http.ResponseWriter, r *http.Request) {
	groups, err := a.Sources.DocumentProblems(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	out := apitypes.DocumentProblemList{Items: make([]apitypes.DocumentProblemGroup, 0, len(groups))}
	for _, g := range groups {
		it := apitypes.DocumentProblemGroup{TeamSlug: g.TeamSlug, TeamName: g.TeamName, SourceId: g.SourceID, SourceName: g.SourceName,
			Reason: apitypes.DocumentProblemReason(g.Reason), Documents: g.Documents, OldestAt: g.Oldest, OcrState: apitypes.DocumentProblemGroupOcrState(g.OCRState)}
		if g.TeamID.Valid {
			id := g.TeamID.UUID
			it.TeamId = &id
		}
		out.Items = append(out.Items, it)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) adminRetryDocumentProblems(w http.ResponseWriter, r *http.Request) {
	var in apitypes.DocumentProblemAction
	if !httpx.Decode(w, r, &in) {
		return
	}
	n, err := a.Sources.RetryProblems(r.Context(), a.actor(r), in.SourceId, string(in.Reason))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.DocumentRetryResult{Retried: int32(n)})
}

func (a *api) adminNotifyDocumentProblems(w http.ResponseWriter, r *http.Request) {
	var in apitypes.DocumentProblemAction
	if !httpx.Decode(w, r, &in) {
		return
	}
	owners, docs, err := a.Sources.NotifyProblems(r.Context(), a.actor(r), in.SourceId, string(in.Reason))
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.DocumentProblemNotifyResult{Owners: int(owners), Documents: docs})
}
