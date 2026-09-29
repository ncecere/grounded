package httpapi_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/store"
	"github.com/ncecere/grounded/internal/store/dbgen"
)

// Evaluations (docs/evaluations.md): sets, questions, imports, runs and
// the platform switch, through the API with a River worker and the fake
// model gateway.

func (env *agentEnv) evalBase() string { return env.base + "/evaluation-sets" }

// newEvalSet creates a set as the editor on a knowledge base or an agent.
func (env *agentEnv) newEvalSet(t *testing.T, target map[string]any) apitypes.EvaluationSet {
	t.Helper()
	var set apitypes.EvaluationSet
	code, e := env.editor.call("POST", env.evalBase(), target, &set, nil)
	mustCode(t, "create set", code, e, 201, "")
	return set
}

func (env *agentEnv) addQuestion(t *testing.T, set apitypes.EvaluationSet, question string, expected map[string]any, mention ...string) apitypes.EvaluationQuestion {
	t.Helper()
	var q apitypes.EvaluationQuestion
	code, e := env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/questions",
		map[string]any{"question": question, "expected": expected, "mustMention": mention}, &q, nil)
	mustCode(t, "add question", code, e, 201, "")
	return q
}

// runEval starts a run and waits for it to end.
func (env *agentEnv) runEval(t *testing.T, set apitypes.EvaluationSet, body map[string]any) apitypes.EvaluationRunDetail {
	t.Helper()
	var run apitypes.EvaluationRun
	code, e := env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/runs", body, &run, nil)
	mustCode(t, "start run", code, e, 201, "")
	return env.waitEval(t, set, run.Id.String())
}

func (env *agentEnv) waitEval(t *testing.T, set apitypes.EvaluationSet, runID string) apitypes.EvaluationRunDetail {
	t.Helper()
	var d apitypes.EvaluationRunDetail
	eventually(t, "evaluation run", func() bool {
		env.editor.get(env.evalBase()+"/"+set.Id.String()+"/runs/"+runID, &d)
		return d.Run.Status != "queued" && d.Run.Status != "running"
	})
	return d
}

func resultFor(d apitypes.EvaluationRunDetail, question string) apitypes.EvaluationResult {
	for _, r := range d.Results {
		if r.Question == question {
			return r
		}
	}
	return apitypes.EvaluationResult{}
}

const (
	qParking = "Where do students buy a parking permit?"
	qHousing = "When do residence halls open for move-in?"
	qGone    = "What does the old fees page say?"
)

