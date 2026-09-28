package httpapi_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/moderation"
)

const stormDoc = "UNSAFE-VIOLENCE storm damage report from the weather station.\n"

// moderationEnv is an agent environment with a chat_classifier moderation
// model on the fake gateway and a document whose answers fail moderation.
type moderationEnv struct {
	*agentEnv
	classifier apitypes.Model
}

func newModerationEnv(t *testing.T) *moderationEnv {
	t.Helper()
	env := &moderationEnv{agentEnv: newAgentEnv(t)}
	code, e := env.admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": env.conn.Id, "key": "mod-classifier", "upstreamModel": "chat-tools", "displayName": "Classifier",
		"kind": "moderation", "maxClassification": "sensitive", "moderationProvider": "chat_classifier",
	}, &env.classifier, nil)
	mustCode(t, "classifier model", code, e, 201, "")
	docs := env.base + "/sources/" + env.upload.Id.String() + "/documents"
	env.owner.uploadFiles(docs, []upload{{"storm.txt", []byte(stormDoc)}}, "")
	env.owner.waitForDocuments(t, docs)
	return env
}

func rule(action string, threshold float64) map[string]any {
	return map[string]any{"action": action, "threshold": threshold}
}

func rules(in, out map[string]any) map[string]any { return map[string]any{"input": in, "output": out} }

// putPolicy saves a policy as the platform admin and returns it.
func (env *moderationEnv) putPolicy(t *testing.T, audience string, body map[string]any) apitypes.ModerationPolicy {
	t.Helper()
	var cur, out apitypes.ModerationPolicy
	env.admin.get("/v1/admin/moderation/policies/"+audience, &cur)
	code, e := env.admin.call("PUT", "/v1/admin/moderation/policies/"+audience, body, &out, ifMatch(cur.Revision))
	mustCode(t, "put policy "+audience, code, e, 200, "")
	return out
}

