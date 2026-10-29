package httpapi_test

import (
	"reflect"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func TestPublicMessageBoundsKeepExplicitNullAndOrdinaryZeroSemantics(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	for _, item := range []map[string]any{
		{"key": "storage_bytes", "default": 12345, "ceiling": nil},
		{"key": "public_message_max_chars", "default": 1, "ceiling": nil},
		{"key": "public_message_max_chars", "default": 1, "ceiling": 1},
		{"key": "public_message_max_chars", "default": nil, "ceiling": nil},
		{"key": "data_sources", "default": 0, "ceiling": 0},
	} {
		var before, saved apitypes.PlatformLimits
		admin.get("/v1/admin/limits", &before)
		code, e := admin.call("PUT", "/v1/admin/limits", map[string]any{"items": []any{item}}, &saved, ifMatch(before.Revision))
		mustCode(t, "valid explicit limit values", code, e, 200, "")
		if saved.Revision != before.Revision+1 {
			t.Fatalf("save did not advance revision: %d -> %d", before.Revision, saved.Revision)
		}
	}
	createTeam(t, admin, "limit-check", "user@localhost")
	var current, after apitypes.TeamLimitOverrides
	path := "/v1/admin/teams/limit-check/limits"
	admin.get(path, &current)
	code, e := admin.call("PUT", path, map[string]any{"items": []any{map[string]any{"key": "public_message_max_chars", "value": 0}}}, nil, ifMatch(current.Revision))
	mustCode(t, "zero message-length override", code, e, 400, "invalid_limit")
	admin.get(path, &after)
	if !reflect.DeepEqual(current, after) {
		t.Fatal("rejected override changed team configuration")
	}
	code, e = admin.call("PUT", path, map[string]any{"items": []any{map[string]any{"key": "public_message_max_chars", "value": 1}}}, &after, ifMatch(current.Revision))
	mustCode(t, "one-character message override", code, e, 200, "")
	code, e = admin.call("PUT", path, map[string]any{"items": []any{map[string]any{"key": "public_message_max_chars", "value": nil}}}, nil, ifMatch(after.Revision))
	mustCode(t, "inherit message bound", code, e, 200, "")
}