func TestEvaluationRetrievalRun(t *testing.T) {
	env := newAgentEnv(t)
	// A knowledge base over the same source with one result per search, so
	// a question whose expected document isn't the best match fails.
	var kb apitypes.KnowledgeBase
	code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Narrow help", "topK": 1}, &kb, nil)
	mustCode(t, "kb", code, e, 201, "")
	code, e = env.owner.call("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+env.upload.Id.String(), nil, &kb, nil)
	mustCode(t, "attach", code, e, 200, "")

	set := env.newEvalSet(t, map[string]any{"kbId": kb.Id, "name": "Student questions"})
	if set.Target.Type != "knowledge_base" || set.Target.Name != "Narrow help" || set.QuestionCount != 0 || set.LastRun != nil || set.PreviousRun != nil {
		t.Fatalf("set = %+v", set)
	}
	env.addQuestion(t, set, qParking, map[string]any{"filenames": []string{"parking.md"}})
	env.addQuestion(t, set, qHousing, map[string]any{"filenames": []string{"library.txt"}})
	env.addQuestion(t, set, qGone, map[string]any{"urls": []string{"https://example.edu/fees*"}})

	// The picker finds the knowledge base's documents.
	var docs []apitypes.EvaluationDocument
	env.editor.get(env.evalBase()+"/"+set.Id.String()+"/documents?q=park", &docs)
	if len(docs) != 1 || docs[0].Filename != "parking.md" {
		t.Fatalf("documents = %+v", docs)
	}
	// And, before a set exists, for the knowledge base itself; by filename too.
	docs = nil
	env.editor.get(env.base+"/evaluation-documents?kbId="+kb.Id.String()+"&q=parking.md", &docs)
	if len(docs) != 1 || docs[0].Filename != "parking.md" {
		t.Fatalf("target documents = %+v", docs)
	}
	code, e = env.editor.call("GET", env.base+"/evaluation-documents?q=park", nil, nil, nil)
	mustCode(t, "no target", code, e, 400, "invalid_target")
	if code, _ := env.member.call("GET", env.base+"/evaluation-documents?q=park&kbId="+kb.Id.String(), nil, nil, nil); code != 404 {
		t.Errorf("a member's target documents = %d", code)
	}

	d := env.runEval(t, set, map[string]any{"kind": "retrieval"})
	s := d.Run.Summary
	if d.Run.Status != "completed" || d.Run.Trigger != "manual" || d.Run.Done != 3 || s.Passed != 1 || s.Failed != 1 || s.Missing != 1 {
		t.Fatalf("run = %+v", d.Run)
	}
	if s.Recall == nil || *s.Recall != 0.5 || s.Mrr == nil || *s.Mrr != 0.5 || s.K != 1 || d.Run.Config.ResultsPerSearch != 1 {
		t.Errorf("summary = %+v config %+v", s, d.Run.Config)
	}
	if len(d.Run.Config.Kbs) != 1 || d.Run.Config.Kbs[0].Profile == "" {
		t.Errorf("config = %+v", d.Run.Config)
	}
	parking, housing, gone := resultFor(d, qParking), resultFor(d, qHousing), resultFor(d, qGone)
	if parking.Status != "pass" || parking.Rank == nil || *parking.Rank != 1 || len(parking.Hits) != 1 || !parking.Hits[0].Expected {
		t.Errorf("parking = %+v", parking)
	}
	if housing.Status != "fail" || housing.Rank != nil || len(housing.Hits) != 1 || (housing.Hits[0].Filename == nil || *housing.Hits[0].Filename != "housing.md") || housing.Hits[0].Expected {
		t.Errorf("housing = %+v", housing)
	}
	// What came back has the passage's start; the expected document is in
	// the knowledge base, and a deeper search found its rank beyond k.
	if h := housing.Hits[0]; h.Snippet == nil || !strings.Contains(*h.Snippet, "Residence halls open") {
		t.Errorf("housing hit = %+v", h)
	}
	if it := housing.ExpectedItems; len(it) != 1 || it[0].Kind != "filename" || it[0].Value != "library.txt" || it[0].State != "indexed" ||
		it[0].Rank == nil || *it[0].Rank < 2 || housing.SearchDepth == nil || *housing.SearchDepth != 50 || housing.K == nil || *housing.K != 1 ||
		housing.MissingReason != nil {
		t.Errorf("housing expected = %+v depth %v k %v", it, housing.SearchDepth, housing.K)
	}
	if it := parking.ExpectedItems; len(it) != 1 || it[0].State != "indexed" || it[0].Rank == nil || *it[0].Rank != 1 || parking.SearchDepth != nil ||
		it[0].DocumentId == nil || it[0].SourceId == nil || *it[0].SourceId != env.upload.Id || it[0].Title == nil || *it[0].Title == "" {
		t.Errorf("parking expected = %+v", it)
	}
	// A URL nothing ever matched: not in this knowledge base (not "deleted"),
	// not scored, and what came back is still listed.
	if gone.Status != "missing" || gone.MissingReason == nil || *gone.MissingReason != "not_indexed" || len(gone.Hits) != 1 ||
		len(gone.ExpectedItems) != 1 || gone.ExpectedItems[0].State != "not_indexed" {
		t.Errorf("gone = %+v", gone)
	}
	if s.NotIndexed != 1 {
		t.Errorf("not indexed = %d", s.NotIndexed)
	}
	// Four queries (the missing question's search, and the housing
	// question's deeper search for its rank), tagged as evaluation usage.
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'query' AND metadata->>'source' = 'evaluation'
		AND metadata->>'evaluationRunId' = $1 AND kb_id = $2`, d.Run.Id.String(), kb.Id); n != 4 {
		t.Errorf("evaluation queries = %d", n)
	}

	// More results per search: the housing question now passes; compare.
	var updated apitypes.KnowledgeBase
	code, e = env.owner.call("PATCH", env.base+"/kbs/"+kb.Id.String(), map[string]any{"topK": 4}, &updated, ifMatch(kb.Revision))
	mustCode(t, "topK", code, e, 200, "")
	d2 := env.runEval(t, set, map[string]any{})
	if d2.Run.Summary.Passed != 2 || d2.Run.Config.ResultsPerSearch != 4 {
		t.Fatalf("second run = %+v", d2.Run)
	}
	var cmp apitypes.EvaluationComparison
	code, e = env.editor.call("GET", env.evalBase()+"/"+set.Id.String()+"/runs/compare?a="+d.Run.Id.String()+"&b="+d2.Run.Id.String(), nil, &cmp, nil)
	mustCode(t, "compare", code, e, 200, "")
	if cmp.Better != 1 || cmp.Worse != 0 || cmp.Same != 2 {
		t.Errorf("compare = better %d worse %d same %d", cmp.Better, cmp.Worse, cmp.Same)
	}
	var runs []apitypes.EvaluationRun
	env.editor.get(env.evalBase()+"/"+set.Id.String()+"/runs", &runs)
	if len(runs) != 2 || runs[0].Id != d2.Run.Id {
		t.Errorf("runs = %+v", runs)
	}
	// The team's list (no filter) carries each set's latest run and the
	// completed run of the same kind before it, the trend's baseline (I3).
	var sets []apitypes.EvaluationSet
	env.editor.get(env.evalBase(), &sets)
	if len(sets) != 1 || sets[0].LastRun == nil || sets[0].LastRun.Id != d2.Run.Id || sets[0].PreviousRun == nil || sets[0].PreviousRun.Id != d.Run.Id ||
		sets[0].PreviousRun.Summary.Recall == nil || *sets[0].PreviousRun.Summary.Recall != 0.5 {
		t.Errorf("sets = %+v", sets)
	}
	var one apitypes.EvaluationSet
	env.editor.get(env.evalBase()+"/"+set.Id.String(), &one)
	if one.PreviousRun == nil || one.PreviousRun.Id != d.Run.Id {
		t.Errorf("set previous run = %+v", one.PreviousRun)
	}
	// The question's record: its results in both runs, newest first.
	var detail apitypes.EvaluationQuestionDetail
	env.editor.get(env.evalBase()+"/"+set.Id.String()+"/questions/"+housing.QuestionId.String(), &detail)
	if len(detail.Results) != 2 || detail.Results[0].Status != "pass" || detail.Results[1].Status != "fail" {
		t.Errorf("question results = %+v", detail.Results)
	}
	for _, action := range []string{"evaluation.set_create", "evaluation.question_create", "evaluation.run_start"} {
		if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = $1`, action); n == 0 {
			t.Errorf("no %s audit entry", action)
		}
	}
	// A document the earlier runs found is deleted: the question isn't
	// scored, and the reason is "deleted", not "not in the knowledge base".
	env.deleteDocument(t, "library.txt")
	d3 := env.runEval(t, set, map[string]any{})
	if h := resultFor(d3, qHousing); h.Status != "missing" || h.MissingReason == nil || *h.MissingReason != "deleted" ||
		h.ExpectedItems[0].State != "deleted" || h.ExpectedItems[0].Title == nil || h.ExpectedItems[0].DocumentId != nil || len(h.Hits) == 0 {
		t.Errorf("deleted = %+v", h)
	}
	if s := d3.Run.Summary; s.Missing != 2 || s.NotIndexed != 1 {
		t.Errorf("third run = %+v", s)
	}
}

