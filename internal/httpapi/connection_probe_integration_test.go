package httpapi_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// A SystemOne service has no model list (GET /models answers 404), so a
// connection with only SystemOne models is tested with one SystemOne
// question; an OpenAI-compatible gateway is still asked for its models.
func TestConnectionTestSystemOneService(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	svc := testutil.NewFakeSystemOneService(t)

	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Judge service", "baseUrl": svc.BaseURL(), "apiKey": svc.APIKey}, &conn, nil)
	mustCode(t, "create connection", code, e, 201, "")
	path := "/v1/admin/connections/" + conn.Id.String() + "/test"

	// No model yet: only GET /models can be tried, and it answers 404.
	var res apitypes.ConnectionTestResult
	code, e = admin.call("POST", path, nil, &res, nil)
	mustCode(t, "test without models", code, e, 200, "")
	if res.Ok || res.Probe != "models" || res.Error == nil || res.Error.Kind != "not_found" {
		t.Fatalf("test without models = %+v", res)
	}

	var judge apitypes.Model
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conn.Id, "key": "judge", "upstreamModel": "judge-latest", "displayName": "Judge",
		"kind": "systemone", "maxClassification": "sensitive",
	}, &judge, nil)
	mustCode(t, "SystemOne model", code, e, 201, "")

	before := len(svc.Requests)
	res = apitypes.ConnectionTestResult{}
	code, e = admin.call("POST", path, nil, &res, nil)
	mustCode(t, "test SystemOne service", code, e, 200, "")
	if !res.Ok || res.Probe != "systemone" || res.SystemOneModel == nil || *res.SystemOneModel != "judge-latest" ||
		len(res.Models) != 0 || res.Error != nil || res.Timings == nil || res.Timings.Reused {
		t.Fatalf("SystemOne test = %+v", res)
	}
	if got := svc.Requests[before:]; !slices.Equal(got, []string{"POST /v1/systemone judge-latest"}) {
		t.Fatalf("requests = %v (no GET /models for a SystemOne-only connection)", got)
	}
	// The model's own test works too.
	var mt apitypes.ModelTestResult
	code, e = admin.call("POST", "/v1/admin/models/"+judge.Id.String()+"/test", nil, &mt, nil)
	mustCode(t, "test SystemOne model", code, e, 200, "")
	if !mt.Ok || mt.SystemOne == nil {
		t.Fatalf("SystemOne model test = %+v", mt)
	}

	// With another kind of model on it, GET /models is tried first; its 404
	// falls back to the SystemOne question.
	code, e = admin.call("POST", "/v1/admin/models", map[string]any{
		"connectionId": conn.Id, "key": "other", "upstreamModel": "test-chat", "displayName": "Other", "kind": "chat", "maxClassification": "open",
	}, nil, nil)
	mustCode(t, "chat model", code, e, 201, "")
	before = len(svc.Requests)
	res = apitypes.ConnectionTestResult{}
	admin.call("POST", path, nil, &res, nil)
	if !res.Ok || res.Probe != "systemone" || len(svc.Requests) != before+1 {
		t.Fatalf("fallback = %+v, requests %v", res, svc.Requests[before:])
	}

	// Failures keep their usual classes.
	svc.FailWith(429)
	res = apitypes.ConnectionTestResult{}
	admin.call("POST", path, nil, &res, nil)
	if res.Ok || res.Error == nil || res.Error.Kind != "rate_limited" {
		t.Fatalf("rate limited = %+v", res)
	}
	svc.FailWith(503)
	res = apitypes.ConnectionTestResult{}
	admin.call("POST", path, nil, &res, nil)
	if res.Ok || res.Probe != "systemone" || res.Error == nil || res.Error.Kind != "unavailable" || res.Error.Status == nil || *res.Error.Status != 503 {
		t.Fatalf("unavailable = %+v", res)
	}
	svc.FailWith(0)
	var updated apitypes.Connection
	admin.get("/v1/admin/connections/"+conn.Id.String(), &updated)
	code, e = admin.call("PATCH", "/v1/admin/connections/"+conn.Id.String(), map[string]string{"apiKey": "sk-wrong-key"}, nil, ifMatch(updated.Revision))
	mustCode(t, "wrong key", code, e, 200, "")
	res = apitypes.ConnectionTestResult{}
	admin.call("POST", path, nil, &res, nil)
	if res.Ok || res.Error == nil || res.Error.Kind != "auth" {
		t.Fatalf("wrong key = %+v", res)
	}
}

// A gateway that serves both OpenAI models and SystemOne keeps the GET
// /models test; one whose model list is missing falls back to SystemOne.
func TestConnectionTestMixedGateway(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	proxy := testutil.NewFakeProxy(t)
	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Gateway", "baseUrl": proxy.BaseURL(), "apiKey": proxy.APIKey}, &conn, nil)
	mustCode(t, "create connection", code, e, 201, "")
	for _, m := range []map[string]any{
		{"key": "judge", "upstreamModel": "jev-latest", "displayName": "Judge", "kind": "systemone", "maxClassification": "sensitive"},
		{"key": "chat", "upstreamModel": "test-chat", "displayName": "Chat", "kind": "chat", "maxClassification": "open"},
	} {
		m["connectionId"] = conn.Id
		code, e = admin.call("POST", "/v1/admin/models", m, nil, nil)
		mustCode(t, "model", code, e, 201, "")
	}
	path := "/v1/admin/connections/" + conn.Id.String() + "/test"
	var res apitypes.ConnectionTestResult
	code, e = admin.call("POST", path, nil, &res, nil)
	mustCode(t, "test gateway", code, e, 200, "")
	if !res.Ok || res.Probe != "models" || !strings.Contains(strings.Join(res.Models, ","), "test-chat") || res.SystemOneModel != nil {
		t.Fatalf("gateway test = %+v", res)
	}
}
