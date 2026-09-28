package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// A personal API key acts as its user, but only within the key's team,
// scopes and agent restriction (DESIGN.md §3.3): it reads the user's
// conversations with that team's agents it may use, with the query scope,
// and nothing else. Found by the authorization matrix: a team-bound
// ingest-only key listed and read every transcript of its user.
func TestPersonalKeyConversationsStayWithinTheKey(t *testing.T) {
	env := newAgentEnv(t)
	help := env.publishAgent(t, "Student help", env.agentConfig(env.kb.Id.String()))
	other := env.publishAgent(t, "Other help", env.agentConfig(env.kb.Id.String()))

	// The owner also owns a second team, with its own agent.
	createTeam(t, env.admin, "second", "user@localhost")
	env.owner.refresh()
	var kb apitypes.KnowledgeBase
	code, e := env.owner.call("POST", "/v1/teams/second/kbs", map[string]any{"name": "Second"}, &kb, nil)
	mustCode(t, "second kb", code, e, 201, "")
	var ag apitypes.Agent
	code, e = env.owner.call("POST", "/v1/teams/second/agents", map[string]any{"name": "Second help", "config": env.agentConfig(kb.Id.String())}, &ag, nil)
	mustCode(t, "second agent", code, e, 201, "")
	code, e = env.owner.call("POST", "/v1/teams/second/agents/"+ag.Id.String()+"/publish", map[string]any{}, nil, nil)
	mustCode(t, "publish second", code, e, 201, "")

	chat := func(path string) apitypes.ChatAnswer {
		var ans apitypes.ChatAnswer
		code, e := env.owner.call("POST", path, map[string]any{"message": "Where do students buy a parking permit?", "stream": false}, &ans, nil)
		mustCode(t, "chat "+path, code, e, 200, "")
		return ans
	}
	mine := chat(env.chatPath(help.Slug))
	elsewhere := chat("/v1/agents/second/" + ag.Slug + "/chat")

	key := func(scopes []string, agents ...string) string {
		body := map[string]any{"name": strings.Join(scopes, "+"), "scopes": scopes}
		if len(agents) > 0 {
			body["agentIds"] = agents
		}
		var k apitypes.APIKeyCreated
		code, e := env.owner.call("POST", env.base+"/api-keys", body, &k, nil)
		mustCode(t, "key", code, e, 201, "")
		return k.Secret
	}
	query, ingest, restricted := key([]string{"query"}), key([]string{"ingest"}), key([]string{"query"}, other.Id.String())
	listed := func(k string) map[string]bool {
		var page apitypes.ConversationPage
		code, e := keyCall(t, env.app.URL, "GET", "/v1/conversations", k, nil, &page)
		mustCode(t, "list", code, e, 200, "")
		out := map[string]bool{}
		for _, c := range page.Items {
			out[c.Id.String()] = true
		}
		return out
	}
	conv := func(a apitypes.ChatAnswer) string { return "/v1/conversations/" + a.ConversationId.String() }

	if l := listed(query); !l[mine.ConversationId.String()] || l[elsewhere.ConversationId.String()] {
		t.Errorf("query key lists %v", l)
	}
	if l := listed(ingest); len(l) != 0 {
		t.Errorf("ingest-only key lists %v", l)
	}
	if l := listed(restricted); len(l) != 0 {
		t.Errorf("key restricted to another agent lists %v", l)
	}
	if code, _ := keyCall(t, env.app.URL, "GET", conv(mine), query, nil, nil); code != 200 {
		t.Errorf("query key reads its team's conversation = %d", code)
	}
	for name, c := range map[string]struct {
		key, method, path string
		body              any
	}{
		"other team's transcript":        {query, "GET", conv(elsewhere), nil},
		"other team's export":            {query, "GET", conv(elsewhere) + "/export", nil},
		"rename other team's":            {query, "PATCH", conv(elsewhere), map[string]any{"title": "x"}},
		"delete other team's":            {query, "DELETE", conv(elsewhere), nil},
		"feedback on other team's":       {query, "POST", "/v1/messages/" + elsewhere.MessageId.String() + "/feedback", map[string]any{"rating": "up"}},
		"ingest-only transcript":         {ingest, "GET", conv(mine), nil},
		"ingest-only feedback":           {ingest, "POST", "/v1/messages/" + mine.MessageId.String() + "/feedback", map[string]any{"rating": "up"}},
		"restricted key, other agent":    {restricted, "GET", conv(mine), nil},
		"restricted key, other's rename": {restricted, "PATCH", conv(mine), map[string]any{"title": "x"}},
	} {
		if code, _ := keyCall(t, env.app.URL, c.method, c.path, c.key, c.body, nil); code != 404 {
			t.Errorf("%s = %d, want 404", name, code)
		}
	}
	// The session still sees both.
	var page apitypes.ConversationPage
	if env.owner.get("/v1/conversations", &page); len(page.Items) != 2 {
		t.Errorf("session lists %d conversations", len(page.Items))
	}
}
