package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

func TestConnectionTimeoutOmittedDiffersFromExplicitZero(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	proxy := testutil.NewFakeProxy(t)
	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Default timeout", "baseUrl": proxy.BaseURL()}, &conn, nil)
	mustCode(t, "omitted timeout", code, e, 201, "")
	if conn.TimeoutSeconds != 60 {
		t.Fatalf("omitted timeout = %d, want 60", conn.TimeoutSeconds)
	}
	for _, timeout := range []int{0, -1, 601} {
		code, e = admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Bad timeout", "baseUrl": proxy.BaseURL(), "timeoutSeconds": timeout}, nil, nil)
		mustCode(t, "invalid create timeout", code, e, 400, "invalid_timeout")
		code, e = admin.call("PATCH", "/v1/admin/connections/"+conn.Id.String(), map[string]any{"timeoutSeconds": timeout}, nil, ifMatch(conn.Revision))
		mustCode(t, "invalid update timeout", code, e, 400, "invalid_timeout")
	}
	for _, timeout := range []int{1, 600} {
		code, e = admin.call("PATCH", "/v1/admin/connections/"+conn.Id.String(), map[string]any{"timeoutSeconds": timeout}, &conn, ifMatch(conn.Revision))
		mustCode(t, "timeout boundary", code, e, 200, "")
		if conn.TimeoutSeconds != int32(timeout) {
			t.Fatalf("saved timeout = %d, want %d", conn.TimeoutSeconds, timeout)
		}
	}
}

func TestChatModelOutputLimitCannotExceedItsContext(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	proxy := testutil.NewFakeProxy(t)
	var conn apitypes.Connection
	code, e := admin.call("POST", "/v1/admin/connections", map[string]any{"name": "Gateway", "baseUrl": proxy.BaseURL()}, &conn, nil)
	mustCode(t, "connection", code, e, 201, "")
	body := map[string]any{"connectionId": conn.Id, "key": "window-test", "upstreamModel": "chat", "displayName": "Chat", "kind": "chat", "maxClassification": "open", "contextWindow": 8000, "maxOutputTokens": 9000}
	code, e = admin.call("POST", "/v1/admin/models", body, nil, nil)
	mustCode(t, "output larger than context", code, e, 400, "invalid_max_output_tokens")
	body["maxOutputTokens"] = 8000
	var model apitypes.Model
	code, e = admin.call("POST", "/v1/admin/models", body, &model, nil)
	mustCode(t, "equal limits", code, e, 201, "")
	path := "/v1/admin/models/" + model.Id.String()
	for _, patch := range []map[string]any{{"maxOutputTokens": 8001}, {"contextWindow": 7999}} {
		code, e = admin.call("PATCH", path, patch, nil, ifMatch(model.Revision))
		mustCode(t, "partial update checks the resulting limits", code, e, 400, "invalid_max_output_tokens")
	}
	code, e = admin.call("PATCH", path, map[string]any{"contextWindow": 16000, "maxOutputTokens": 9000}, &model, ifMatch(model.Revision))
	mustCode(t, "increase both limits", code, e, 200, "")
	if model.ContextWindow == nil || *model.ContextWindow != 16000 || model.MaxOutputTokens == nil || *model.MaxOutputTokens != 9000 {
		t.Fatalf("limits were not saved: %+v", model)
	}
}
