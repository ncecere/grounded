package httpapi_test

import (
	"testing"

	"github.com/ncecere/grounded/internal/ttlcache"
)

func TestContextualUnknownWindowDoesNotSaveOrStartWork(t *testing.T) {
	env := newCtxEnv(t)
	src := env.source(t, "Handbook", upload{"handbook.md", handbook("Student Handbook", "Parking")})
	env.fakeContextPrices(t, env.chat)
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE models SET context_window = NULL WHERE id = $1`, env.chat.Id); err != nil {
		t.Fatal(err)
	}
	ttlcache.InvalidateAll() // the model rows are cached briefly (internal/ttlcache)
	before := env.contextual(t, src.Id)
	env.put(t, src.Id, map[string]any{"enabled": true, "modelId": env.chat.Id, "failurePolicy": "fail", "maxCalls": 10, "maxCallsPerDay": 10}, 409, "model_context_window")
	after := env.contextual(t, src.Id)
	if after.Revision != before.Revision || after.Enabled {
		t.Fatal("unknown model window changed source consent")
	}
	if len(env.proxy.ContextCalls()) != 0 || env.scalar(t, `SELECT count(*) FROM contextual_calls`) != 0 || env.scalar(t, `SELECT count(*) FROM contextual_cache`) != 0 {
		t.Fatal("unknown-window opt-in performed work")
	}
}

func TestContextualLostWindowBlocksEstimateAndPreview(t *testing.T) {
	env := newCtxEnv(t)
	src := env.source(t, "Handbook", upload{"handbook.md", handbook("Student Handbook", "Parking")})
	kb := env.kb(t, "Handbook", src.Id)
	env.enable(t, src.Id, env.chat, "fail", 10)
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE models SET context_window = NULL WHERE id = $1`, env.chat.Id); err != nil {
		t.Fatal(err)
	}
	ttlcache.InvalidateAll() // the model rows are cached briefly (internal/ttlcache)
	estimate := env.estimate(t, src.Id)
	found := false
	for _, blocker := range estimate.Blockers {
		if blocker.Code == "model_context_window" {
			found = true
		}
	}
	if !found {
		t.Error("lost window did not block source estimate")
	}
	profiles := env.profileRows(t)
	code, e := env.admin.call("POST", "/v1/admin/profile-migrations/preview", map[string]any{"kbId": kb.Id, "changes": map[string]any{"contextualChunks": true}}, nil, nil)
	mustCode(t, "preview with unknown context window", code, e, 409, "migration_blocked")
	if env.profileRows(t) != profiles || len(env.proxy.ContextCalls()) != 0 {
		t.Fatal("blocked preview created a profile or sent requests")
	}
}
