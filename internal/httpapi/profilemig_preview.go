package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// adminPreviewComparison is the comparison of an index preview for the platform admin who decides: scores and counts, no question text
// (evaluation sets are the team's).
func (a *api) adminPreviewComparison(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "migrationId")
	if !ok {
		return
	}
	c, err := a.Evaluations.PreviewForAdmin(r.Context(), id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIPreviewComparison(c))
}

// getKBIndexPreview is the same comparison with the questions, for the team's editors, admins and owners (the evaluation sets' own access);
// null when the knowledge base has no preview that is building or waiting.
func (a *api) getKBIndexPreview(w http.ResponseWriter, r *http.Request) {
	kbID, ok := pathUUID(w, r, "kbId")
	if !ok {
		return
	}
	c, err := a.Evaluations.PreviewForTeam(r.Context(), a.actor(r), r.PathValue("team"), kbID)
	if failed(w, r, err) {
		return
	}
	if c == nil {
		httpx.JSON(w, http.StatusOK, nil)
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIPreviewComparison(*c))
}

func toAPIPreviewComparison(c evals.PreviewComparison) apitypes.ProfileMigrationComparison {
	out := apitypes.ProfileMigrationComparison{
		MigrationId: c.MigrationID, Status: apitypes.ProfileMigrationStatus(c.MigrationStatus), Running: c.Running,
		Sets: make([]apitypes.PreviewSetComparison, len(c.Sets)),
		Totals: apitypes.PreviewTotals{
			Sets: int64(c.Totals.Sets), Questions: int64(c.Totals.Questions),
			Live: viaJSON[apitypes.EvaluationSummary](c.Totals.Live), Candidate: viaJSON[apitypes.EvaluationSummary](c.Totals.Candidate),
			LiveFirstPlace: int64(c.Totals.LiveFirst), CandidateFirstPlace: int64(c.Totals.CandFirst),
			Better: int64(c.Totals.Better), Worse: int64(c.Totals.Worse), Same: int64(c.Totals.Same),
		},
	}
	side := func(s *evals.PreviewSide) *apitypes.PreviewSide {
		if s == nil {
			return nil
		}
		return &apitypes.PreviewSide{RunId: s.RunID, Status: apitypes.PreviewSideStatus(s.Status), CreatedAt: s.CreatedAt,
			Summary: viaJSON[apitypes.EvaluationSummary](s.Summary), FirstPlace: int64(s.FirstPlace)}
	}
	for i, s := range c.Sets {
		ps := apitypes.PreviewSetComparison{SetId: s.SetID, Name: s.Name, Questions: int64(s.Questions), Live: side(s.Live), Candidate: side(s.Candidate),
			Better: int64(s.Better), Worse: int64(s.Worse), Same: int64(s.Same), Unscored: int64(s.Unscored)}
		if s.Items != nil {
			items := make([]apitypes.PreviewQuestionChange, len(s.Items))
			for j, it := range s.Items {
				items[j] = apitypes.PreviewQuestionChange{CaseId: nullUUID(it.CaseID), Question: it.Question, Change: previewChange(it.Change),
					LiveStatus: it.LiveStatus, CandidateStatus: it.CandidateStatus, LiveRank: it.LiveRank, CandidateRank: it.CandidateRank}
			}
			ps.Items = &items
		}
		out.Sets[i] = ps
	}
	return out
}

// previewChange names a change for the two sides of a preview (the comparison's A is the live index, B the candidate).
func previewChange(c string) apitypes.PreviewQuestionChangeChange {
	switch c {
	case evals.ChangeOnlyA:
		return "only_live"
	case evals.ChangeOnlyB:
		return "only_candidate"
	}
	return apitypes.PreviewQuestionChangeChange(c)
}