// deleteDocument deletes a document of the upload source by filename.
func (env *agentEnv) deleteDocument(t *testing.T, filename string) {
	t.Helper()
	var page apitypes.DocumentPage
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	env.owner.get(docs, &page)
	for _, d := range page.Items {
		if d.Filename == filename {
			code, e := env.owner.call("DELETE", docs+"/"+d.Id.String(), nil, nil, nil)
			mustCode(t, "delete document", code, e, 200, "")
			return
		}
	}
	t.Fatalf("no document %s", filename)
}

func TestEvaluationQuestionCheck(t *testing.T) {
	env := newAgentEnv(t)
	check := func(body map[string]any) apitypes.EvaluationQuestionCheck {
		t.Helper()
		var out apitypes.EvaluationQuestionCheck
		code, e := env.editor.call("POST", env.base+"/evaluation-question-check", body, &out, nil)
		mustCode(t, "check", code, e, 200, "")
		return out
	}
	expected := map[string]any{"documentIds": []string{}, "urls": []string{"https://example.edu/fees*"}, "filenames": []string{"parking.md", "grad-housing.pdf"}}
	got := check(map[string]any{"kbId": env.kb.Id, "expected": expected, "mustMention": []string{"parking permits", "Parchment", "the"}})
	states := []string{}
	for _, it := range got.Expected {
		states = append(states, it.Value+"="+string(it.State))
	}
	if strings.Join(states, ",") != "https://example.edu/fees*=not_indexed,parking.md=indexed,grad-housing.pdf=not_indexed" {
		t.Errorf("expected = %v", states)
	}
	// Stemmed words in order; a phrase of stopwords only has nothing to look for.
	if m := got.MustMention; len(m) != 3 || !m[0].Found || m[1].Found || !m[2].Found {
		t.Errorf("must mention = %+v", m)
	}
	// A set's knowledge bases, and an agent's before it has a set.
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Checked"})
	if got := check(map[string]any{"setId": set.Id, "expected": expected}); len(got.Expected) != 3 || got.Expected[1].State != "indexed" {
		t.Errorf("set check = %+v", got)
	}
	ag := env.publishAgent(t, "Checker", env.agentConfig(env.kb.Id.String()))
	if got := check(map[string]any{"agentId": ag.Id, "expected": expected, "mustMention": []string{"Parchment"}}); got.MustMention[0].Found {
		t.Errorf("agent check = %+v", got)
	}
	code, e := env.editor.call("POST", env.base+"/evaluation-question-check", map[string]any{"setId": set.Id, "kbId": env.kb.Id, "expected": expected}, nil, nil)
	mustCode(t, "two targets", code, e, 400, "invalid_target")
	if code, _ := env.member.call("POST", env.base+"/evaluation-question-check", map[string]any{"kbId": env.kb.Id, "expected": expected}, nil, nil); code != 404 {
		t.Errorf("a member's check = %d", code)
	}
	// An import says which usable rows match nothing yet.
	var preview apitypes.EvaluationImportResult
	csv := "question,expected\n" + qParking + ",parking.md\n" + qHousing + ",grad-housing.pdf\n"
	code, e = env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/questions/import", map[string]any{"format": "csv", "content": csv, "dryRun": true}, &preview, nil)
	mustCode(t, "import preview", code, e, 200, "")
	if preview.Usable != 2 || len(preview.Warnings) != 1 || preview.Warnings[0].Line != 3 ||
		preview.Warnings[0].Message != "No document in "+env.kb.Name+" matches grad-housing.pdf yet. It'll count once one is added." {
		t.Errorf("import warnings = %+v", preview.Warnings)
	}
}

