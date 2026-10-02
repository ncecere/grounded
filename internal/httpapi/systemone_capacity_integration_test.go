package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// TestSystemOneStatusCarriesAddedTime (docs/v0.4.1.md §4): the status
// editors read carries each check's median added time on the platform, the
// admin page's numbers, once answers were checked; nothing without a model.
func TestSystemOneStatusCarriesAddedTime(t *testing.T) {
	env := newSystemOneEnv(t)
	var status apitypes.SystemOneStatus
	if env.member.get("/v1/systemone/status", &status); status.Available || status.Judging.LatencyP50Ms != nil {
		t.Fatalf("without a model = %+v", status)
	}
	env.putSettings(t, nil)
	env.publishAgent(t, "Fees", env.agentConfig(env.kb.Id.String()))
	code, _, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What is the transcript fee?"})
	mustCode(t, "chat", code, e, 200, "")
	if env.member.get("/v1/systemone/status", &status); !status.Available || status.Judging.LatencyP50Ms == nil || *status.Judging.LatencyP50Ms < 0 {
		t.Fatalf("status = %+v", status)
	}
	var ov apitypes.PlatformAnalytics
	env.admin.get("/v1/admin/analytics", &ov)
	if ov.Totals.Judging.LatencyP50Ms == nil || *ov.Totals.Judging.LatencyP50Ms != *status.Judging.LatencyP50Ms {
		t.Errorf("status %v, admin analytics %v: want the same median", *status.Judging.LatencyP50Ms, ov.Totals.Judging.LatencyP50Ms)
	}
}
