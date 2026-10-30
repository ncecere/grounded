package httpapi_test

import "testing"

func TestContextualDefaultPlatformRefusesOptInBeforeWork(t *testing.T) {
	// Unlike newCtxEnv's explicit fake-only opt-in, nil uses real defaults.
	env := newCtxEnvWith(t, nil)
	src := env.source(t, "Default-off handbook", upload{"handbook.md", handbook("Handbook", "Parking")})
	before := env.contextual(t, src.Id)
	if before.PlatformEnabled || before.Enabled {
		t.Fatalf("contextual work unexpectedly enabled: %+v", before)
	}
	env.put(t, src.Id, map[string]any{"enabled": true, "modelId": env.chat.Id, "failurePolicy": "fail", "maxCalls": 10, "maxCallsPerDay": 10}, 409, "contextual_unavailable")
	after := env.contextual(t, src.Id)
	if after.Enabled || after.Revision != before.Revision || after.Calls.Attempts != 0 || after.CachedContexts != 0 {
		t.Errorf("refused opt-in changed settings/work: %+v", after)
	}
	found := false
	for _, b := range env.estimate(t, src.Id).Blockers {
		found = found || b.Code == "platform_off"
	}
	if !found {
		t.Error("default-off estimate omitted the platform blocker")
	}
	if n := len(env.proxy.ContextCalls()); n != 0 {
		t.Errorf("default-off source made %d contextual model requests", n)
	}
}
