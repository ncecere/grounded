package httpapi_test

import (
	"context"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// The usage ledger by where it was used (E13): a member's chat in the app (ui), an editor's Try it (test), a
// knowledge base search by an API key (api) and by an editor on the knowledge base page (test), and a day retention
// already rolled up (here, a widget's), all with the team filter applied.
func TestAnalyticsUsageByChannel(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Help desk", env.agentConfig(env.kb.Id.String()))
	code, _, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where do I park?"})
	mustCode(t, "chat", code, e, 200, "")
	code, _, e = env.editor.stream(env.base+"/agents/"+ag.Id.String()+"/test", map[string]any{"message": "Where do I park?"})
	mustCode(t, "try it", code, e, 200, "")
	retrieve := env.base + "/kbs/" + env.kb.Id.String() + "/retrieve"
	code, e = env.editor.call("POST", retrieve, map[string]any{"query": "parking permit"}, nil, nil)
	mustCode(t, "editor retrieve", code, e, 200, "")
	var key struct {
		Secret string `json:"secret"`
	}
	code, e = env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "search", "kind": "service", "scopes": []string{"query"}, "responsibleUserId": env.owner.me.User.Id}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	code, e = env.owner.call("POST", retrieve, map[string]any{"query": "parking permit"}, nil, map[string]string{"Authorization": "Bearer " + key.Secret})
	mustCode(t, "key retrieve", code, e, 200, "")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format(time.DateOnly)
	if _, err := env.app.Pool.Exec(context.Background(), `INSERT INTO usage_daily (day, kind, team_id, channel, quantity, events)
		SELECT $1::date, 'chat_tokens_in', team_id, 'widget', 700, 2 FROM knowledge_bases WHERE id = $2`, yesterday, env.kb.Id); err != nil {
		t.Fatal(err)
	}

	var ov apitypes.PlatformAnalytics
	mustCode(t, "analytics", env.admin.get("/v1/admin/analytics?team="+env.team, &ov), "", 200, "")
	got := map[string]apitypes.PlatformAnalyticsUsageChannel{}
	for _, c := range ov.UsageChannels {
		got[c.Channel] = c
	}
	if ui := got["ui"]; ui.ChatInputTokens == 0 || ui.ChatOutputTokens == 0 || ui.Queries == 0 {
		t.Errorf("the member's chat is not in ui: %+v", ov.UsageChannels)
	}
	if tst := got["test"]; tst.ChatInputTokens == 0 || tst.Queries < 2 {
		t.Errorf("Try it and the editor's knowledge base search are not in test: %+v", tst)
	}
	if api := got["api"]; api.Queries != 1 || api.ChatInputTokens != 0 {
		t.Errorf("the key's search is not in api: %+v", api)
	}
	if w := got["widget"]; w.ChatInputTokens != 700 {
		t.Errorf("rolled-up usage is missing: %+v", w)
	}
	createTeam(t, env.admin, "quiet-team", string(env.owner.me.User.Email))
	var other apitypes.PlatformAnalytics
	mustCode(t, "other team", env.admin.get("/v1/admin/analytics?team=quiet-team", &other), "", 200, "")
	for _, c := range other.UsageChannels {
		if c.Channel == "ui" || c.Channel == "api" || c.Channel == "widget" {
			t.Errorf("the team filter leaked another team's usage: %+v", c)
		}
	}
}
