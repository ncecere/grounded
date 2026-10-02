package httpapi_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A set's questions that need attention (docs/evaluations.md §1,
// docs/v0.4.1.md §2): expected documents not in the knowledge base,
// phrases in no source, and out of reach after 3 retrieval runs.

func (env *agentEnv) problems(t *testing.T, set apitypes.EvaluationSet) map[uuid.UUID]apitypes.EvaluationQuestionProblem {
	t.Helper()
	var list []apitypes.EvaluationQuestionProblem
	if code := env.editor.get(env.evalBase()+"/"+set.Id.String()+"/problems", &list); code != 200 {
		t.Fatalf("problems = %d", code)
	}
	out := map[uuid.UUID]apitypes.EvaluationQuestionProblem{}
	for _, p := range list {
		out[p.QuestionId] = p
	}
	return out
}

// seedRetrievalResult records a finished retrieval run of the set with one
// result for the question: status and its stored diagnosis (scores), n
// minutes after the set's other seeded runs.
func (env *agentEnv) seedRetrievalResult(t *testing.T, set apitypes.EvaluationSet, q apitypes.EvaluationQuestion, n int, status, scores string) (run, result string) {
	t.Helper()
	ctx := context.Background()
	at := fmt.Sprintf("now() + interval '%d minutes'", n)
	err := env.app.Pool.QueryRow(ctx, `INSERT INTO eval_runs (set_id, team_id, kind, trigger, status, created_at, finished_at)
		SELECT id, team_id, 'retrieval', 'nightly', 'completed', `+at+`, `+at+` FROM eval_sets WHERE id = $1 RETURNING id::text`, set.Id).Scan(&run)
	if err != nil {
		t.Fatal(err)
	}
	err = env.app.Pool.QueryRow(ctx, `INSERT INTO eval_results (run_id, case_id, question, status, scores, created_at)
		VALUES ($1, $2, $3, $4, $5::jsonb, `+at+`) RETURNING id::text`, run, q.Id, q.Question, status, scores).Scan(&result)
	if err != nil {
		t.Fatal(err)
	}
	return run, result
}

func TestEvaluationSetProblems(t *testing.T) {
	env := newAgentEnv(t)
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Attention"})
	if got := env.problems(t, set); len(got) != 0 {
		t.Fatalf("an empty set's problems = %+v", got)
	}
	parking := env.addQuestion(t, set, qParking, map[string]any{"filenames": []string{"parking.md"}}, "Parchment")
	grad := env.addQuestion(t, set, "Where is graduate housing?", map[string]any{"filenames": []string{"grad-housing.pdf"}})
	mixed := env.addQuestion(t, set, "What are the fees?", map[string]any{"urls": []string{"https://example.edu/fees*"}, "filenames": []string{"parking.md"}})
	housing := env.addQuestion(t, set, qHousing, map[string]any{"filenames": []string{"housing.md"}})

	got := env.problems(t, set)
	// A knowledge base's sets run retrieval checks only: phrases aren't checked.
	if _, ok := got[parking.Id]; ok || len(got) != 2 {
		t.Fatalf("problems = %+v", got)
	}
	if p := got[grad.Id]; p.MissingReason == nil || *p.MissingReason != "not_indexed" || len(p.Expected) != 1 || p.Expected[0].State != "not_indexed" ||
		p.OutOfReach != nil {
		t.Errorf("grad = %+v", p)
	}
	// One expected document is there: the question can still pass.
	if p := got[mixed.Id]; p.MissingReason != nil || len(p.Expected) != 1 || p.Expected[0].Value != "https://example.edu/fees*" {
		t.Errorf("mixed = %+v", p)
	}

	// Out of reach: the expected document is in the knowledge base, but each
	// of the last 3 retrieval runs missed it in the top 50.
	miss := `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed"}],"k":4,"depth":50}`
	env.seedRetrievalResult(t, set, housing, 1, "fail", miss)
	env.seedRetrievalResult(t, set, housing, 2, "fail", miss)
	if _, ok := env.problems(t, set)[housing.Id]; ok {
		t.Fatal("out of reach after 2 runs")
	}
	run, result := env.seedRetrievalResult(t, set, housing, 3, "fail", miss)
	p, ok := env.problems(t, set)[housing.Id]
	if !ok || p.OutOfReach == nil || p.OutOfReach.RunId.String() != run || p.OutOfReach.ResultId.String() != result ||
		p.OutOfReach.Runs != 3 || p.OutOfReach.Depth != 50 || len(p.Expected) != 0 || p.MissingReason != nil {
		t.Fatalf("housing = %+v", p)
	}
	// Found beyond k (at #12) in the latest run: within reach again.
	env.seedRetrievalResult(t, set, housing, 4, "fail", `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed","rank":12}],"k":4,"depth":50}`)
	if _, ok := env.problems(t, set)[housing.Id]; ok {
		t.Error("out of reach though found at #12")
	}
	// Three misses again, but one from before the expected documents changed doesn't count.
	env.seedRetrievalResult(t, set, housing, 5, "fail", miss)
	env.seedRetrievalResult(t, set, housing, 6, "fail", `{"expected":[{"kind":"filename","value":"old.md","state":"indexed"}],"k":4,"depth":50}`)
	env.seedRetrievalResult(t, set, housing, 7, "fail", miss)
	if _, ok := env.problems(t, set)[housing.Id]; ok {
		t.Error("out of reach with a result for other expected documents")
	}
	// A deeper search that failed (no depth) is no evidence either.
	env.seedRetrievalResult(t, set, housing, 8, "fail", miss)
	env.seedRetrievalResult(t, set, housing, 9, "fail", `{"expected":[{"kind":"filename","value":"housing.md","state":"indexed"}],"k":4}`)
	env.seedRetrievalResult(t, set, housing, 10, "fail", miss)
	if _, ok := env.problems(t, set)[housing.Id]; ok {
		t.Error("out of reach without a deeper search")
	}
	// Deleted since: missing, not out of reach.
	env.seedRetrievalResult(t, set, housing, 11, "fail", miss)
	env.seedRetrievalResult(t, set, housing, 12, "fail", miss)
	env.deleteDocument(t, "housing.md")
	if p := env.problems(t, set)[housing.Id]; p.OutOfReach != nil || p.MissingReason == nil || *p.MissingReason != "not_indexed" {
		t.Errorf("deleted housing = %+v", p)
	}

	// An agent's sets check must-mention phrases too.
	ag := env.publishAgent(t, "Attentive", env.agentConfig(env.kb.Id.String()))
	agentSet := env.newEvalSet(t, map[string]any{"agentId": ag.Id, "name": "Answers"})
	q := env.addQuestion(t, agentSet, qParking, map[string]any{"filenames": []string{"parking.md"}}, "parking permits", "Parchment", "the")
	env.addQuestion(t, agentSet, "Who sells permits?", map[string]any{"filenames": []string{"parking.md"}}, "parking permits")
	got = env.problems(t, agentSet)
	if p := got[q.Id]; len(got) != 1 || strings.Join(p.MustMention, ",") != "Parchment" || len(p.Expected) != 0 || p.MissingReason != nil {
		t.Errorf("agent set problems = %+v", got)
	}

	// Editors and above only.
	if code, _ := env.member.call("GET", env.evalBase()+"/"+set.Id.String()+"/problems", nil, nil, nil); code != 404 {
		t.Errorf("a member's problems = %d", code)
	}
}
