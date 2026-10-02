// A set's questions that need attention (docs/evaluations.md §1,
// docs/v0.4.1.md §2): the set page's "Needs attention" filter and count, and
// the run dialog's "can't pass" count.

package httpapi

import (
	"net/http"

	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func (a *api) listEvaluationSetProblems(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	problems, err := a.Evaluations.Problems(r.Context(), a.actor(r), r.PathValue("team"), id)
	writeList(w, r, problems, err, toAPIQuestionProblem)
}

func toAPIQuestionProblem(p evals.QuestionProblem) apitypes.EvaluationQuestionProblem {
	out := apitypes.EvaluationQuestionProblem{QuestionId: p.QuestionID,
		Expected: nonNil(viaJSON[[]apitypes.EvaluationExpectedItem](p.Expected)), MustMention: nonNil(p.Phrases)}
	if p.Missing != "" {
		m := apitypes.EvaluationQuestionProblemMissingReason(p.Missing)
		out.MissingReason = &m
	}
	if p.OutOfReach != nil {
		out.OutOfReach = &apitypes.EvaluationOutOfReach{Runs: evals.OutOfReachRuns, Depth: evals.DeepSearch,
			RunId: p.OutOfReach.RunID, ResultId: p.OutOfReach.ResultID}
	}
	return out
}
