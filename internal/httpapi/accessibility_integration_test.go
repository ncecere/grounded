package httpapi_test

import (
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"strings"
	"testing"
)

func TestAccessibilitySettings(t *testing.T) {
	app := newTestApp(t, nil)
	admin, auditor, viewer := app.signIn("admin"), app.signIn("auditor"), app.signIn("user")
	anon := newVisitor(t, app.URL)
	path := "/v1/admin/settings/accessibility"
	var cur apitypes.AccessibilitySettings
	if code := admin.get(path, &cur); code != 200 {
		t.Fatalf("settings = %d", code)
	}
	if cur.Revision != 1 || cur.ContactUrl != "" || cur.InstitutionUrl != "" {
		t.Fatalf("defaults %+v", cur)
	}
	body := map[string]any{"contactUrl": "mailto:help@example.edu", "institutionUrl": "https://example.edu/accessibility"}
	code, e := admin.call("PUT", path, body, nil, nil)
	mustCode(t, "missing revision", code, e, 428, "")
	for name, s := range map[string]*session{"auditor": auditor, "viewer": viewer} {
		code, e = s.call("PUT", path, body, nil, ifMatch(1))
		mustCode(t, name+" cannot write", code, e, 403, "")
	}
	code, e = admin.call("PUT", path, body, &cur, ifMatch(1))
	mustCode(t, "save", code, e, 200, "")
	code, e = admin.call("PUT", path, body, nil, ifMatch(1))
	mustCode(t, "stale", code, e, 412, "")
	if code := auditor.get(path, nil); code != 200 {
		t.Fatalf("auditor read %d", code)
	}
	var public apitypes.AccessibilitySettings
	if code, e := anon.call("GET", "/v1/accessibility", nil, &public); code != 200 || public.ContactUrl != body["contactUrl"] || public.InstitutionUrl != body["institutionUrl"] {
		t.Fatalf("public links %d %s %+v", code, e, public)
	}
	code, e = admin.call("PUT", path, map[string]any{"contactUrl": ""}, nil, ifMatch(cur.Revision))
	mustCode(t, "explicit fields", code, e, 400, "")
	for _, bad := range []string{"javascript:alert(1)", "https://user:password@example.edu", "mailto:x@example.edu?subject=hello", "https://example.edu/\n", "<a>link</a>", strings.Repeat("x", 2049), "mailto:x%0d%0aBcc:evil@example.edu"} {
		code, e = admin.call("PUT", path, map[string]any{"contactUrl": bad, "institutionUrl": ""}, nil, ifMatch(cur.Revision))
		mustCode(t, "unsafe contact", code, e, 400, "")
	}
	code, e = admin.call("PUT", path, map[string]any{"contactUrl": "", "institutionUrl": "mailto:help@example.edu"}, nil, ifMatch(cur.Revision))
	mustCode(t, "unsafe institution link", code, e, 400, "")
	code, e = admin.call("PUT", path, map[string]any{"contactUrl": "", "institutionUrl": ""}, &cur, ifMatch(cur.Revision))
	mustCode(t, "clear links", code, e, 200, "")
}