func TestEvaluationImportExport(t *testing.T) {
	env := newAgentEnv(t)
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Imported"})
	path := env.evalBase() + "/" + set.Id.String()
	csv := "question,expected,must_mention\n" +
		qParking + ",parking.md,permit | decal\n" +
		"No expected document,,\n" +
		qHousing + ",https://example.edu/housing*|housing.md,\n" +
		qParking + ",parking.md,\n"
	var preview apitypes.EvaluationImportResult
	code, e := env.editor.call("POST", path+"/questions/import", map[string]any{"format": "csv", "content": csv, "dryRun": true}, &preview, nil)
	mustCode(t, "dry run", code, e, 200, "")
	if preview.Rows != 4 || preview.Usable != 2 || preview.Added != 0 || len(preview.Problems) != 2 || preview.Problems[0].Line != 3 ||
		preview.Problems[1].Line != 5 || preview.Max == nil || *preview.Max != 500 {
		t.Fatalf("preview = %+v", preview)
	}
	var qs []apitypes.EvaluationQuestion
	if env.editor.get(path+"/questions", &qs); len(qs) != 0 {
		t.Fatalf("a dry run added %d questions", len(qs))
	}
	var res apitypes.EvaluationImportResult
	code, e = env.editor.call("POST", path+"/questions/import", map[string]any{"format": "csv", "content": csv}, &res, nil)
	mustCode(t, "import", code, e, 200, "")
	if res.Added != 2 {
		t.Fatalf("import = %+v", res)
	}
	jsonl := `{"id":"q1","question":"Where is the library?","urls":["https://example.edu/library/"]}` + "\n" + `{"id":"q2","question":"","urls":[]}` + "\n"
	code, e = env.editor.call("POST", path+"/questions/import", map[string]any{"format": "jsonl", "content": jsonl}, &res, nil)
	mustCode(t, "jsonl", code, e, 200, "")
	if res.Added != 1 || len(res.Problems) != 1 || res.Current != 2 {
		t.Fatalf("jsonl = %+v", res)
	}
	env.editor.get(path+"/questions", &qs)
	if len(qs) != 3 || strings.Join(qs[0].MustMention, ",") != "permit,decal" || len(qs[1].Expected.Urls) != 1 {
		t.Fatalf("questions = %+v", qs)
	}
	code, raw := env.editor.raw("GET", path+"/questions.csv", nil, nil)
	body := string(raw)
	if code != 200 || !strings.HasPrefix(body, "question,expected,must_mention,note\n") || !strings.Contains(body, qParking+",parking.md,permit | decal,") ||
		!strings.Contains(body, "https://example.edu/library/") {
		t.Fatalf("export = %d %s", code, body)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'evaluation.questions_import' AND metadata->>'added' = '2'`); n != 1 {
		t.Errorf("import audit entries = %d", n)
	}
}

func TestEvaluationAnswerRun(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	set := env.newEvalSet(t, map[string]any{"agentId": ag.Id, "name": "Answers"})
	if set.Target.Type != "agent" || set.Target.Name != "Helper" {
		t.Fatalf("set = %+v", set)
	}
	// The picker searches the agent's knowledge bases, with or without a set.
	var docs []apitypes.EvaluationDocument
	env.editor.get(env.base+"/evaluation-documents?agentId="+ag.Id.String()+"&q=park", &docs)
	if len(docs) != 1 || docs[0].Filename != "parking.md" {
		t.Fatalf("agent documents = %+v", docs)
	}
	env.addQuestion(t, set, qParking, map[string]any{"filenames": []string{"parking.md"}}, "parking")
	env.addQuestion(t, set, qHousing, map[string]any{"filenames": []string{"housing.md"}}, "helicopter")

	// A retrieval check of an agent set: the agent's search.
	d := env.runEval(t, set, map[string]any{"kind": "retrieval", "version": "published"})
	if d.Run.Status != "completed" || d.Run.Summary.Passed != 2 || d.Run.Config.AgentVersion == nil || *d.Run.Config.AgentVersion != 1 {
		t.Fatalf("agent retrieval run = %+v", d.Run)
	}
	d = env.runEval(t, set, map[string]any{"kind": "answer"})
	if d.Run.Status != "completed" || d.Run.Kind != "answer" || d.Run.Config.Version == nil || *d.Run.Config.Version != "draft" {
		t.Fatalf("answer run = %+v", d.Run)
	}
	parking, housing := resultFor(d, qParking), resultFor(d, qHousing)
	if parking.Status != "pass" || parking.Answer == nil || *parking.Answer == "" || parking.Scores == nil || !parking.Scores.Cited ||
		len(parking.Scores.Mentions) != 1 || !parking.Scores.Mentions[0].Found {
		t.Errorf("parking = %+v scores %+v", parking, parking.Scores)
	}
	// The answer's citations, one per marker number, with the cited passage.
	if len(parking.Hits) == 0 {
		t.Errorf("parking cites nothing")
	}
	for i, h := range parking.Hits {
		if h.N == nil || *h.N < 1 || h.Snippet == nil || *h.Snippet == "" || h.Rank != i+1 {
			t.Errorf("citation %d = %+v", i, h)
		}
	}
	if housing.Status != "fail" || housing.Scores == nil || housing.Scores.Mentions[0].Found {
		t.Errorf("housing = %+v", housing)
	}
	if s := d.Run.Summary; s.PassRate == nil || *s.PassRate != 0.5 || s.Recall != nil {
		t.Errorf("summary = %+v", s)
	}
	// Chat usage tagged as evaluation; no conversation was written.
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'chat_tokens_in' AND metadata->>'source' = 'evaluation' AND agent_id = $1`, ag.Id); n != 2 {
		t.Errorf("evaluation chat usage = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversations WHERE agent_id = $1`, ag.Id); n != 0 {
		t.Errorf("conversations = %d", n)
	}
	// Full-answer checks need an agent.
	kbSet := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "KB only"})
	env.addQuestion(t, kbSet, qParking, map[string]any{"filenames": []string{"parking.md"}})
	code, e := env.editor.call("POST", env.evalBase()+"/"+kbSet.Id.String()+"/runs", map[string]any{"kind": "answer"}, nil, nil)
	mustCode(t, "answer on a KB set", code, e, 400, "invalid_kind")
	// Deleting the agent deletes its sets.
	code, e = env.tadmin.call("DELETE", env.base+"/agents/"+ag.Id.String(), nil, nil, nil)
	mustCode(t, "delete agent", code, e, 200, "")
	if code := env.editor.get(env.evalBase()+"/"+set.Id.String(), nil); code != 404 {
		t.Errorf("a deleted agent's set = %d", code)
	}
}

