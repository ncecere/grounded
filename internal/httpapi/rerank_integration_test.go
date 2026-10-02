package httpapi_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// Cross-encoder reranking (docs/v0.4.0.md §3) through the API, with the
// fake gateway's /rerank: the fake scores a passage by the query words it
// contains, and the markers pin a passage first or last.

var rerankDocs = []upload{
	{"fee-plain.txt", []byte("Transcript fee: an official transcript costs ten dollars per copy.\n")},
	{"fee-top.txt", []byte(testutil.FakeRerankTop + " Order transcripts online from the registrar.\n")},
	{"fee-bottom.txt", []byte(testutil.FakeRerankBottom + " transcript fee transcript fee transcript fee.\n")},
}

type rerankEnv struct {
	*agentEnv
	reranker apitypes.Model
}

func newRerankEnv(t *testing.T) *rerankEnv {
	t.Helper()
	env := &rerankEnv{agentEnv: newAgentEnv(t)}
	code, e := env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": env.conn.Id, "key": "reranker", "upstreamModel": testutil.FakeRerankModel, "displayName": "Reranker",
		"kind": "rerank", "maxClassification": "sensitive", "maxInputTokens": 512,
		"compat": map[string]any{"supportsRerankTopN": true, "rerankDocumentsField": "documents", "supportsToolChoice": true},
	}, &env.reranker, nil)
	mustCode(t, "rerank model", code, e, 201, "")
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	env.owner.uploadFiles(docs, rerankDocs, "")
	env.owner.waitForDocuments(t, docs)
	return env
}

// putRerank saves the platform rerank settings.
func (env *rerankEnv) putRerank(t *testing.T, model any, timeLimitMs int) apitypes.RerankSettings {
	t.Helper()
	var cur, out apitypes.RerankSettings
	env.admin.get("/v1/admin/rerank", &cur)
	code, e := env.admin.call("PUT", "/v1/admin/rerank", map[string]any{"modelId": model, "candidates": 40, "timeLimitMs": timeLimitMs}, &out, ifMatch(cur.Revision))
	mustCode(t, "put rerank settings", code, e, 200, "")
	return out
}

