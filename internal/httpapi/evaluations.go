// Evaluation sets, questions and runs (docs/evaluations.md §6). Every route
// is session-only: internal/evals answers 404 to members, API keys and
// platform staff, and to everyone while the platform switch is off.

package httpapi

import (
	"context"
	"net/http"
	"regexp"
	"strconv"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/evals"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/httpx"
)

// evaluationRoutes: a team's evaluation sets and the platform switch.
func (a *api) evaluationRoutes() []route {
	const set = "/v1/teams/{team}/evaluation-sets/{setId}"
	return []route{
		{"GET", "/v1/teams/{team}/evaluation-sets", a.session(a.listEvaluationSets)},
		{"POST", "/v1/teams/{team}/evaluation-sets", a.session(a.createEvaluationSet)},
		{"GET", "/v1/teams/{team}/evaluation-documents", a.session(a.listEvaluationTargetDocuments)},
		{"POST", "/v1/teams/{team}/evaluation-question-check", a.session(a.checkEvaluationQuestion)},
		{"GET", set, a.session(a.getEvaluationSet)},
		{"PATCH", set, a.session(a.updateEvaluationSet)},
		{"DELETE", set, a.session(a.deleteEvaluationSet)},
		{"GET", set + "/questions", a.session(a.listEvaluationQuestions)},
		{"POST", set + "/questions", a.session(a.createEvaluationQuestion)},
		{"POST", set + "/questions/import", a.session(a.importEvaluationQuestions)},
		{"GET", set + "/questions.csv", a.session(a.exportEvaluationQuestions)},
		{"GET", set + "/questions/{questionId}", a.session(a.getEvaluationQuestion)},
		{"PATCH", set + "/questions/{questionId}", a.session(a.updateEvaluationQuestion)},
		{"DELETE", set + "/questions/{questionId}", a.session(a.deleteEvaluationQuestion)},
		{"GET", set + "/documents", a.session(a.listEvaluationDocuments)},
		{"GET", set + "/problems", a.session(a.listEvaluationSetProblems)},
		{"GET", set + "/runs", a.session(a.listEvaluationRuns)},
		{"POST", set + "/runs", a.session(a.startEvaluationRun)},
		{"GET", set + "/runs/compare", a.session(a.compareEvaluationRuns)},
		{"GET", set + "/runs/{runId}", a.session(a.getEvaluationRun)},
		{"POST", set + "/runs/{runId}/cancel", a.session(a.cancelEvaluationRun)},
		{"GET", "/v1/admin/settings/evaluations", a.admin(a.adminGetEvaluationSettings)},
		{"PUT", "/v1/admin/settings/evaluations", a.admin(a.adminPutEvaluationSettings)},
	}
}

// evaluationsOn reports the platform switch for /v1/me (off without the service).
func (a *api) evaluationsOn(ctx context.Context) bool {
	if a.Evaluations == nil {
		return false
	}
	on, err := a.Evaluations.Enabled(ctx)
	return err == nil && on
}

// queryUUID reads an optional UUID query parameter.
func queryUUID(w http.ResponseWriter, r *http.Request, name string) (*uuid.UUID, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_id", "Invalid "+name)
		return nil, false
	}
	return &id, true
}

// queryLimit reads ?limit= between 1 and max (0 when absent).
func queryLimit(w http.ResponseWriter, r *http.Request, max int) (int, bool) {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 0, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > max {
		httpx.Error(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and "+strconv.Itoa(max))
		return 0, false
	}
	return n, true
}

// ---- sets --------------------------------------------------------------------------

func (a *api) listEvaluationSets(w http.ResponseWriter, r *http.Request) {
	kb, ok := queryUUID(w, r, "kbId")
	if !ok {
		return
	}
	agent, ok := queryUUID(w, r, "agentId")
	if !ok {
		return
	}
	sets, err := a.Evaluations.List(r.Context(), a.actor(r), r.PathValue("team"), evals.Filter{KBID: kb, AgentID: agent})
	writeList(w, r, sets, err, toAPIEvaluationSet)
}

func (a *api) getEvaluationSet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	v, err := a.Evaluations.Get(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.EvalSet.Revision, toAPIEvaluationSet(v))
}

func (a *api) createEvaluationSet(w http.ResponseWriter, r *http.Request) {
	var in apitypes.EvaluationSetCreate
	if !httpx.Decode(w, r, &in) {
		return
	}
	v, err := a.Evaluations.Create(r.Context(), a.actor(r), r.PathValue("team"), evals.SetInput{
		KBID: in.KbId, AgentID: in.AgentId, Name: in.Name, Description: deref(in.Description, ""), AutoRun: in.AutoRun != nil && *in.AutoRun,
	})
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, v.EvalSet.Revision, toAPIEvaluationSet(v))
}

func (a *api) updateEvaluationSet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.EvaluationSetUpdate](w, r)
	if !ok {
		return
	}
	v, err := a.Evaluations.Update(r.Context(), a.actor(r), r.PathValue("team"), id,
		evals.SetUpdate{Name: in.Name, Description: in.Description, AutoRun: in.AutoRun}, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, v.EvalSet.Revision, toAPIEvaluationSet(v))
}

