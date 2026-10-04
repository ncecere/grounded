package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// lastAnswerRequest is the latest chat request that isn't a query rewrite,
// decoded.
func lastAnswerRequest(t *testing.T, env *publishEnv, rewrite bool) map[string]any {
	t.Helper()
	reqs := env.proxy.ChatRequests()
	for i := len(reqs) - 1; i >= 0; i-- {
		if strings.Contains(string(reqs[i]), "standalone") != rewrite {
			continue
		}
		var body map[string]any
		if err := json.Unmarshal(reqs[i], &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	t.Fatal("no such chat request")
	return nil
}

// thinkingOff reports whether a request turns Qwen-style thinking off.
func thinkingOff(body map[string]any) bool {
	kw, ok := body["chat_template_kwargs"].(map[string]any)
	return ok && kw["enable_thinking"] == false
}

// Reasoning effort (docs/v0.4.0.md §4, owner decision 4): the agent's own
// wins, else the audience's from its moderation policy (Public: low until
// an admin chooses); off turns thinking off the way the model says (and the
// query rewrite too); answers say "thinking" from the model's start while
// it reasons, then "answering" (never "answering" first, v0.4.2 US-08).
func TestReasoningEffortAndThinkingStatus(t *testing.T) {
	env := newPublishEnv(t)
	var m apitypes.Model
	code, e := env.admin.call("PATCH", "/v1/admin/models/"+env.chat.Id.String(), map[string]any{"compat": map[string]any{
		"supportsReasoningEffort": true, "thinkingOff": "enable_thinking_false"}}, &m, ifMatch(env.chat.Revision))
	mustCode(t, "model compat", code, e, 200, "")
	if m.Compat.ThinkingOff == nil || *m.Compat.ThinkingOff != "enable_thinking_false" {
		t.Fatalf("compat = %+v", m.Compat)
	}
	var options []apitypes.ChatModelOption
	env.editor.get("/v1/chat-models", &options)
	for _, o := range options {
		if o.Id == env.chat.Id && (!o.SupportsThinkingOff || !o.SupportsReasoningEffort) {
			t.Errorf("chat model option = %+v", o)
		}
	}
	code, e = env.admin.call("PATCH", "/v1/admin/models/"+env.chat.Id.String(), map[string]any{"compat": map[string]any{"thinkingOff": "nope"}}, nil, ifMatch(m.Revision))
	mustCode(t, "bad thinkingOff", code, e, 400, "invalid_compat")

	// The public audience: low by default, and the thinking step while the
	// model reasons in a buffered answer.
	pub := env.publicAgent(t, "Open help")
	var pol apitypes.ModerationPolicy
	if env.admin.get("/v1/admin/moderation/policies/public", &pol); pol.ReasoningEffort != "low" {
		t.Errorf("public effort = %q, want low", pol.ReasoningEffort)
	}
	v := newVisitor(t, env.app.URL)
	v.start(pub.Id, "", "")
	avoidMinuteBoundary()
	code, evs, e := v.ask(pub.Id, "Where do students buy a parking permit?")
	if code != 200 {
		t.Fatalf("public chat = %d %s", code, e)
	}
	if body := lastAnswerRequest(t, env, false); body["reasoning_effort"] != "low" || thinkingOff(body) {
		t.Errorf("public answer request = %v", body)
	}
	var steps []string
	for _, ev := range evs {
		if ev.name == "status" {
			var st apitypes.ChatEventStatus
			_ = json.Unmarshal(ev.data, &st)
			steps = append(steps, string(st.Step))
		}
	}
	if got := strings.Join(steps, ","); !strings.HasSuffix(got, "searching,thinking,answering") || len(evs.all("thinking_delta")) != 0 {
		t.Errorf("status steps = %s, thinking deltas %d", got, len(evs.all("thinking_delta")))
	}

	// The audience's off turns thinking off.
	pol = env.putPolicy(t, "public", map[string]any{"modelId": env.classifier.Id, "outputMode": "buffer", "failClosed": true, "reasoningEffort": "off",
		"categories": map[string]any{"violence": rules(rule("block", 0.5), rule("block", 0.5))}})
	if pol.ReasoningEffort != "off" {
		t.Fatalf("saved effort = %q", pol.ReasoningEffort)
	}
	v.ask(pub.Id, "When do residence halls open?")
	if body := lastAnswerRequest(t, env, false); body["reasoning_effort"] != nil || !thinkingOff(body) {
		t.Errorf("off answer request = %v", body)
	}
	// A policy saved without the field keeps it.
	if pol = env.putPolicy(t, "public", map[string]any{"modelId": env.classifier.Id, "outputMode": "buffer", "failClosed": true}); pol.ReasoningEffort != "off" {
		t.Errorf("effort after a save without it = %q", pol.ReasoningEffort)
	}
	code, e = env.admin.call("PUT", "/v1/admin/moderation/policies/public", map[string]any{"modelId": env.classifier.Id, "outputMode": "buffer",
		"failClosed": true, "reasoningEffort": "minimal"}, nil, ifMatch(pol.Revision))
	mustCode(t, "bad effort", code, e, 400, "")

	// The agent's own effort wins; team agents follow the model's default;
	// the rewrite of an agent at off turns thinking off too.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["reasoningEffort"] = "high"
	env.publishAgent(t, "Thinker", cfg)
	cfg["reasoningEffort"] = "off"
	env.publishAgent(t, "Quick", cfg)
	env.publishAgent(t, "Plain", env.agentConfig(env.kb.Id.String()))
	for slug, want := range map[string]any{"thinker": "high", "plain": nil} {
		code, _, e := env.member.stream(env.chatPath(slug), map[string]any{"message": "Where do students buy a parking permit?"})
		mustCode(t, slug, code, e, 200, "")
		if body := lastAnswerRequest(t, env, false); body["reasoning_effort"] != want || thinkingOff(body) {
			t.Errorf("%s answer request = %v", slug, body)
		}
	}
	var first apitypes.ChatAnswer
	code, e = env.member.call("POST", env.chatPath("quick"), map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &first, nil)
	mustCode(t, "quick", code, e, 200, "")
	code, e = env.member.call("POST", env.chatPath("quick"), map[string]any{"message": "And for it?", "stream": false, "conversationId": first.ConversationId}, nil, nil)
	mustCode(t, "quick follow-up", code, e, 200, "")
	if body := lastAnswerRequest(t, env, true); !thinkingOff(body) || body["reasoning_effort"] != nil {
		t.Errorf("rewrite request at off = %v", body)
	}
	if body := lastAnswerRequest(t, env, false); !thinkingOff(body) {
		t.Errorf("answer request at off = %v", body)
	}
	code, e = env.editor.call("PATCH", env.base+"/agents/"+pub.Id.String(), map[string]any{"config": map[string]any{"reasoningEffort": "minimal"}}, nil,
		ifMatch(revisionOf(t, env.editor, env.base+"/agents/"+pub.Id.String())))
	mustCode(t, "bad agent effort", code, e, 400, "invalid_config")
}