func TestEvaluationAccessAndSwitch(t *testing.T) {
	env := newAgentEnv(t)
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Private"})
	path := env.evalBase() + "/" + set.Id.String()
	for _, s := range []*session{env.member, env.admin, env.auditor} {
		if code, _ := s.call("GET", env.evalBase(), nil, nil, nil); code != 404 {
			t.Errorf("list as %s = %d, want 404", s.me.User.Email, code)
		}
		if code, _ := s.call("GET", path, nil, nil, nil); code != 404 {
			t.Errorf("get as %s = %d, want 404", s.me.User.Email, code)
		}
	}
	for _, s := range []*session{env.editor, env.tadmin, env.owner} {
		if code := s.get(path, nil); code != 200 {
			t.Errorf("get as %s = %d", s.me.User.Email, code)
		}
	}
	var me apitypes.Me
	if env.editor.get("/v1/me", &me); me.Capabilities.Evaluations == nil || !*me.Capabilities.Evaluations {
		t.Fatalf("capabilities = %+v", me.Capabilities)
	}
	// Off: the API is gone for everyone, and the palette doesn't find sets.
	var st apitypes.EvaluationSettings
	env.admin.get("/v1/admin/settings/evaluations", &st)
	code, e := env.editor.call("PUT", "/v1/admin/settings/evaluations", map[string]any{"enabled": false}, nil, ifMatch(st.Revision))
	mustCode(t, "editor turns it off", code, e, 403, "")
	code, e = env.admin.call("PUT", "/v1/admin/settings/evaluations", map[string]any{"enabled": false}, &st, ifMatch(st.Revision))
	mustCode(t, "admin turns it off", code, e, 200, "")
	if code, _ := env.editor.call("GET", path, nil, nil, nil); code != 404 {
		t.Errorf("off: get = %d", code)
	}
	if env.editor.get("/v1/me", &me); me.Capabilities.Evaluations == nil || *me.Capabilities.Evaluations {
		t.Errorf("off: capabilities = %+v", me.Capabilities)
	}
	var found []apitypes.SearchResult
	env.editor.get("/v1/search?q=Private", &found)
	if len(found) != 0 {
		t.Errorf("off: search = %+v", found)
	}
	code, e = env.admin.call("PUT", "/v1/admin/settings/evaluations", map[string]any{"enabled": true}, &st, ifMatch(st.Revision))
	mustCode(t, "admin turns it on", code, e, 200, "")
	env.editor.get("/v1/search?q=Private", &found)
	if len(found) != 1 || found[0].Type != "evaluation_set" || found[0].Id != set.Id {
		t.Errorf("search = %+v", found)
	}
	if env.member.get("/v1/search?q=Private", &found); len(found) != 0 {
		t.Errorf("member search = %+v", found)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.evaluations'`); n != 2 {
		t.Errorf("switch audit entries = %d", n)
	}
}