func (a *api) deleteEvaluationSet(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	writeOK(w, r, a.Evaluations.Delete(r.Context(), a.actor(r), r.PathValue("team"), id))
}

func (a *api) listEvaluationDocuments(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	limit, ok := queryLimit(w, r, 50)
	if !ok {
		return
	}
	docs, err := a.Evaluations.Documents(r.Context(), a.actor(r), r.PathValue("team"), id, r.URL.Query().Get("q"), limit)
	writeList(w, r, docs, err, toAPIEvaluationDocument)
}

// listEvaluationTargetDocuments is the picker for a knowledge base or agent
// without a set yet.
func (a *api) listEvaluationTargetDocuments(w http.ResponseWriter, r *http.Request) {
	kb, ok := queryUUID(w, r, "kbId")
	if !ok {
		return
	}
	agent, ok := queryUUID(w, r, "agentId")
	if !ok {
		return
	}
	limit, ok := queryLimit(w, r, 50)
	if !ok {
		return
	}
	docs, err := a.Evaluations.TargetDocuments(r.Context(), a.actor(r), r.PathValue("team"), evals.Filter{KBID: kb, AgentID: agent},
		r.URL.Query().Get("q"), limit)
	writeList(w, r, docs, err, toAPIEvaluationDocument)
}

// checkEvaluationQuestion is the question form's warnings: expected
// documents and must-mention phrases the knowledge bases don't hold yet.
func (a *api) checkEvaluationQuestion(w http.ResponseWriter, r *http.Request) {
	var in apitypes.EvaluationQuestionCheckRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	check := evals.CheckInput{SetID: in.SetId, KBID: in.KbId, AgentID: in.AgentId,
		Expected: evals.Expected{DocumentIDs: in.Expected.DocumentIds, URLs: in.Expected.Urls, Filenames: in.Expected.Filenames}}
	if in.MustMention != nil {
		check.MustMention = *in.MustMention
	}
	res, err := a.Evaluations.CheckQuestion(r.Context(), a.actor(r), r.PathValue("team"), check)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.EvaluationQuestionCheck{Expected: nonNil(viaJSON[[]apitypes.EvaluationExpectedItem](res.Expected)),
		MustMention: nonNil(viaJSON[[]apitypes.EvaluationMention](res.Mentions))})
}

func toAPIEvaluationDocument(d evals.Document) apitypes.EvaluationDocument {
	name := d.SourceName
	return apitypes.EvaluationDocument{Id: d.ID, Title: d.Title, Filename: d.Filename, Url: d.URL, SourceName: &name}
}

// ---- questions -----------------------------------------------------------------------

func caseInput(in apitypes.EvaluationQuestionInput) evals.CaseInput {
	out := evals.CaseInput{Question: in.Question, Note: deref(in.Note, ""),
		Expected: evals.Expected{DocumentIDs: in.Expected.DocumentIds, URLs: in.Expected.Urls, Filenames: in.Expected.Filenames}}
	if in.MustMention != nil {
		out.MustMention = *in.MustMention
	}
	return out
}

func (a *api) listEvaluationQuestions(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	cases, err := a.Evaluations.Questions(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	docs := a.expectedDocuments(r.Context(), cases...)
	out := make([]apitypes.EvaluationQuestion, len(cases))
	for i, c := range cases {
		out[i] = toAPIQuestion(c, docs)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) getEvaluationQuestion(w http.ResponseWriter, r *http.Request) {
	setID, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "questionId")
	if !ok {
		return
	}
	c, results, err := a.Evaluations.Question(r.Context(), a.actor(r), r.PathValue("team"), setID, id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.EvaluationQuestionDetail{Question: toAPIQuestion(c, a.expectedDocuments(r.Context(), c)),
		Results: make([]apitypes.EvaluationQuestionResult, len(results))}
	for i, res := range results {
		q := viaJSON[apitypes.EvaluationQuestionResult](toAPIResult(evals.DecodeResult(res.EvalResult)))
		q.RunId, q.RunKind, q.RunTrigger, q.RunCreatedAt = res.EvalResult.RunID, apitypes.EvaluationRunKind(res.RunKind),
			apitypes.EvaluationRunTrigger(res.RunTrigger), res.RunCreatedAt
		out.Results[i] = q
	}
	writeRevised(w, http.StatusOK, c.Revision, out)
}

func (a *api) createEvaluationQuestion(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	var in apitypes.EvaluationQuestionInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	c, err := a.Evaluations.CreateQuestion(r.Context(), a.actor(r), r.PathValue("team"), id, caseInput(in))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusCreated, c.Revision, toAPIQuestion(c, a.expectedDocuments(r.Context(), c)))
}

func (a *api) updateEvaluationQuestion(w http.ResponseWriter, r *http.Request) {
	setID, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "questionId")
	if !ok {
		return
	}
	in, rev, ok := decodeRevised[apitypes.EvaluationQuestionInput](w, r)
	if !ok {
		return
	}
	c, err := a.Evaluations.UpdateQuestion(r.Context(), a.actor(r), r.PathValue("team"), setID, id, caseInput(in), rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, c.Revision, toAPIQuestion(c, a.expectedDocuments(r.Context(), c)))
}