func TestRerankSettingsAndModel(t *testing.T) {
	env := newRerankEnv(t)
	admin := env.admin
	r := env.reranker
	if r.Compat.SupportsRerankTopN == nil || r.Compat.RerankDocumentsField == nil || r.MaxInputTokens == nil {
		t.Errorf("compat = %+v", r.Compat)
	}
	code, e := admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "bad", "upstreamModel": "x",
		"displayName": "Bad", "kind": "rerank", "maxClassification": "open", "compat": map[string]any{"rerankDocumentsField": "docs"}}, nil, nil)
	mustCode(t, "bad compat", code, e, 400, "invalid_compat")

	// Test: the passage that answers scores higher; stored as health.
	var mt apitypes.ModelTestResult
	code, e = admin.call("POST", "/v1/admin/models/"+r.Id.String()+"/test", nil, &mt, nil)
	mustCode(t, "test rerank model", code, e, 200, "")
	if !mt.Ok || mt.Rerank == nil || mt.Rerank.Relevant <= mt.Rerank.Irrelevant || mt.Rerank.Query == "" {
		t.Fatalf("model test = %+v", mt)
	}
	if n := env.scalar(t, `SELECT count(*) FROM health_checks WHERE subject_id = $1 AND status = 'healthy'`, r.Id); n != 1 {
		t.Errorf("stored health = %d", n)
	}
	env.proxy.FailRerankWith(http.StatusBadGateway)
	admin.call("POST", "/v1/admin/models/"+r.Id.String()+"/test", nil, &mt, nil)
	env.proxy.FailRerankWith(0)
	if mt.Ok || mt.Error == nil {
		t.Errorf("failing test = %+v", mt)
	}

	// Settings: defaults until saved; If-Match; only rerank models; audited.
	var st apitypes.RerankSettings
	if code := env.auditor.get("/v1/admin/rerank", &st); code != 200 || st.Revision != 1 || st.ModelId != nil || st.Candidates != 40 || st.TimeLimitMs != 2000 {
		t.Fatalf("defaults = %d %+v", code, st)
	}
	body := map[string]any{"modelId": r.Id, "candidates": 40, "timeLimitMs": 2000}
	code, e = admin.call("PUT", "/v1/admin/rerank", body, nil, nil)
	mustCode(t, "no If-Match", code, e, 428, "revision_required")
	code, e = env.auditor.call("PUT", "/v1/admin/rerank", body, nil, ifMatch(1))
	mustCode(t, "auditor writes", code, e, 403, "forbidden")
	code, e = admin.call("PUT", "/v1/admin/rerank", map[string]any{"modelId": env.chat.Id, "candidates": 40, "timeLimitMs": 2000}, nil, ifMatch(1))
	mustCode(t, "chat model", code, e, 400, "invalid_model")
	code, e = admin.call("PUT", "/v1/admin/rerank", map[string]any{"modelId": r.Id, "candidates": 99, "timeLimitMs": 2000}, nil, ifMatch(1))
	mustCode(t, "too many candidates", code, e, 400, "invalid_settings")
	// Every problem is listed (adm-5), in the message and by field.
	var bad struct {
		Error struct {
			Message string `json:"message"`
			Details struct {
				Problems []struct{ Field, Problem string } `json:"problems"`
			} `json:"details"`
		} `json:"error"`
	}
	_, raw := admin.raw("PUT", "/v1/admin/rerank", map[string]any{"modelId": r.Id, "candidates": 99, "timeLimitMs": 100}, ifMatch(1))
	if json.Unmarshal(raw, &bad); len(bad.Error.Details.Problems) != 2 || !strings.Contains(bad.Error.Message, "time limit") || strings.Contains(bad.Error.Message, "candidates:") {
		t.Errorf("both problems = %s", raw)
	}
	var status apitypes.RerankStatus
	if env.member.get("/v1/rerank/status", &status); status.Available || status.DefaultTopN != 6 {
		t.Errorf("status before = %+v", status)
	}
	if saved := env.putRerank(t, r.Id, 2000); saved.Revision != 2 || saved.ModelId == nil || *saved.ModelId != r.Id {
		t.Fatalf("saved = %+v", saved)
	}
	if env.member.get("/v1/rerank/status", &status); !status.Available {
		t.Error("not available once set")
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.rerank_settings_update'`); n != 1 {
		t.Errorf("audits = %d", n)
	}
	// The audit entry names the model and each setting (adm-4).
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.rerank_settings_update'
		AND after_state->>'model' = 'Reranker' AND (after_state->>'timeLimitMs')::int = 2000 AND after_state->>'candidates' = '40'
		AND before_state->'model' IS NULL`); n != 1 {
		t.Errorf("audit snapshot: %d", n)
	}
	// Saving the same settings writes nothing: no new revision (saved answers stay reachable), no audit entry (adm-5).
	if same := env.putRerank(t, r.Id, 2000); same.Revision != 2 {
		t.Errorf("unchanged save = revision %d", same.Revision)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.rerank_settings_update'`); n != 1 {
		t.Errorf("audits after an unchanged save = %d", n)
	}
	var usage apitypes.CatalogUsage
	admin.get("/v1/admin/catalog-usage", &usage)
	for _, u := range usage.Models {
		if u.ModelId == r.Id && !u.Rerank {
			t.Error("catalog usage doesn't show reranking")
		}
	}
	code, e = admin.call("DELETE", "/v1/admin/models/"+r.Id.String(), nil, nil, nil)
	mustCode(t, "delete model in use", code, e, 409, "model_in_use")

	// Rerank models are priced per million tokens and per request.
	code, e = admin.call("POST", "/v1/admin/models/"+r.Id.String()+"/prices", map[string]any{"effectiveFrom": time.Now().Format(time.DateOnly),
		"prices": []any{map[string]any{"unit": "rerank_tokens", "price": "0.02"}, map[string]any{"unit": "rerank_requests", "price": "0.001"}}}, nil, nil)
	mustCode(t, "rerank prices", code, e, 201, "")

	// A disabled model isn't used.
	var m apitypes.Model
	admin.get("/v1/admin/models/"+r.Id.String(), &m)
	code, e = admin.call("PATCH", "/v1/admin/models/"+r.Id.String(), map[string]any{"enabled": false}, nil, ifMatch(m.Revision))
	mustCode(t, "disable", code, e, 200, "")
	if env.member.get("/v1/rerank/status", &status); status.Available {
		t.Error("available with a disabled model")
	}
}

