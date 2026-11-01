package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Explicit synthetic-test admission only; no real gateway or spending approval.
func contextualAdmissionBody() map[string]any {
	return map[string]any{"maxTokens": 10000000, "maxTokensPerDay": 10000000,
		"maxAmount": "10.000000", "maxAmountPerDay": "10.000000", "currency": "USD"}
}

func TestContextualEnabledRequiresExplicitAdmissionWithoutStartingWork(t *testing.T) {
	env := newCtxEnv(t)
	src := env.source(t, "Handbook", upload{"handbook.md", handbook("Student Handbook", "Parking")})
	before := env.contextual(t, src.Id)
	code, e := env.admin.call("PUT", env.settingsPath(src.Id), map[string]any{"enabled": true, "modelId": env.chat.Id,
		"failurePolicy": "fail", "maxCalls": 100, "maxCallsPerDay": 100}, nil, ifMatch(before.Revision))
	mustCode(t, "enable without admission", code, e, 400, "contextual_admission_required")
	after := env.contextual(t, src.Id)
	if after.Enabled || after.Revision != before.Revision || after.Admission != nil || len(env.proxy.ContextCalls()) != 0 {
		t.Fatalf("missing admission changed settings or started work: %+v", after)
	}
}

func TestContextualImpossibleAdmissionBlocksPreviewWithoutCandidate(t *testing.T) {
	for _, kind := range []string{"tokens", "amount", "currency"} {
		t.Run(kind, func(t *testing.T) {
			env := newCtxEnv(t)
			src := env.source(t, "Handbook", upload{"handbook.md", handbook("Student Handbook", "Parking", "Housing")})
			kb := env.kb(t, "Handbook", src.Id)
			env.fakeContextPrices(t, env.chat)
			admission := contextualAdmissionBody()
			want := "tokens_over_cap"
			switch kind {
			case "tokens":
				admission["maxTokens"] = 1
			case "amount":
				admission["maxAmount"] = "0.000001"
				want = "amount_over_cap"
			case "currency":
				admission["currency"] = "EUR"
				want = "contextual_currency"
			}
			env.put(t, src.Id, map[string]any{"enabled": true, "modelId": env.chat.Id, "failurePolicy": "fail",
				"maxCalls": 100, "maxCallsPerDay": 100, "admission": admission}, 200, "")
			est := env.estimate(t, src.Id)
			found := false
			for _, b := range est.Blockers {
				found = found || b.Code == want
			}
			if !found || est.Admission == nil {
				t.Fatalf("missing %s admission blocker/limits: %+v", want, est)
			}
			before := env.profileRows(t)
			code, e := env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{
				"kbId": kb.Id, "changes": map[string]any{"contextualChunks": true}}, nil, nil)
			mustCode(t, "impossible admission preview", code, e, 409, "migration_blocked")
			if env.profileRows(t) != before || len(env.proxy.ContextCalls()) != 0 {
				t.Fatal("blocked admission created a candidate or sent model work")
			}
		})
	}
}

func TestContextualUnknownPriceBlocksPreviewBeforeCandidateOrModelWork(t *testing.T) {
	env := newCtxEnv(t)
	src := env.source(t, "Unpriced handbook", upload{"handbook.md", handbook("Student Handbook", "Parking", "Housing")})
	kb := env.kb(t, "Unpriced handbook", src.Id)
	cur := env.contextual(t, src.Id)
	body := map[string]any{"enabled": true, "modelId": env.chat.Id, "failurePolicy": "fail",
		"maxCalls": 100, "maxCallsPerDay": 100, "admission": contextualAdmissionBody()}
	var st apitypes.ContextualChunks
	code, e := env.admin.call("PUT", env.settingsPath(src.Id), body, &st, ifMatch(cur.Revision))
	mustCode(t, "save unpriced settings without starting work", code, e, 200, "")
	if len(env.proxy.ContextCalls()) != 0 {
		t.Fatal("saving settings sent model requests")
	}
	est := env.estimate(t, src.Id)
	blocked := false
	for _, b := range est.Blockers {
		blocked = blocked || b.Code == "contextual_price_unknown"
	}
	if est.Cost.PriceKnown || est.Cost.MaxAmount != nil || !blocked {
		t.Errorf("unknown price did not produce an explicit admission blocker: %+v", est)
	}
	before := env.profileRows(t)
	code, e = env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{
		"kbId": kb.Id, "changes": map[string]any{"contextualChunks": true}}, nil, nil)
	if code != 409 || e != "migration_blocked" {
		t.Errorf("unknown-price preview was accepted: status=%d error=%+v", code, e)
	}
	if env.profileRows(t) != before || len(env.proxy.ContextCalls()) != 0 {
		t.Error("unknown-price preview created a candidate or made model requests")
	}
}
