package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

func TestPublicMessageFloorAndRequiredLimitFields(t *testing.T) {
	app := newTestApp(t, nil)
	admin := app.signIn("admin")
	for _, tc := range []struct {
		name string
		item map[string]any
	}{
		{"zero default", map[string]any{"key": "public_message_max_chars", "default": 0, "ceiling": nil}},
		{"zero ceiling", map[string]any{"key": "public_message_max_chars", "default": 0, "ceiling": 0}},
		{"zero ceiling with valid default", map[string]any{"key": "public_message_max_chars", "default": 1, "ceiling": 0}},
		{"missing ceiling", map[string]any{"key": "data_sources", "default": 10}},
		{"missing default", map[string]any{"key": "data_sources", "ceiling": 10}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var before, after apitypes.PlatformLimits
			if code := admin.get("/v1/admin/limits", &before); code != 200 {
				t.Fatal(code)
			}
			audits := auditCount(t, app, "limits.platform_update")
			// A valid earlier item must not be written when a later item fails.
			items := []any{map[string]any{"key": "storage_bytes", "default": 12345, "ceiling": nil}, tc.item}
			code, e := admin.call("PUT", "/v1/admin/limits", map[string]any{"items": items}, nil, ifMatch(before.Revision))
			mustCode(t, "invalid limit contract", code, e, 400, "invalid_limit")
			if code := admin.get("/v1/admin/limits", &after); code != 200 || after.Revision != before.Revision {
				t.Fatalf("rejected update changed revision: %d -> %d (%d)", before.Revision, after.Revision, code)
			}
			if got := auditCount(t, app, "limits.platform_update"); got != audits {
				t.Fatalf("rejected update was audited: %d -> %d", audits, got)
			}
		})
	}
}