func (a *api) deleteEvaluationQuestion(w http.ResponseWriter, r *http.Request) {
	setID, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "questionId")
	if !ok {
		return
	}
	writeOK(w, r, a.Evaluations.DeleteQuestion(r.Context(), a.actor(r), r.PathValue("team"), setID, id))
}

func (a *api) importEvaluationQuestions(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	var in apitypes.EvaluationImportRequest
	if !httpx.Decode(w, r, &in) {
		return
	}
	res, err := a.Evaluations.Import(r.Context(), a.actor(r), r.PathValue("team"), id, evals.ImportInput{
		Format: string(in.Format), Content: in.Content, DryRun: in.DryRun != nil && *in.DryRun,
	})
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, apitypes.EvaluationImportResult{Rows: res.Rows, Usable: res.Usable, Added: res.Added,
		Problems: viaJSON[[]apitypes.EvaluationImportProblem](res.Problems), Warnings: nonNil(viaJSON[[]apitypes.EvaluationImportProblem](res.Warnings)),
		Max: res.Max, Current: res.Current})
}

var unsafeFilename = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func (a *api) exportEvaluationQuestions(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	name, body, err := a.Evaluations.Export(r.Context(), a.actor(r), r.PathValue("team"), id)
	if failed(w, r, err) {
		return
	}
	file := unsafeFilename.ReplaceAllString(name, "-")
	if file == "" || file == "-" {
		file = "evaluation"
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+file+`.csv"`)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// ---- runs ------------------------------------------------------------------------------

func (a *api) listEvaluationRuns(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	limit, ok := queryLimit(w, r, 200)
	if !ok {
		return
	}
	runs, err := a.Evaluations.Runs(r.Context(), a.actor(r), r.PathValue("team"), id, limit)
	writeList(w, r, runs, err, toAPIRun)
}

func (a *api) startEvaluationRun(w http.ResponseWriter, r *http.Request) {
	id, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	var in apitypes.EvaluationRunStart
	if !httpx.Decode(w, r, &in) {
		return
	}
	start := evals.StartInput{}
	if in.Kind != nil {
		start.Kind = string(*in.Kind)
	}
	if in.Version != nil {
		start.Version = string(*in.Version)
	}
	start.NoRerank = !deref(in.Rerank, true)
	run, err := a.Evaluations.StartRun(r.Context(), a.actor(r), r.PathValue("team"), id, start)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusCreated, toAPIRun(run))
}

func (a *api) getEvaluationRun(w http.ResponseWriter, r *http.Request) {
	setID, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "runId")
	if !ok {
		return
	}
	run, results, err := a.Evaluations.Run(r.Context(), a.actor(r), r.PathValue("team"), setID, id)
	if failed(w, r, err) {
		return
	}
	out := apitypes.EvaluationRunDetail{Run: toAPIRun(run), Results: make([]apitypes.EvaluationResult, len(results))}
	for i, res := range results {
		out.Results[i] = toAPIResult(res)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *api) cancelEvaluationRun(w http.ResponseWriter, r *http.Request) {
	setID, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	id, ok := pathUUID(w, r, "runId")
	if !ok {
		return
	}
	run, err := a.Evaluations.CancelRun(r.Context(), a.actor(r), r.PathValue("team"), setID, id)
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIRun(run))
}

func (a *api) compareEvaluationRuns(w http.ResponseWriter, r *http.Request) {
	setID, ok := pathUUID(w, r, "setId")
	if !ok {
		return
	}
	var ids [2]uuid.UUID
	for i, name := range []string{"a", "b"} {
		id, err := uuid.Parse(r.URL.Query().Get(name))
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "invalid_id", "Give the two runs to compare as a and b")
			return
		}
		ids[i] = id
	}
	ra, rb, items, err := a.Evaluations.Compare(r.Context(), a.actor(r), r.PathValue("team"), setID, ids[0], ids[1])
	if failed(w, r, err) {
		return
	}
	httpx.JSON(w, http.StatusOK, toAPIComparison(ra, rb, items))
}

// ---- the platform switch ---------------------------------------------------------------------

func (a *api) adminGetEvaluationSettings(w http.ResponseWriter, r *http.Request) {
	st, err := a.Evaluations.Settings(r.Context(), a.actor(r))
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, apitypes.EvaluationSettings{Enabled: st.Enabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}

func (a *api) adminPutEvaluationSettings(w http.ResponseWriter, r *http.Request) {
	in, rev, ok := decodeRevised[apitypes.EvaluationSettingsUpdate](w, r)
	if !ok {
		return
	}
	st, err := a.Evaluations.SetEnabled(r.Context(), a.actor(r), in.Enabled, rev)
	if failed(w, r, err) {
		return
	}
	writeRevised(w, http.StatusOK, st.Revision, apitypes.EvaluationSettings{Enabled: st.Enabled, Revision: st.Revision, UpdatedAt: st.UpdatedAt})
}
