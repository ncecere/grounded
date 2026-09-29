// Evaluation conversions for the API (docs/evaluations.md §6).

package httpapi

import (
	"context"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

func toAPIEvaluationSet(v evals.SetView) apitypes.EvaluationSet {
	s := v.EvalSet
	target := apitypes.EvaluationTarget{Type: apitypes.EvaluationTargetTypeKnowledgeBase, Id: s.KBID.UUID, Name: v.TargetName}
	if s.AgentID.Valid {
		target.Type, target.Id = apitypes.EvaluationTargetTypeAgent, s.AgentID.UUID
	}
	out := apitypes.EvaluationSet{Id: s.ID, Target: target, Name: s.Name, Description: s.Description, AutoRun: s.AutoRun,
		QuestionCount: v.QuestionCount, Revision: s.Revision, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt}
	if v.LastRunID.Valid && v.LastRunKind != nil && v.LastRunStatus != nil && v.LastRunAt != nil {
		var sum evals.Summary
		convertJSON(&sum, v.LastRunSummary)
		out.LastRun = &apitypes.EvaluationRunBrief{Id: v.LastRunID.UUID, Kind: apitypes.EvaluationRunKind(*v.LastRunKind),
			Status: apitypes.EvaluationRunStatus(*v.LastRunStatus), Summary: viaJSON[apitypes.EvaluationSummary](sum), CreatedAt: *v.LastRunAt}
	}
	return out
}

// expectedDocuments looks up the picked documents of questions.
func (a *api) expectedDocuments(ctx context.Context, cases ...evals.Case) map[uuid.UUID]dbgen.EvalDocumentsByIDRow {
	var ids []uuid.UUID
	for _, c := range cases {
		ids = append(ids, c.Want.DocumentIDs...)
	}
	out := map[uuid.UUID]dbgen.EvalDocumentsByIDRow{}
	if len(ids) == 0 {
		return out
	}
	rows, err := a.q.EvalDocumentsByID(ctx, ids)
	if err != nil {
		a.Log.Warn("evaluation documents", "err", err)
	}
	for _, r := range rows {
		out[r.ID] = r
	}
	return out
}

func toAPIQuestion(c evals.Case, docs map[uuid.UUID]dbgen.EvalDocumentsByIDRow) apitypes.EvaluationQuestion {
	out := apitypes.EvaluationQuestion{Id: c.ID, Question: c.Question, MustMention: c.MustMention, Note: c.Note, Revision: c.Revision,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt, ExpectedDocuments: []apitypes.EvaluationDocument{},
		Expected: apitypes.EvaluationExpected{DocumentIds: nonNil(c.Want.DocumentIDs), Urls: nonNil(c.Want.URLs), Filenames: nonNil(c.Want.Filenames)}}
	if out.MustMention == nil {
		out.MustMention = []string{}
	}
	for _, id := range c.Want.DocumentIDs {
		if d, ok := docs[id]; ok {
			out.ExpectedDocuments = append(out.ExpectedDocuments, apitypes.EvaluationDocument{Id: d.ID, Title: d.Title, Filename: d.Filename, Url: d.URL})
		}
	}
	return out
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

func toAPIRun(r evals.Run) apitypes.EvaluationRun {
	out := apitypes.EvaluationRun{Id: r.ID, SetId: r.SetID, Kind: apitypes.EvaluationRunKind(r.Kind), Trigger: apitypes.EvaluationRunTrigger(r.Trigger),
		Status: apitypes.EvaluationRunStatus(r.Status), Config: viaJSON[apitypes.EvaluationRunConfig](r.Config),
		Summary: viaJSON[apitypes.EvaluationSummary](r.Summary), Total: int(r.Total), Done: int(r.Done), Error: r.Error,
		CreatedAt: r.CreatedAt, StartedAt: r.StartedAt, FinishedAt: r.FinishedAt}
	if out.Config.Kbs == nil {
		out.Config.Kbs = []apitypes.EvaluationRunKB{}
	}
	if r.StartedBy.Valid {
		id := r.StartedBy.UUID
		out.StartedBy = &id
	}
	return out
}

func toAPIResult(r evals.Result) apitypes.EvaluationResult {
	out := apitypes.EvaluationResult{Id: r.ID, Question: r.Question, Status: apitypes.EvaluationResultStatus(r.Status), Answer: r.Answer,
		Error: r.Error, LatencyMs: int(r.LatencyMs), Hits: viaJSON[[]apitypes.EvaluationHit](r.Hits)}
	if out.Hits == nil {
		out.Hits = []apitypes.EvaluationHit{}
	}
	d := r.Diagnosis
	out.ExpectedItems = nonNil(viaJSON[[]apitypes.EvaluationExpectedItem](d.Expected))
	if d.Missing != "" && r.Status == evals.StatusMissing {
		reason := apitypes.EvaluationResultMissingReason(d.Missing)
		out.MissingReason = &reason
	}
	if d.K > 0 {
		out.K = &d.K
	}
	if d.Depth > 0 {
		out.SearchDepth = &d.Depth
	}
	if r.CaseID.Valid {
		id := r.CaseID.UUID
		out.QuestionId = &id
	}
	if r.Rank != nil {
		n := int(*r.Rank)
		out.Rank = &n
	}
	if r.Scores != nil {
		sc := viaJSON[apitypes.EvaluationAnswerScores](*r.Scores)
		out.Scores = &sc
		out.Claims = viaJSON[*[]apitypes.Claim](r.Scores.Claims)
	}
	return out
}

func toAPIComparison(a, b evals.Run, items []evals.Comparison) apitypes.EvaluationComparison {
	out := apitypes.EvaluationComparison{A: toAPIRun(a), B: toAPIRun(b), Items: make([]apitypes.EvaluationComparisonItem, len(items))}
	for i, it := range items {
		c := apitypes.EvaluationComparisonItem{Question: it.Question, Change: apitypes.EvaluationComparisonItemChange(it.Change)}
		if it.CaseID.Valid {
			id := it.CaseID.UUID
			c.QuestionId = &id
		}
		if it.A != nil {
			ra := toAPIResult(*it.A)
			c.A = &ra
		}
		if it.B != nil {
			rb := toAPIResult(*it.B)
			c.B = &rb
		}
		switch it.Change {
		case evals.ChangeBetter:
			out.Better++
		case evals.ChangeWorse:
			out.Worse++
		case evals.ChangeSame:
			out.Same++
		}
		out.Items[i] = c
	}
	return out
}
