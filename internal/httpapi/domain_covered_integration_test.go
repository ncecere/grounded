package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// AD2-19: a pending domain request the platform allowlist already covers isn't counted as waiting (the admin badge
// and Needs attention); it stays in the list, where the page says approving it changes nothing.
func TestCoveredDomainRequestIsNotWaiting(t *testing.T) {
	env := newWebEnv(t, false)
	var dr apitypes.DomainRequest
	code, e := env.owner.call("POST", env.base+"/domain-requests", map[string]any{"pattern": "status.example.net", "reason": "Our status page."}, &dr, nil)
	mustCode(t, "request", code, e, 201, "")

	var attention apitypes.AdminAttention
	if env.admin.get("/v1/admin/attention", &attention); attention.PendingDomainRequests != 1 {
		t.Fatalf("attention before the allowlist covers it = %+v", attention)
	}
	code, e = env.admin.call("POST", "/v1/admin/crawl-allowlist", map[string]any{"pattern": "*.example.net", "note": "partner sites"}, nil, nil)
	mustCode(t, "allowlist", code, e, 201, "")
	if env.admin.get("/v1/admin/attention", &attention); attention.PendingDomainRequests != 0 {
		t.Fatalf("attention once covered = %+v", attention)
	}
	var pending []apitypes.DomainRequest
	if env.admin.get("/v1/admin/domain-requests?status=pending", &pending); len(pending) != 1 || pending[0].Id != dr.Id {
		t.Fatalf("pending list = %+v", pending)
	}
}