func TestEvaluationLimits(t *testing.T) {
	env := newAgentEnv(t)
	setTeamLimits(t, env.admin, env.team, map[string]any{"evaluation_sets": 1, "evaluation_questions_per_set": 2})
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "One"})
	code, e := env.editor.call("POST", env.evalBase(), map[string]any{"kbId": env.kb.Id, "name": "Two"}, nil, nil)
	mustCode(t, "second set", code, e, 409, "limit_reached")
	env.addQuestion(t, set, "First?", map[string]any{"filenames": []string{"parking.md"}})
	csv := "Second?,parking.md\nThird?,housing.md\n"
	code, e = env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/questions/import", map[string]any{"format": "csv", "content": csv}, nil, nil)
	mustCode(t, "import past the limit", code, e, 409, "limit_reached")
	env.addQuestion(t, set, "Second?", map[string]any{"filenames": []string{"parking.md"}})
	code, e = env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/questions",
		map[string]any{"question": "Third?", "expected": map[string]any{"filenames": []string{"a.md"}}}, nil, nil)
	mustCode(t, "third question", code, e, 409, "limit_reached")
	if l := teamLimit(t, env.owner, env.team, "evaluation_sets"); l.Used == nil || *l.Used != 1 {
		t.Errorf("evaluation_sets usage = %+v", l)
	}
	// A daily query cap that is used up stops a run.
	setTeamLimits(t, env.admin, env.team, map[string]any{"queries_per_day": 0})
	d := env.runEval(t, set, map[string]any{})
	if d.Run.Status != "failed" || !strings.Contains(strings.ToLower(d.Run.Error), "queries") || len(d.Results) != 0 {
		t.Errorf("run over the limit = %+v", d.Run)
	}
}

