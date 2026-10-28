package httpapi_test

import "testing"

// Auditors cannot repair a forbidden write by adding a revision (#146). Check
// the real session/CSRF/router stack, not just the service with a valid body.
func TestAuditorWritesAreForbiddenBeforeRevisionAndBody(t *testing.T) {
	app := newTestApp(t, nil)
	auditor, admin := app.signIn("auditor"), app.signIn("admin")
	const id = "00000000-0000-0000-0000-000000000001"
	for _, tc := range []struct{ method, path string }{
		{"PUT", "/v1/admin/costs/settings"},
		{"PUT", "/v1/admin/systemone"},
		{"PUT", "/v1/admin/rerank"},
		{"PUT", "/v1/admin/parsing"},
		{"PUT", "/v1/admin/limits"},
		{"PUT", "/v1/admin/settings/mcp"},
		{"PUT", "/v1/admin/settings/evaluations"},
		{"PUT", "/v1/admin/settings/team-requests"},
		{"PUT", "/v1/admin/settings/answer-cache"},
		{"PUT", "/v1/admin/settings/webhooks"},
		{"PATCH", "/v1/admin/users/" + id},
		{"POST", "/v1/admin/team-requests/" + id + "/approve"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			for _, headers := range []map[string]string{nil, {"If-Match": "not-a-revision"}, ifMatch(999)} {
				code, e := auditor.call(tc.method, tc.path, map[string]any{"unknown": true}, nil, headers)
				mustCode(t, "auditor without a usable precondition", code, e, 403, "forbidden")
			}
			code, e := admin.call(tc.method, tc.path, map[string]any{"unknown": true}, nil, nil)
			mustCode(t, "admin still needs revision", code, e, 428, "revision_required")
		})
	}
}
