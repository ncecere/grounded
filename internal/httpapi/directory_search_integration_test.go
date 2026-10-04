package httpapi_test

import (
	"net/url"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// TestDirectorySearchIgnoresPunctuation (v0.4.2 US-13): "wifi" finds an
// agent about "Wi-Fi", and "help desk" one called "Helpdesk".
func TestDirectorySearchIgnoresPunctuation(t *testing.T) {
	env := newAgentEnv(t)
	cfg := env.agentConfig(env.kb.Id.String())
	env.publishAgent(t, "Campus Wi-Fi", cfg)
	env.publishAgent(t, "Helpdesk", cfg)
	for q, want := range map[string]string{"wifi": "Campus Wi-Fi", "WI FI": "Campus Wi-Fi", "help desk": "Helpdesk", "Wi-Fi": "Campus Wi-Fi"} {
		var cards []apitypes.AgentCard
		if code := env.member.get("/v1/agents?q="+url.QueryEscape(q), &cards); code != 200 || len(cards) != 1 || cards[0].Name != want {
			t.Errorf("%q = %d %+v", q, code, cards)
		}
	}
}