func TestEvaluationAutomaticRuns(t *testing.T) {
	env := newAgentEnv(t)
	ctx := context.Background()
	ag := env.publishAgent(t, "Helper", env.agentConfig(env.kb.Id.String()))
	set := env.newEvalSet(t, map[string]any{"agentId": ag.Id, "name": "Nightly", "autoRun": true})
	env.addQuestion(t, set, qParking, map[string]any{"filenames": []string{"parking.md"}})
	// Passes while all three documents come back, not with one result per search.
	env.addQuestion(t, set, qHousing, map[string]any{"filenames": []string{"library.txt"}})
	d := env.runEval(t, set, map[string]any{"version": "published"}) // the baseline
	if d.Run.Summary.Passed != 2 {
		t.Fatalf("baseline = %+v", d.Run)
	}
	// Publishing a version that returns one result per search: an automatic
	// run of the published version; the housing question newly fails.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["kbs"] = []map[string]any{{"kbId": env.kb.Id, "topK": 1}}
	var cur apitypes.Agent
	env.editor.get(env.base+"/agents/"+ag.Id.String(), &cur)
	code, e := env.editor.call("PATCH", env.base+"/agents/"+ag.Id.String(), map[string]any{"config": cfg}, nil, ifMatch(cur.Revision))
	mustCode(t, "update draft", code, e, 200, "")
	code, e = env.editor.call("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{"note": "narrow"}, nil, nil)
	mustCode(t, "publish", code, e, 201, "")
	var runs []apitypes.EvaluationRun
	eventually(t, "automatic run", func() bool {
		env.editor.get(env.evalBase()+"/"+set.Id.String()+"/runs", &runs)
		return len(runs) == 2 && runs[0].Status == "completed"
	})
	auto := runs[0]
	if auto.Trigger != "agent_published" || auto.StartedBy != nil || auto.Config.AgentVersion == nil || *auto.Config.AgentVersion != 2 ||
		auto.Summary.Passed != 1 || auto.Summary.Failed != 1 {
		t.Fatalf("automatic run = %+v", auto)
	}
	// Editors (and admins and owners) hear about it; members don't.
	var page apitypes.NotificationPage
	eventually(t, "regression notification", func() bool {
		env.tadmin.get("/v1/notifications", &page)
		return len(page.Items) > 0 && page.Items[0].Type == "evaluation.regression"
	})
	if !strings.Contains(page.Items[0].Body, "1 question that passed before now fails") {
		t.Errorf("notification = %+v", page.Items[0])
	}
	env.member.get("/v1/notifications", &page)
	for _, n := range page.Items {
		if n.Type == "evaluation.regression" {
			t.Errorf("a member was notified: %+v", n)
		}
	}

	// A profile switch queues the knowledge base's sets (the hook runs in the switch transaction).
	kbSet := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Switch", "autoRun": true})
	env.addQuestion(t, kbSet, qParking, map[string]any{"filenames": []string{"parking.md"}})
	err := store.InTx(ctx, env.app.Pool, func(_ *dbgen.Queries, tx pgx.Tx) error {
		return env.app.Svc.ProfileMigrations.OnSwitched(ctx, tx, env.kb.Id)
	})
	if err != nil {
		t.Fatal(err)
	}
	env.editor.get(env.evalBase()+"/"+kbSet.Id.String()+"/runs", &runs)
	if len(runs) != 1 || runs[0].Trigger != "profile_switched" {
		t.Fatalf("switch runs = %+v", runs)
	}
	env.waitEval(t, kbSet, runs[0].Id.String())

	// Nightly: only sets whose documents changed, once a night.
	n, err := env.app.Svc.Evaluations.Nightly(ctx, time.Now())
	if err != nil || n != 2 {
		t.Fatalf("nightly = %d %v", n, err)
	}
	for _, s := range []apitypes.EvaluationSet{set, kbSet} {
		eventually(t, "nightly run", func() bool {
			env.editor.get(env.evalBase()+"/"+s.Id.String()+"/runs", &runs)
			return runs[0].Trigger == "nightly" && runs[0].Status == "completed"
		})
	}
	if n, err := env.app.Svc.Evaluations.Nightly(ctx, time.Now()); err != nil || n != 0 {
		t.Errorf("second nightly = %d %v", n, err)
	}
	if n, err := env.app.Svc.Evaluations.Nightly(ctx, time.Now().Add(48*time.Hour)); err != nil || n != 0 {
		t.Errorf("nightly without changes = %d %v", n, err)
	}
}

func TestEvaluationRetentionAndCancel(t *testing.T) {
	env := newAgentEnv(t)
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Old runs"})
	env.addQuestion(t, set, qParking, map[string]any{"filenames": []string{"parking.md"}})
	d := env.runEval(t, set, map[string]any{})
	code, e := env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/runs/"+d.Run.Id.String()+"/cancel", nil, nil, nil)
	mustCode(t, "cancel an ended run", code, e, 409, "run_not_running")
	// A queued run (no worker picks it up in time is not guaranteed, so
	// cancel straight after starting and accept either outcome's rules).
	var run apitypes.EvaluationRun
	code, e = env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/runs", map[string]any{}, &run, nil)
	mustCode(t, "start", code, e, 201, "")
	code, e = env.editor.call("POST", env.evalBase()+"/"+set.Id.String()+"/runs/"+run.Id.String()+"/cancel", nil, &run, nil)
	if code == 200 && run.Status != "cancelled" {
		t.Errorf("cancelled run = %+v", run)
	} else if code != 200 && e != "run_not_running" {
		t.Errorf("cancel = %d %s", code, e)
	}
	env.waitEval(t, set, run.Id.String())
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'evaluation.run_cancel'`); code == 200 && n != 1 {
		t.Errorf("cancel audit entries = %d", n)
	}

	// Runs older than 180 days go at the next retention run, with their results.
	if _, err := env.app.Pool.Exec(context.Background(), `UPDATE eval_runs SET created_at = now() - interval '181 days' WHERE id = $1`, d.Run.Id); err != nil {
		t.Fatal(err)
	}
	var rr apitypes.RetentionRun
	code, e = env.admin.call("POST", "/v1/admin/retention/runs", map[string]any{"kinds": []string{"evaluation_runs"}}, &rr, nil)
	mustCode(t, "retention run", code, e, 202, "")
	done := waitRun(t, env.admin, rr.Id)
	if r := runResult(done, "evaluation_runs"); r.Deleted != 1 {
		t.Errorf("retention = %+v", done)
	}
	if n := env.scalar(t, `SELECT count(*) FROM eval_results WHERE run_id = $1`, d.Run.Id); n != 0 {
		t.Errorf("results left = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM eval_runs WHERE set_id = $1`, set.Id); n != 1 {
		t.Errorf("runs left = %d", n)
	}
}