// TestRerankRetrieve: Try it and the REST retrieval rerank once a model is
// set, show the scores, meter the call, and keep the fusion order when the
// call fails or is too slow.
func TestRerankRetrieve(t *testing.T) {
	env := newRerankEnv(t)
	path := env.base + "/kbs/" + env.kb.Id.String() + "/retrieve"
	q := map[string]any{"query": "transcript fee", "topK": 2}
	var plain apitypes.RetrieveResult
	code, e := env.member.call("POST", path, q, &plain, nil)
	mustCode(t, "without a rerank model", code, e, 200, "")
	if plain.Rerank != nil || len(plain.Hits) != 2 || plain.Hits[0].RerankScore != nil || len(env.proxy.RerankRequests()) != 0 {
		t.Fatalf("plain = %+v", plain)
	}

	env.putRerank(t, env.reranker.Id, 2000)
	var res apitypes.RetrieveResult
	code, e = env.member.call("POST", path, q, &res, nil)
	mustCode(t, "reranked", code, e, 200, "")
	if res.Rerank == nil || res.Rerank.Status != "ok" || res.Rerank.Candidates < 3 || len(res.Hits) != 2 {
		t.Fatalf("rerank = %+v, %d hits", res.Rerank, len(res.Hits))
	}
	if !strings.HasPrefix(res.Hits[0].Content, testutil.FakeRerankTop) || res.Hits[0].RerankScore == nil || *res.Hits[0].RerankScore != 1 ||
		!strings.HasPrefix(res.Hits[1].Content, "Transcript fee") || res.Hits[1].RerankScore == nil {
		t.Errorf("hits = %+v", res.Hits)
	}
	reqs := env.proxy.RerankRequests()
	if len(reqs) != 1 || reqs[0].TopN == nil || *reqs[0].TopN != 2 || len(reqs[0].Documents) != res.Rerank.Candidates || reqs[0].Query != "transcript fee" {
		t.Errorf("rerank request = %+v", reqs)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'rerank_requests' AND kb_id = $1 AND model_id = $2`, env.kb.Id, env.reranker.Id); n != 1 {
		t.Errorf("rerank request usage = %d", n)
	}
	if n := env.scalar(t, `SELECT coalesce(sum(quantity), 0) FROM usage_events WHERE kind = 'rerank_tokens' AND kb_id = $1`, env.kb.Id); n <= 0 {
		t.Error("no rerank token usage")
	}

	// rerank: false compares with the fusion order.
	res = apitypes.RetrieveResult{}
	code, e = env.member.call("POST", path, map[string]any{"query": "transcript fee", "topK": 2, "rerank": false}, &res, nil)
	mustCode(t, "rerank off", code, e, 200, "")
	if res.Rerank != nil || res.Hits[0].RerankScore != nil || len(env.proxy.RerankRequests()) != 1 {
		t.Errorf("rerank off = %+v", res)
	}

	// Fail open: an error or a timeout keeps the fusion order.
	env.proxy.FailRerankWith(http.StatusInternalServerError)
	res = apitypes.RetrieveResult{}
	code, e = env.member.call("POST", path, q, &res, nil)
	env.proxy.FailRerankWith(0)
	mustCode(t, "rerank error", code, e, 200, "")
	if res.Rerank == nil || res.Rerank.Status != "error" || len(res.Hits) != 2 || res.Hits[0].ChunkId != plain.Hits[0].ChunkId || res.Hits[0].RerankScore != nil {
		t.Errorf("error = %+v %+v", res.Rerank, res.Hits)
	}
	env.putRerank(t, env.reranker.Id, 200)
	env.proxy.SetRerankDelay(2 * time.Second)
	start := time.Now()
	res = apitypes.RetrieveResult{}
	code, e = env.member.call("POST", path, q, &res, nil)
	env.proxy.SetRerankDelay(0)
	mustCode(t, "rerank timeout", code, e, 200, "")
	if res.Rerank == nil || res.Rerank.Status != "timeout" || len(res.Hits) != 2 || time.Since(start) > 1500*time.Millisecond {
		t.Errorf("timeout = %+v after %v", res.Rerank, time.Since(start))
	}
}

// TestRerankInChatAndEvaluations: agents rerank by default and keep their
// rerankTopN; an agent can turn it off; evaluation runs record whether
// they reranked and can run without it.
func TestRerankInChatAndEvaluations(t *testing.T) {
	env := newRerankEnv(t)
	env.putRerank(t, env.reranker.Id, 2000)
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["rerankTopN"] = 2
	ag := env.publishAgent(t, "Fees", cfg)
	if ag.Draft.Rerank == nil || !*ag.Draft.Rerank || ag.Draft.RerankTopN == nil || *ag.Draft.RerankTopN != 2 {
		t.Fatalf("config = %+v", ag.Draft)
	}
	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "transcript fee"})
	mustCode(t, "chat", code, e, 200, "")
	var ret apitypes.ChatEventRetrieval
	evs.one(t, "retrieval", &ret)
	if len(ret.Hits) != 2 || !strings.HasPrefix(ret.Hits[0].Snippet, testutil.FakeRerankTop) {
		t.Fatalf("hits = %+v", ret.Hits)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'rerank_requests' AND agent_id = $1`, ag.Id); n != 1 {
		t.Errorf("chat rerank usage = %d", n)
	}
	var st apitypes.RerankSettings
	if env.admin.get("/v1/admin/rerank", &st); st.Agents != 1 {
		t.Errorf("agents reranking = %d", st.Agents)
	}

	// Turned off, the agent searches as before.
	cfg = env.agentConfig(env.kb.Id.String())
	cfg["rerank"] = false
	env.publishAgent(t, "Plain", cfg)
	before := len(env.proxy.RerankRequests())
	code, evs, e = env.member.stream(env.chatPath("plain"), map[string]any{"message": "transcript fee"})
	mustCode(t, "chat without reranking", code, e, 200, "")
	evs.one(t, "retrieval", &ret)
	if len(env.proxy.RerankRequests()) != before || len(ret.Hits) != 4 {
		t.Errorf("reranked with rerank off: %d hits", len(ret.Hits))
	}
	code, raw := env.editor.raw("POST", env.base+"/agents", map[string]any{"name": "Bad", "config": map[string]any{"rerankTopN": 21}}, nil)
	if pb := decodeProblems(t, raw); code != 400 || !hasField(pb.Error.Details.Problems, "rerankTopN") {
		t.Errorf("invalid rerankTopN = %d %s", code, raw)
	}

	// With SystemOne judging, only the reranked best few are judged.
	so := &systemOneEnv{agentEnv: env.agentEnv}
	code, e = env.admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "jev", "upstreamModel": "jev-latest",
		"displayName": "Judge", "kind": "systemone", "maxClassification": "sensitive"}, &so.judge, nil)
	mustCode(t, "SystemOne model", code, e, 201, "")
	so.putSettings(t, nil)
	code, evs, e = env.member.stream(env.chatPath("fees"), map[string]any{"message": "transcript fee"})
	mustCode(t, "judged chat", code, e, 200, "")
	evs.one(t, "retrieval", &ret)
	if ret.Judging == nil || ret.Judging.Judged != 2 {
		t.Errorf("judged = %+v", ret.Judging)
	}

	// Evaluations: on by default, off to compare; agent sets keep rerankTopN.
	set := env.newEvalSet(t, map[string]any{"kbId": env.kb.Id, "name": "Fees"})
	env.addQuestion(t, set, "transcript fee", map[string]any{"filenames": []string{"fee-top.txt"}})
	d := env.runEval(t, set, map[string]any{"kind": "retrieval"})
	if d.Run.Status != "completed" || d.Run.Config.Rerank == nil || *d.Run.Config.Rerank != "on" {
		t.Fatalf("reranked run = %+v", d.Run)
	}
	if r := resultFor(d, "transcript fee"); r.Rank == nil || *r.Rank != 1 {
		t.Errorf("reranked rank = %+v", r)
	}
	d = env.runEval(t, set, map[string]any{"kind": "retrieval", "rerank": false})
	if d.Run.Status != "completed" || d.Run.Config.Rerank == nil || *d.Run.Config.Rerank != "off" {
		t.Errorf("run without reranking = %+v", d.Run.Config)
	}
	agentSet := env.newEvalSet(t, map[string]any{"agentId": ag.Id, "name": "Agent fees"})
	env.addQuestion(t, agentSet, "transcript fee", map[string]any{"filenames": []string{"fee-top.txt"}})
	d = env.runEval(t, agentSet, map[string]any{"kind": "retrieval"})
	if d.Run.Config.Rerank == nil || *d.Run.Config.Rerank != "on" || d.Run.Config.ResultsPerSearch != 2 {
		t.Errorf("agent run = %+v", d.Run.Config)
	}
	// Turned off for the run, the agent set is scored at the same k (its
	// rerankTopN, in the fusion order), not its knowledge bases' top-k.
	d = env.runEval(t, agentSet, map[string]any{"kind": "retrieval", "rerank": false})
	r := resultFor(d, "transcript fee")
	if d.Run.Config.Rerank == nil || *d.Run.Config.Rerank != "off" || d.Run.Config.ResultsPerSearch != 2 || r.K == nil || *r.K != 2 || len(r.Hits) > 2 {
		t.Errorf("agent run without reranking = %+v, result k %v, %d hits", d.Run.Config, r.K, len(r.Hits))
	}
}
