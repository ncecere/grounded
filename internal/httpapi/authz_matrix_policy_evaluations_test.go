package httpapi_test

import (
	"fmt"
	"strconv"
	"testing"
)

// Classification of evaluation sets (docs/evaluations.md §6): the team's
// editors, admins and owners, in the app. Members, API keys and platform
// staff get 404 (never another team's), and the platform switch is on
// admin settings.

func init() {
	for id, p := range evaluationPolicies {
		p.scope = scopeTeam
		register(id, p)
	}
	register("adminGetEvaluationSettings", policy{scope: scopeGlobal, own: platform, build: func(*mctx) request {
		return get("/v1/admin/settings/evaluations")
	}})
	register("adminPutEvaluationSettings", policy{scope: scopeGlobal, own: padmin, build: func(c *mctx) request {
		p := "/v1/admin/settings/evaluations"
		return put(p, map[string]any{"enabled": true}).h(c.rev(p))
	}})
}

func (c *mctx) evalSet(suffix string) string {
	return c.team("/evaluation-sets/" + c.tf.evalSet + suffix)
}

// questionRev is an If-Match header with a question's revision.
func (c *mctx) questionRev(path string) map[string]string {
	n, _ := strconv.ParseInt(field(must(c.t, c.tf.owner, "GET", path, nil, nil), "question.revision"), 10, 64)
	return ifMatch(n)
}

var evaluationPolicies = map[string]policy{
	"listEvaluationSets": {own: editors, build: func(c *mctx) request { return get(c.team("/evaluation-sets")) }},
	"createEvaluationSet": {own: editors, build: func(c *mctx) request {
		return post(c.team("/evaluation-sets"), map[string]any{"kbId": c.tf.kb, "name": fmt.Sprintf("matrix set %d", c.e.next())})
	}},
	"getEvaluationSet": {own: editors, build: func(c *mctx) request { return get(c.evalSet("")) }},
	"updateEvaluationSet": {own: editors, build: func(c *mctx) request {
		return patch(c.evalSet(""), map[string]any{"description": upd}).h(c.rev(c.evalSet("")))
	}},
	"deleteEvaluationSet": {own: editors, build: func(c *mctx) request {
		return del(c.team("/evaluation-sets/" + c.pick(c.tf.evalSet, c.e.freshEvalSet)))
	}},
	"listEvaluationQuestions": {own: editors, build: func(c *mctx) request { return get(c.evalSet("/questions")) }},
	"createEvaluationQuestion": {own: editors, build: func(c *mctx) request {
		return post(c.evalSet("/questions"), map[string]any{"question": fmt.Sprintf("Matrix question %d?", c.e.next()),
			"expected": map[string]any{"urls": []string{"https://example.edu/matrix*"}}})
	}},
	"getEvaluationQuestion": {own: editors, build: func(c *mctx) request { return get(c.evalSet("/questions/" + c.tf.evalQuestion)) }},
	"updateEvaluationQuestion": {own: editors, build: func(c *mctx) request {
		p := c.evalSet("/questions/" + c.tf.evalQuestion)
		return patch(p, map[string]any{"question": "Where do students park?", "expected": map[string]any{"filenames": []string{"parking.md"}},
			"note": upd}).h(c.questionRev(p))
	}},
	"deleteEvaluationQuestion": {own: editors, build: func(c *mctx) request {
		return del(c.evalSet("/questions/" + c.pick(c.tf.evalQuestion, c.e.freshEvalQuestion)))
	}},
	"importEvaluationQuestions": {own: editors, build: func(c *mctx) request {
		return post(c.evalSet("/questions/import"), map[string]any{"format": "csv", "dryRun": true,
			"content": "question,expected\nWhere is the library?,library.txt\n"})
	}},
	"exportEvaluationQuestions": {own: editors, build: func(c *mctx) request { return get(c.evalSet("/questions.csv")) }},
	"listEvaluationDocuments":   {own: editors, build: func(c *mctx) request { return get(c.evalSet("/documents?q=a")) }},
	"listEvaluationTargetDocuments": {own: editors, build: func(c *mctx) request {
		return get(c.team("/evaluation-documents?q=a&kbId=" + c.tf.kb))
	}},
	"listEvaluationRuns": {own: editors, build: func(c *mctx) request { return get(c.evalSet("/runs")) }},
	"startEvaluationRun": {own: editors, build: func(c *mctx) request {
		set := c.pick(c.tf.evalSet, c.e.freshEvalSet)
		return post(c.team("/evaluation-sets/"+set+"/runs"), map[string]any{"kind": "retrieval"})
	}},
	"getEvaluationRun": {own: editors, build: func(c *mctx) request { return get(c.evalSet("/runs/" + c.tf.evalRun)) }},
	"compareEvaluationRuns": {own: editors, build: func(c *mctx) request {
		return get(c.evalSet("/runs/compare?a=" + c.tf.evalRun + "&b=" + c.tf.evalRun))
	}},
	"cancelEvaluationRun": {own: editors, also: []string{"409 run_not_running"}, build: func(c *mctx) request {
		set, run := c.tf.evalSet, c.tf.evalRun
		if c.allowed {
			set, run = c.e.freshEvalRun(c.t, c.tf)
		}
		return post(c.team("/evaluation-sets/"+set+"/runs/"+run+"/cancel"), nil)
	}},
}

// seedEvaluations gives a team a set on its knowledge base with a question
// and a retrieval check.
func (e *matrixEnv) seedEvaluations(t *testing.T, f *teamFix, prefix string) {
	t.Helper()
	s, base := f.owner, "/v1/teams/"+f.slug+"/evaluation-sets"
	f.evalSet = field(must(t, s, "POST", base, map[string]any{"kbId": f.kb, "name": prefix + " questions"}, nil), "id")
	f.evalQuestion = field(must(t, s, "POST", base+"/"+f.evalSet+"/questions", map[string]any{"question": "Where do " + prefix + " students park?",
		"expected": map[string]any{"filenames": []string{"parking.md"}}}, nil), "id")
	f.evalRun = field(must(t, s, "POST", base+"/"+f.evalSet+"/runs", map[string]any{"kind": "retrieval"}, nil), "id")
	f.ids = append(f.ids, f.evalSet, f.evalQuestion, f.evalRun)
}

// freshEvalSet is a new set on the team's knowledge base with one question.
func (e *matrixEnv) freshEvalSet(t *testing.T, f *teamFix) string {
	base := "/v1/teams/" + f.slug + "/evaluation-sets"
	id := field(must(t, f.owner, "POST", base, map[string]any{"kbId": f.kb, "name": fmt.Sprintf("fresh set %d", e.next())}, nil), "id")
	must(t, f.owner, "POST", base+"/"+id+"/questions", map[string]any{"question": "Where is the library?",
		"expected": map[string]any{"filenames": []string{"library.txt"}}}, nil)
	return id
}

func (e *matrixEnv) freshEvalQuestion(t *testing.T, f *teamFix) string {
	return field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/evaluation-sets/"+f.evalSet+"/questions", map[string]any{
		"question": fmt.Sprintf("Fresh question %d?", e.next()), "expected": map[string]any{"urls": []string{"https://example.edu/fresh"}}}, nil), "id")
}

// freshEvalRun starts a run of a fresh set.
func (e *matrixEnv) freshEvalRun(t *testing.T, f *teamFix) (set, run string) {
	set = e.freshEvalSet(t, f)
	run = field(must(t, f.owner, "POST", "/v1/teams/"+f.slug+"/evaluation-sets/"+set+"/runs", map[string]any{"kind": "retrieval"}, nil), "id")
	return set, run
}
