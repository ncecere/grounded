package httpapi_test

import (
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// The thinking-off result of a model's Test is kept on the model (#52, not in health, which stays healthy or failing):
// the admin pages and the agent builder show it until the setting it describes changes.
func TestThinkingOffResultIsKeptOnTheModel(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	proxy := testutil.NewFakeProxy(t)
	for _, id := range []string{"ignores-switch", testutil.FakeNoThinkPrefix + "-ok"} {
		proxy.AddChatModel(id)
	}
	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Proxy", "baseUrl": proxy.BaseURL(), "apiKey": proxy.APIKey}, &conn, nil)
	mustCode(t, "connection", code, e, 201, "")

	create := func(key, upstream string, compat map[string]any) apitypes.Model {
		var m apitypes.Model
		code, e := admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": conn.Id, "key": key, "upstreamModel": upstream, "displayName": key,
			"kind": "chat", "maxClassification": "open", "contextWindow": 8192, "compat": compat}, &m, nil)
		mustCode(t, "create "+key, code, e, 201, "")
		return m
	}
	get := func(m apitypes.Model) apitypes.Model {
		var out apitypes.Model
		code, e := admin.call("GET", "/v1/admin/models/"+m.Id.String(), nil, &out, nil)
		mustCode(t, "get "+m.Key, code, e, 200, "")
		return out
	}
	test := func(m apitypes.Model) {
		code, e := admin.call("POST", "/v1/admin/models/"+m.Id.String()+"/test", nil, nil, nil)
		mustCode(t, "test "+m.Key, code, e, 200, "")
	}
	option := func(m apitypes.Model) apitypes.ChatModelOption {
		var opts []apitypes.ChatModelOption
		if code := admin.get("/v1/chat-models", &opts); code != 200 {
			t.Fatalf("chat models: HTTP %d", code)
		}
		for _, o := range opts {
			if o.Id == m.Id {
				return o
			}
		}
		t.Fatalf("%s is not offered to agents", m.Key)
		return apitypes.ChatModelOption{}
	}

	// Before any Test there is nothing to say.
	ignores := create("ignores", "ignores-switch", map[string]any{"thinkingOff": "reasoning_effort_none"})
	if ignores.ThinkingOffCheck != nil || option(ignores).ThinkingOffCheck != nil {
		t.Fatal("a model that was never tested has a thinking-off result")
	}

	// A Test that finds it ignored keeps that, with its time, on the model and in what agents are offered. The Test is
	// not a change of the model: its revision stays.
	before := time.Now().Add(-time.Minute)
	test(ignores)
	got := get(ignores)
	if got.ThinkingOffCheck == nil || got.ThinkingOffCheck.Result != apitypes.ThinkingOffCheckResult("ignored") || got.ThinkingOffCheck.CheckedAt.Before(before) {
		t.Fatalf("after a Test that found it ignored: %+v", got.ThinkingOffCheck)
	}
	if got.Revision != ignores.Revision {
		t.Errorf("a Test changed the model's revision: %d -> %d", ignores.Revision, got.Revision)
	}
	if o := option(ignores); o.ThinkingOffCheck == nil || string(*o.ThinkingOffCheck) != "ignored" {
		t.Errorf("agents should be told it was found to be ignored: %+v", o.ThinkingOffCheck)
	}

	// An edit that is not about thinking keeps the result; one that changes the compatibility settings clears it,
	// because the result describes the setting that was tested.
	var edited apitypes.Model
	code, e = admin.call("PATCH", "/v1/admin/models/"+ignores.Id.String(), map[string]any{"displayName": "Renamed"}, &edited, ifMatch(got.Revision))
	mustCode(t, "rename", code, e, 200, "")
	if edited.ThinkingOffCheck == nil || edited.ThinkingOffCheck.Result != apitypes.ThinkingOffCheckResult("ignored") {
		t.Errorf("a rename cleared the result: %+v", edited.ThinkingOffCheck)
	}
	var recompat apitypes.Model
	code, e = admin.call("PATCH", "/v1/admin/models/"+ignores.Id.String(), map[string]any{"compat": map[string]any{"thinkingOff": "enable_thinking_false"}}, &recompat, ifMatch(edited.Revision))
	mustCode(t, "change the way", code, e, 200, "")
	if recompat.ThinkingOffCheck != nil || option(ignores).ThinkingOffCheck != nil {
		t.Errorf("changing the way to turn thinking off kept the result of the old way: %+v", recompat.ThinkingOffCheck)
	}

	// Testing again with a model that honours it stores that; removing the way clears it again on the next Test.
	ok := create("honours", testutil.FakeNoThinkPrefix+"-ok", map[string]any{"thinkingOff": "reasoning_effort_none"})
	test(ok)
	if r := get(ok).ThinkingOffCheck; r == nil || r.Result != apitypes.ThinkingOffCheckResult("honoured") {
		t.Fatalf("a model that honours it: %+v", r)
	}
	var off apitypes.Model
	code, e = admin.call("PATCH", "/v1/admin/models/"+ok.Id.String(), map[string]any{"compat": map[string]any{}}, &off, ifMatch(get(ok).Revision))
	mustCode(t, "remove the way", code, e, 200, "")
	if off.ThinkingOffCheck != nil {
		t.Errorf("removing the setting kept its result: %+v", off.ThinkingOffCheck)
	}

	// Health is not involved: the warning is not a failure.
	var health []apitypes.HealthCheck
	if code, _ := admin.call("GET", "/v1/admin/health-checks?kind=model", nil, &health, nil); code != 200 {
		t.Fatalf("health: HTTP %d", code)
	}
	for _, h := range health {
		if h.Status != apitypes.HealthCheckStatus("healthy") {
			t.Errorf("%s is %s: a model that ignores thinking off is not failing", h.SubjectName, h.Status)
		}
	}
}
