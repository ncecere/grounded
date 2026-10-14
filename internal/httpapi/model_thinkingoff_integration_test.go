package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// A chat model's Test also asks whether "How to turn thinking off" works (issue #7): some models ignore every switch.
func TestChatModelTestChecksThinkingOff(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	proxy := testutil.NewFakeProxy(t)
	// a model is unique by connection and upstream ID, so each case has its own; the fake reasons on every reply except
	// for the models whose ID starts with FakeNoThinkPrefix, and then only when asked to turn thinking off
	for _, id := range []string{"ignores-switch", testutil.FakeNoThinkPrefix + "-effort", testutil.FakeNoThinkPrefix + "-template"} {
		proxy.AddChatModel(id)
	}

	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Proxy", "baseUrl": proxy.BaseURL(), "apiKey": proxy.APIKey}, &conn, nil)
	mustCode(t, "create connection", code, e, 201, "")

	create := func(key, upstream string, compat map[string]any) apitypes.Model {
		var m apitypes.Model
		code, e := admin.call("POST", "/v1/admin/models", map[string]any{
			"connectionId": conn.Id, "key": key, "upstreamModel": upstream, "displayName": key,
			"kind": "chat", "maxClassification": "open", "contextWindow": 8192, "compat": compat,
		}, &m, nil)
		mustCode(t, "create "+key, code, e, 201, "")
		return m
	}
	test := func(m apitypes.Model) apitypes.ModelTestResult {
		var res apitypes.ModelTestResult
		code, e := admin.call("POST", "/v1/admin/models/"+m.Id.String()+"/test", nil, &res, nil)
		mustCode(t, "test "+m.Key, code, e, 200, "")
		if !res.Ok || res.Reply == nil || *res.Reply != "pong" {
			t.Fatalf("%s: the ordinary test must pass whatever thinking does: %+v", m.Key, res)
		}
		return res
	}

	// No way to turn thinking off configured: nothing to check, and no extra request.
	if res := test(create("plain", "test-chat", map[string]any{})); res.ThinkingOff != nil {
		t.Errorf("a model without a thinking-off setting reports %+v", res.ThinkingOff)
	}

	// The model ignores the switch (the fake's ordinary models reason on every reply).
	ignores := test(create("ignores", "ignores-switch", map[string]any{"thinkingOff": "reasoning_effort_none"})).ThinkingOff
	if ignores == nil || ignores.Honoured || ignores.Setting != "reasoning_effort: none" || ignores.Error != nil {
		t.Fatalf("a model that ignores the switch: %+v", ignores)
	}
	if ignores.ReasoningTokens == nil || *ignores.ReasoningTokens == 0 || !strings.Contains(ignores.Message, "isn't honoured") {
		t.Errorf("it should say how much it reasoned and that it isn't honoured: %+v", ignores)
	}

	// The model honours either switch.
	for key, way := range map[string]string{"effort": "reasoning_effort_none", "template": "enable_thinking_false"} {
		got := test(create(key, testutil.FakeNoThinkPrefix+"-"+key, map[string]any{"thinkingOff": way})).ThinkingOff
		if got == nil || !got.Honoured || got.ReasoningTokens != nil || got.Error != nil || !strings.Contains(got.Message, "works") {
			t.Errorf("%s (%s): %+v, want honoured", key, way, got)
		}
	}

	// The warning is information for the admin, not a failed test: the stored health stays healthy.
	var health []apitypes.HealthCheck
	if code, e := admin.call("GET", "/v1/admin/health-checks?kind=model", nil, &health, nil); code != 200 {
		t.Fatalf("health: HTTP %d %v", code, e)
	}
	if len(health) < 3 {
		t.Fatalf("the tests should have stored health for each model: %+v", health)
	}
	for _, h := range health {
		if h.Status != apitypes.HealthCheckStatus("healthy") {
			t.Errorf("health of %s = %s: a model that ignores thinking off is not failing", h.SubjectName, h.Status)
		}
	}
}