func (env *moderationEnv) teamPolicy(extra map[string]any) map[string]any {
	body := map[string]any{
		"modelId": env.classifier.Id, "outputMode": "stream_retract", "failClosed": false,
		"categories": map[string]any{
			"violence":      rules(rule("block", 0.5), rule("block", 0.5)),
			"personal_data": rules(rule("flag", 0.5), rule("off", 0.5)),
		},
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestModerationModelsAndPolicies(t *testing.T) {
	env := newModerationEnv(t)
	admin := env.admin

	// Guardrail models need a family; the other kinds drop it.
	code, e := admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "lg", "upstreamModel": "fake-llama-guard",
		"displayName": "Llama Guard", "kind": "moderation", "maxClassification": "sensitive", "moderationProvider": "guardrail_chat"}, nil, nil)
	mustCode(t, "guardrail without family", code, e, 400, "invalid_moderation_family")
	var guard, judge apitypes.Model
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "lg", "upstreamModel": "fake-llama-guard",
		"displayName": "Llama Guard", "kind": "moderation", "maxClassification": "sensitive", "moderationProvider": "guardrail_chat",
		"moderationFamily": "llama_guard"}, &guard, nil)
	mustCode(t, "guardrail", code, e, 201, "")
	if guard.ModerationProvider == nil || *guard.ModerationProvider != "guardrail_chat" || guard.ModerationFamily == nil || *guard.ModerationFamily != "llama_guard" {
		t.Fatalf("guard = %+v", guard)
	}
	// System One judgment APIs are SystemOne models now (ADR-0020).
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "jev", "upstreamModel": "jev-latest",
		"displayName": "Judge", "kind": "moderation", "maxClassification": "sensitive", "moderationProvider": "system_one"}, nil, nil)
	mustCode(t, "system_one moderation model", code, e, 400, "invalid_moderation_provider")
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "jev", "upstreamModel": "jev-latest",
		"displayName": "Judge", "kind": "systemone", "maxClassification": "sensitive", "moderationProvider": "guardrail_chat", "moderationFamily": "shieldgemma"}, &judge, nil)
	mustCode(t, "system one", code, e, 201, "")
	if judge.Kind != "systemone" || judge.ModerationFamily != nil || judge.ModerationProvider != nil {
		t.Errorf("SystemOne model kept moderation fields: %+v", judge)
	}
	if env.chat.ModerationProvider != nil {
		t.Error("chat model has a moderation provider")
	}

	// Test model: a benign and a harmful sample.
	var mt apitypes.ModelTestResult
	code, e = admin.call("POST", "/v1/admin/models/"+guard.Id.String()+"/test", nil, &mt, nil)
	mustCode(t, "test guard", code, e, 200, "")
	if !mt.Ok || mt.Moderation == nil || !mt.Moderation.Harmful.Calibrated || scoreOf(mt.Moderation.Harmful, "violence") < 0.9 || scoreOf(mt.Moderation.Benign, "violence") > 0.1 {
		t.Fatalf("model test = %+v", mt)
	}
	// The test box.
	var res apitypes.ModerationResult
	code, e = admin.call("POST", "/v1/admin/moderation/test", map[string]any{"modelId": judge.Id, "text": "My SSN is UNSAFE-PII"}, &res, nil)
	mustCode(t, "test box", code, e, 200, "")
	if res.Provider != "system_one" || !res.Calibrated || scoreOf(res, "personal_data") < 0.9 || len(res.Scores) != 8 {
		t.Fatalf("test box = %+v", res)
	}
	code, e = admin.call("POST", "/v1/admin/moderation/test", map[string]any{"modelId": env.chat.Id, "text": "x"}, nil, nil)
	mustCode(t, "test a chat model", code, e, 503, "moderation_unavailable")
	env.proxy.FailModerationWith(529)
	code, e = admin.call("POST", "/v1/admin/moderation/test", map[string]any{"modelId": judge.Id, "text": "x"}, nil, nil)
	mustCode(t, "overloaded judge", code, e, 503, "model_busy")
	env.proxy.FailModerationWith(0)

	// Policies: defaults with revision 1, then If-Match writes.
	var pub apitypes.ModerationPolicy
	if code := env.auditor.get("/v1/admin/moderation/policies/public", &pub); code != 200 || pub.Revision != 1 || pub.ModelId != nil ||
		!pub.FailClosed || pub.OutputMode != "buffer" || pub.Categories["violence"].Input.Action != "block" || len(pub.Categories) != 8 {
		t.Fatalf("public defaults = %d %+v", code, pub)
	}
	if code := admin.get("/v1/admin/moderation/policies/everyone", nil); code != 404 {
		t.Errorf("unknown audience = %d", code)
	}
	body := map[string]any{"modelId": guard.Id, "categories": pub.Categories, "outputMode": "buffer", "failClosed": true}
	code, e = admin.call("PUT", "/v1/admin/moderation/policies/public", body, nil, nil)
	mustCode(t, "no If-Match", code, e, 428, "revision_required")
	code, e = env.auditor.call("PUT", "/v1/admin/moderation/policies/public", body, nil, ifMatch(1))
	mustCode(t, "auditor writes", code, e, 403, "forbidden")
	for _, bad := range []map[string]any{
		{"modelId": guard.Id, "categories": pub.Categories, "outputMode": "buffer", "failClosed": false},
		{"modelId": nil, "categories": pub.Categories, "outputMode": "buffer", "failClosed": true},
		{"modelId": guard.Id, "categories": map[string]any{"violence": rules(rule("warn", 0.5), rule("block", 2))}, "outputMode": "buffer", "failClosed": true},
	} {
		code, e = admin.call("PUT", "/v1/admin/moderation/policies/public", bad, nil, ifMatch(1))
		mustCode(t, "invalid policy", code, e, 400, "invalid_policy")
	}
	body["modelId"] = env.chat.Id
	code, e = admin.call("PUT", "/v1/admin/moderation/policies/public", body, nil, ifMatch(1))
	mustCode(t, "chat model as provider", code, e, 400, "invalid_model")

	// Ready fails until the public policy has a working provider.
	ctx := context.Background()
	if err := env.app.Moderation.Ready(ctx, "public"); err == nil || !strings.Contains(err.Error(), "No moderation provider") {
		t.Errorf("ready without provider = %v", err)
	}
	body["modelId"] = guard.Id
	var saved apitypes.ModerationPolicy
	code, e = admin.call("PUT", "/v1/admin/moderation/policies/public", body, &saved, ifMatch(1))
	mustCode(t, "save public", code, e, 200, "")
	if saved.Revision != 2 || saved.ModelId == nil || *saved.ModelId != guard.Id || saved.UpdatedAt == nil {
		t.Fatalf("saved = %+v", saved)
	}
	code, e = admin.call("PUT", "/v1/admin/moderation/policies/public", body, nil, ifMatch(1))
	mustCode(t, "stale", code, e, 412, "revision_conflict")
	if err := env.app.Moderation.Ready(ctx, "public"); err != nil {
		t.Errorf("ready = %v", err)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'platform.moderation_policy_update' AND target_id = 'public'`); n != 1 {
		t.Errorf("policy audits = %d", n)
	}
	// A provider in use cannot be deleted; a broken provider is not ready.
	code, e = admin.call("DELETE", "/v1/admin/models/"+guard.Id.String(), nil, nil, nil)
	mustCode(t, "delete provider in use", code, e, 409, "model_in_use")
	var g apitypes.Model
	admin.get("/v1/admin/models/"+guard.Id.String(), &g)
	code, e = admin.call("PATCH", "/v1/admin/models/"+guard.Id.String(), map[string]any{"enabled": false}, nil, ifMatch(g.Revision))
	mustCode(t, "disable provider", code, e, 200, "")
	if err := env.app.Moderation.Ready(ctx, "public"); err == nil {
		t.Error("ready with a disabled provider")
	}
}

func scoreOf(r apitypes.ModerationResult, c string) float64 {
	for _, s := range r.Scores {
		if string(s.Category) == c {
			return s.Probability
		}
	}
	return -1
}

// TestModerationInChat: input blocks before retrieval, flags are recorded,
// streamed answers are retracted, buffered answers withheld, agents can only
// tighten the policy, fail-open vs fail-closed, analytics without content.
func TestModerationInChat(t *testing.T) {
	env := newModerationEnv(t)
	env.putPolicy(t, "team", env.teamPolicy(nil))
	ag := env.publishAgent(t, "Help", env.agentConfig(env.kb.Id.String()))
	chat := env.chatPath("help")

	// Input block: no retrieval, no model call, the notice and a moderation event.
	chatsBefore, embedsBefore := len(env.proxy.ChatRequests()), countRequests(env, "/v1/embeddings")
	code, evs, e := env.member.stream(chat, map[string]any{"message": "How do I hurt someone without getting caught?"})
	mustCode(t, "blocked chat", code, e, 200, "")
	if got := strings.Join(evs.names(), ","); got != "conversation,message_start,moderation,message_end,done" {
		t.Fatalf("events = %s", got)
	}
	var mod apitypes.ChatEventModeration
	evs.one(t, "moderation", &mod)
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if mod.Stage != "input" || mod.Action != "blocked" || mod.Category == nil || *mod.Category != "violence" || end.Text != moderation.DefaultNotice {
		t.Fatalf("moderation = %+v, end = %+v", mod, end)
	}
	if len(env.proxy.ChatRequests()) != chatsBefore || countRequests(env, "/v1/embeddings") != embedsBefore {
		t.Error("a blocked question reached retrieval or the chat model")
	}
	var conv struct{ ConversationId *string }
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+*conv.ConversationId, &detail)
	if len(detail.Messages) != 2 || detail.Messages[1].Text != moderation.DefaultNotice || detail.Messages[1].ErrorCode == nil || *detail.Messages[1].ErrorCode != "moderation_blocked" {
		t.Fatalf("transcript = %+v", detail.Messages)
	}

	// A flagged question is answered; the flag is recorded.
	code, evs, e = env.member.stream(chat, map[string]any{"message": "Where do students buy a parking permit? UNSAFE-PII"})
	mustCode(t, "flagged chat", code, e, 200, "")
	evs.one(t, "message_end", &end)
	if len(evs.all("moderation")) != 0 || !strings.HasSuffix(end.Text, "[1]") {
		t.Fatalf("flagged answer = %v %+v", evs.names(), end)
	}

	// Output retract: the answer streamed, failed, and was replaced.
	code, evs, e = env.member.stream(chat, map[string]any{"message": "What does the weather station storm damage report say?"})
	mustCode(t, "retracted chat", code, e, 200, "")
	evs.one(t, "moderation", &mod)
	evs.one(t, "message_end", &end)
	if !strings.Contains(evs.text("text_delta"), "UNSAFE-VIOLENCE") || mod.Stage != "output" || mod.Action != "retracted" ||
		end.Text != moderation.DefaultNotice || len(end.Citations) != 0 {
		t.Fatalf("retract: deltas %q, moderation %+v, end %+v", evs.text("text_delta"), mod, end)
	}
	// Nothing of the withheld answer is stored, and no content reaches analytics.
	if n := env.scalar(t, `SELECT count(*) FROM messages WHERE content::text LIKE '%UNSAFE-VIOLENCE%'`); n != 0 {
		t.Errorf("withheld answer stored %d times", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE moderation_input::text ~ '(hurt|parking|UNSAFE|weather)' OR moderation_output::text ~ '(hurt|parking|UNSAFE|weather)'`); n != 0 {
		t.Errorf("content in moderation records: %d", n)
	}

	// Agents make it stricter only: buffer, block self-harm; a weaker
	// violence rule does not unblock violence.
	strict := env.agentConfig(env.kb.Id.String())
	strict["moderation"] = map[string]any{"outputMode": "buffer", "categories": map[string]any{
		"self_harm": rules(rule("block", 0.5), rule("off", 0.5)),
		"violence":  rules(rule("flag", 0.99), rule("flag", 0.99)),
	}}
	env.publishAgent(t, "Strict", strict)
	code, evs, e = env.member.stream(env.chatPath("strict"), map[string]any{"message": "UNSAFE-SELFHARM where is the library?"})
	mustCode(t, "override block", code, e, 200, "")
	evs.one(t, "moderation", &mod)
	if mod.Stage != "input" || *mod.Category != "self_harm" {
		t.Fatalf("override = %+v", mod)
	}
	code, evs, _ = env.member.stream(chat, map[string]any{"message": "UNSAFE-SELFHARM where is the library?"})
	if code != 200 || len(evs.all("moderation")) != 0 {
		t.Fatalf("the platform policy does not block self-harm: %v", evs.names())
	}
	code, evs, _ = env.member.stream(env.chatPath("strict"), map[string]any{"message": "UNSAFE-VIOLENCE please"})
	if evs.one(t, "moderation", &mod); code != 200 || mod.Category == nil || *mod.Category != "violence" {
		t.Fatalf("weaker override unblocked violence: %+v", mod)
	}
	// Buffer mode: no deltas until the answer passes; withheld answers never stream.
	code, evs, _ = env.member.stream(env.chatPath("strict"), map[string]any{"message": "Where do students buy a parking permit?"})
	var start apitypes.ChatEventMessageStart
	evs.one(t, "message_start", &start)
	evs.one(t, "message_end", &end)
	if code != 200 || start.Buffered == nil || !*start.Buffered || len(evs.all("thinking_delta")) != 0 ||
		len(evs.all("text_delta")) != 1 || evs.text("text_delta") != end.Text {
		t.Fatalf("buffered pass = %v %+v", evs.names(), end)
	}
	code, evs, _ = env.member.stream(env.chatPath("strict"), map[string]any{"message": "What does the weather station storm damage report say?"})
	evs.one(t, "moderation", &mod)
	if code != 200 || mod.Action != "withheld" || len(evs.all("text_delta")) != 0 {
		t.Fatalf("buffered block = %v %+v", evs.names(), mod)
	}

	// Fail-open: the provider fails and the answer goes on (decision error).
	env.proxy.FailModerationWith(500)
	var ans apitypes.ChatAnswer
	code, e = env.member.call("POST", chat, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &ans, nil)
	mustCode(t, "fail open", code, e, 200, "")
	if ans.Moderation != nil || !strings.HasSuffix(ans.Text, "[1]") {
		t.Fatalf("fail open = %+v", ans)
	}
	// Fail-closed: refused with the unavailable notice.
	env.putPolicy(t, "team", env.teamPolicy(map[string]any{"failClosed": true}))
	code, e = env.member.call("POST", chat, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &ans, nil)
	mustCode(t, "fail closed", code, e, 200, "")
	if ans.Moderation == nil || ans.Moderation.Action != "unavailable" || ans.Text != moderation.UnavailableNotice {
		t.Fatalf("fail closed = %+v", ans)
	}
	// The OpenAI-compatible endpoint reports it as a retryable error.
	var k apitypes.APIKeyCreated
	code, e = env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	oaBody := map[string]any{"model": "agent:" + env.team + "/help", "messages": []map[string]any{{"role": "user", "content": "Where do students buy a parking permit?"}}}
	code, raw, _ := openaiCall(t, env.app.URL, k.Secret, oaBody)
	var oe openaiErr
	_ = json.Unmarshal(raw, &oe)
	if code != 503 || oe.Error.Code != "moderation_unavailable" || oe.Error.Message != moderation.UnavailableNotice {
		t.Errorf("openai fail closed = %d %s", code, raw)
	}
	oaBody["stream"] = true
	if code, raw, _ = openaiCall(t, env.app.URL, k.Secret, oaBody); code != 200 || !strings.Contains(string(raw), `"code":"moderation_unavailable"`) ||
		strings.Contains(string(raw), `"content":"`+moderation.UnavailableNotice) {
		t.Errorf("openai stream fail closed = %d %s", code, raw)
	}
	// A slow provider times out (the model's own moderation timeout; chat
	// classifiers otherwise get at least 30 s), is retried once, and fails
	// closed too.
	env.proxy.FailModerationWith(0)
	env.proxy.SetModerationDelay(1500 * time.Millisecond)
	var cls apitypes.Model
	code, e = env.admin.call("PATCH", "/v1/admin/models/"+env.classifier.Id.String(), map[string]any{"moderationTimeoutSeconds": 1}, &cls, ifMatch(env.classifier.Revision))
	mustCode(t, "model timeout", code, e, 200, "")
	if cls.ModerationTimeoutSeconds == nil || *cls.ModerationTimeoutSeconds != 1 {
		t.Fatalf("model timeout = %v", cls.ModerationTimeoutSeconds)
	}
	before := env.proxy.ModerationRequests()
	code, e = env.member.call("POST", chat, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &ans, nil)
	if code != 200 || ans.Moderation == nil || ans.Moderation.Action != "unavailable" || ans.Text != moderation.UnavailableNotice {
		t.Fatalf("timeout = %d %s %+v", code, e, ans)
	}
	if n := env.proxy.ModerationRequests() - before; n != 2 {
		t.Errorf("timed-out check attempts = %d, want 2 (one retry)", n)
	}
	// The stored answer has its own code, so a reloaded conversation shows
	// "try again", not a policy block.
	var stored apitypes.ConversationDetail
	if ans.ConversationId == nil || env.member.get("/v1/conversations/"+ans.ConversationId.String(), &stored) != 200 ||
		stored.Messages[len(stored.Messages)-1].ErrorCode == nil || *stored.Messages[len(stored.Messages)-1].ErrorCode != "moderation_unavailable" {
		t.Errorf("stored unavailable answer = %+v", stored.Messages)
	}
	env.proxy.SetModerationDelay(0)

	// Analytics: blocked and flagged counts by category, errors counted.
	var an apitypes.AgentAnalytics
	if code := env.editor.get(env.base+"/agents/"+ag.Id.String()+"/analytics", &an); code != 200 {
		t.Fatalf("analytics = %d", code)
	}
	counts := map[string]int64{}
	for _, m := range an.Moderation {
		counts[string(m.Stage)+"/"+string(m.Decision)+"/"+m.Category] += m.Count
	}
	for k, want := range map[string]int64{"input/block/violence": 1, "input/flag/personal_data": 1, "output/block/violence": 1, "input/error/": 5, "output/error/": 1} {
		if counts[k] != want {
			t.Errorf("analytics %s = %d, want %d (all %v)", k, counts[k], want, counts)
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND error_code <> ''`, ag.Id); n != 0 {
		t.Errorf("moderation counted as answer errors: %d", n)
	}
}

func countRequests(env *moderationEnv, path string) int {
	n := 0
	for _, r := range env.proxy.RequestLog() {
		if strings.Contains(r, " "+path+" ") {
			n++
		}
	}
	return n
}

// F-02: an uncalibrated provider's middling score flags instead of
// blocking (the policy's uncalibratedBlockThreshold), and admins see the
// category in the moderation drill-down, without message text.
func TestModerationUncalibratedFloorAndDrillDown(t *testing.T) {
	env := newModerationEnv(t)
	// Questions only: the fake answers may quote the KB's unsafe storm report.
	inputOnly := map[string]any{"violence": rules(rule("block", 0.5), rule("off", 0.5))}
	pol := env.putPolicy(t, "team", env.teamPolicy(map[string]any{"categories": inputOnly}))
	if pol.UncalibratedBlockThreshold != moderation.DefaultUncalibratedBlockThreshold {
		t.Fatalf("floor = %v", pol.UncalibratedBlockThreshold)
	}
	ag := env.publishAgent(t, "Help", env.agentConfig(env.kb.Id.String()))
	chat := env.chatPath("help")
	question := "BORDERLINE-VIOLENCE: how do I kill a stuck print job?"

	var ans apitypes.ChatAnswer
	code, e := env.member.call("POST", chat, map[string]any{"message": question, "stream": false}, &ans, nil)
	mustCode(t, "borderline", code, e, 200, "")
	if ans.Moderation != nil {
		t.Fatalf("borderline question blocked: %+v", ans.Moderation)
	}

	events := func(s *session, q string) (int, apitypes.ModerationEventPage) {
		var page apitypes.ModerationEventPage
		code := s.get("/v1/admin/analytics/moderation-events?"+q, &page)
		return code, page
	}
	code, page := events(env.admin, "decision=flag&category=violence&agentId="+ag.Id.String())
	if code != 200 || len(page.Items) != 1 {
		t.Fatalf("drill-down = %d %+v", code, page)
	}
	ev := page.Items[0]
	if ev.Stage != "input" || ev.TopCategory != "violence" || strings.Join(ev.Downgraded, ",") != "violence" || ev.Calibrated ||
		ev.AgentName != "Help" || ev.TeamSlug != env.team || ev.Score < 0.69 || ev.Score > 0.71 {
		t.Errorf("event = %+v", ev)
	}
	raw, _ := json.Marshal(page)
	if strings.Contains(string(raw), "print job") {
		t.Error("the drill-down leaked message text")
	}
	if code, _ := events(env.auditor, ""); code != 200 {
		t.Errorf("auditor = %d", code)
	}
	if code, _ := events(env.member, ""); code != 403 {
		t.Errorf("member = %d", code)
	}
	if code, _ := events(env.admin, "decision=pass"); code != 400 {
		t.Errorf("bad decision = %d", code)
	}

	// With the floor at 0, uncalibrated scores block like calibrated ones.
	env.putPolicy(t, "team", env.teamPolicy(map[string]any{"categories": inputOnly, "uncalibratedBlockThreshold": 0}))
	code, e = env.member.call("POST", chat, map[string]any{"message": question, "stream": false}, &ans, nil)
	mustCode(t, "no floor", code, e, 200, "")
	if ans.Moderation == nil || ans.Moderation.Action != "blocked" {
		t.Fatalf("no floor = %+v", ans.Moderation)
	}
	code, page = events(env.admin, "decision=block&limit=1")
	if code != 200 || len(page.Items) != 1 || page.Items[0].TopCategory != "violence" || len(page.Items[0].Downgraded) != 0 {
		t.Errorf("block event = %+v", page)
	}
}

// F-18: an override on an audience whose policy has no provider is a
// draft warning the editor shows, and blocks publishing.
func TestModerationOverrideWithoutProviderWarns(t *testing.T) {
	env := newModerationEnv(t) // the team policy has no provider
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["moderation"] = map[string]any{"categories": map[string]any{"violence": rules(rule("block", 0.5), rule("off", 0.5))}}
	var ag apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Strict", "config": cfg}, &ag, nil)
	mustCode(t, "create", code, e, 201, "")
	var warning string
	for _, w := range ag.Warnings {
		if w.Field == "draft.moderation" {
			warning = w.Problem
		}
	}
	if !strings.Contains(warning, "No moderation provider is set for the team audience") || !strings.Contains(warning, "Admin → Moderation") {
		t.Fatalf("warnings = %+v", ag.Warnings)
	}
	code, e = env.editor.call("POST", env.base+"/agents/"+ag.Id.String()+"/publish", map[string]any{}, nil, nil)
	mustCode(t, "publish", code, e, 422, "agent_invalid")
	// With a provider the warning goes away.
	env.putPolicy(t, "team", env.teamPolicy(nil))
	env.editor.get(env.base+"/agents/"+ag.Id.String(), &ag)
	for _, w := range ag.Warnings {
		if w.Field == "draft.moderation" {
			t.Errorf("warning with a provider: %+v", w)
		}
	}
}
