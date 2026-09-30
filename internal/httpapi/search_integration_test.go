package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// GET /v1/search (docs/v0.2.0.md §3.5): what each kind of caller finds,
// the ranking, and conversations only their owner's.

func searchAs(t *testing.T, s *session, q string) []apitypes.SearchResult {
	t.Helper()
	var out []apitypes.SearchResult
	code, e := s.call("GET", "/v1/search?q="+url.QueryEscape(q), nil, &out, nil)
	mustCode(t, "search "+q, code, e, 200, "")
	return out
}

// hits lists "type:label" of results, in order.
func hits(rs []apitypes.SearchResult) []string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, string(r.Type)+":"+r.Label)
	}
	return out
}

func findHit(rs []apitypes.SearchResult, typ, label string) *apitypes.SearchResult {
	for i := range rs {
		if string(rs[i].Type) == typ && rs[i].Label == label {
			return &rs[i]
		}
	}
	return nil
}

func wantHits(t *testing.T, who string, rs []apitypes.SearchResult, want ...string) {
	t.Helper()
	if got := hits(rs); !slices.Equal(got, want) {
		t.Errorf("%s found %q, want %q", who, got, want)
	}
}

// zephyrTeam is a second team, "Zephyr Office", owned by alex (an editor
// of registrar): a source, a KB, a team-only agent and an agent for every
// signed-in user.
func zephyrTeam(t *testing.T, env *agentEnv) (bot, guide apitypes.Agent) {
	t.Helper()
	code, e := env.admin.call("POST", "/v1/admin/teams", map[string]any{"slug": "zephyr", "name": "Zephyr Office",
		"maxClassification": "sensitive", "ownerEmail": "alex@localhost"}, nil, nil)
	mustCode(t, "create zephyr", code, e, 201, "")
	env.editor.refresh()
	alex, base := env.editor, "/v1/teams/zephyr"
	var src apitypes.DataSource
	code, e = alex.call("POST", base+"/sources", map[string]any{"name": "Zephyr ledger", "classification": "open"}, &src, nil)
	mustCode(t, "zephyr source", code, e, 201, "")
	docs := base + "/sources/" + src.Id.String() + "/documents"
	alex.uploadFiles(docs, []upload{{"zephyr.md", []byte(parkingDoc)}}, "")
	alex.waitForDocuments(t, docs)
	var kb apitypes.KnowledgeBase
	code, e = alex.call("POST", base+"/kbs", map[string]any{"name": "Zephyr notes"}, &kb, nil)
	mustCode(t, "zephyr kb", code, e, 201, "")
	code, e = alex.call("PUT", base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	publish := func(name, audience string) apitypes.Agent {
		cfg := env.agentConfig(kb.Id.String())
		cfg["audience"] = audience
		var ag apitypes.Agent
		code, e := alex.call("POST", base+"/agents", map[string]any{"name": name, "config": cfg}, &ag, nil)
		mustCode(t, "create "+name, code, e, 201, "")
		code, e = alex.call("POST", base+"/agents/"+ag.Id.String()+"/publish", map[string]any{"note": "first"}, nil, nil)
		mustCode(t, "publish "+name, code, e, 201, "")
		return ag
	}
	return publish("Zephyr team bot", "team"), publish("Zephyr campus guide", "all_authenticated")
}

// chatTitled starts a conversation with an agent and gives it a title.
func chatTitled(t *testing.T, s *session, team, agentSlug, title string) string {
	t.Helper()
	var ans struct {
		ConversationId string `json:"conversationId"`
	}
	code, e := s.call("POST", "/v1/agents/"+team+"/"+agentSlug+"/chat", map[string]any{"message": "Where do I buy a parking permit?", "stream": false}, &ans, nil)
	mustCode(t, "chat", code, e, 200, "")
	code, e = s.call("PATCH", "/v1/conversations/"+ans.ConversationId, map[string]any{"title": title}, nil, nil)
	mustCode(t, "rename", code, e, 200, "")
	return ans.ConversationId
}

func TestSearchVisibilityByRole(t *testing.T) {
	env := newAgentEnv(t)
	bot, guide := zephyrTeam(t, env)
	blair, alex, owner := env.member, env.editor, env.owner
	blairConv := chatTitled(t, blair, "zephyr", guide.Slug, "Zephyr parking question")
	chatTitled(t, alex, "zephyr", bot.Slug, "Zephyr budget chat")

	// A member of registrar only: the agent open to every signed-in user
	// (chat, not its team page) and her own conversation. Not zephyr's KB,
	// source or team-only agent, not alex's conversation, no admin objects.
	rs := searchAs(t, blair, "zephyr")
	wantHits(t, "blair", rs, "agent:Zephyr campus guide", "conversation:Zephyr parking question")
	if g := rs[0]; g.CanChat == nil || !*g.CanChat || g.CanOpen == nil || *g.CanOpen || g.Secondary != "Zephyr Office" ||
		*g.TeamSlug != "zephyr" || *g.AgentSlug != guide.Slug {
		t.Errorf("blair's guide = %+v", g)
	}
	if c := rs[1]; c.Id.String() != blairConv || c.Secondary != "Zephyr campus guide" || *c.AgentSlug != guide.Slug || c.UpdatedAt == nil ||
		time.Since(*c.UpdatedAt) > time.Hour {
		t.Errorf("blair's conversation = %+v", c)
	}
	if rs[0].UpdatedAt != nil {
		t.Errorf("an agent has updatedAt: %+v", rs[0])
	}

	// Zephyr's owner (an editor of registrar): all of zephyr, and only her
	// own conversation.
	rs = searchAs(t, alex, "zephyr")
	wantHits(t, "alex", rs, "agent:Zephyr team bot", "agent:Zephyr campus guide", "knowledge_base:Zephyr notes",
		"data_source:Zephyr ledger", "conversation:Zephyr budget chat")
	if b := findHit(rs, "agent", "Zephyr team bot"); !*b.CanOpen || !*b.CanChat {
		t.Errorf("alex's bot = %+v", b)
	}
	if s := findHit(rs, "data_source", "Zephyr ledger"); *s.Kind != "upload" || s.Secondary != "Zephyr Office" {
		t.Errorf("alex's source = %+v", s)
	}

	// Registrar's owner and team admin: like blair, without a conversation.
	for _, s := range []*session{owner, env.tadmin} {
		wantHits(t, "registrar", searchAs(t, s, "zephyr"), "agent:Zephyr campus guide")
	}

	// Platform staff: the team (metadata) and the shared agent, never
	// zephyr's KB, source, team-only agent or anyone's conversation.
	for _, s := range []*session{env.admin, env.auditor} {
		rs := searchAs(t, s, "zephyr")
		wantHits(t, "staff", rs, "team:Zephyr Office", "agent:Zephyr campus guide")
		if tm := rs[0]; tm.Secondary != "zephyr" || *tm.TeamSlug != "zephyr" || tm.Status != nil {
			t.Errorf("staff's team = %+v", tm)
		}
	}
	// Staff find users, models, connections and profiles; members don't.
	rs = searchAs(t, env.auditor, "blair")
	if u := findHit(rs, "user", "Blair Dev"); u == nil || u.Secondary != "blair@localhost" || u.Status != nil {
		t.Errorf("auditor searching blair = %q", hits(rs))
	}
	rs = searchAs(t, env.admin, "chat tools")
	if m := findHit(rs, "model", "Chat Tools"); m == nil || *m.Kind != "chat" || m.Secondary != "chat" {
		t.Errorf("admin searching the model = %q", hits(rs))
	}
	// MCP servers too, by name, with their URL.
	var mcpServer apitypes.MCPServer
	code, e := env.admin.call("POST", "/v1/admin/mcp-servers", map[string]any{"name": "Zeta service status", "url": "https://status.example.edu/mcp",
		"maxClassification": "open"}, &mcpServer, nil)
	mustCode(t, "create MCP server", code, e, 201, "")
	if m := findHit(searchAs(t, env.auditor, "zeta service"), "mcp_server", "Zeta service status"); m == nil || m.Id != mcpServer.Id ||
		m.Secondary != "https://status.example.edu/mcp" {
		t.Errorf("auditor searching the MCP server = %+v", m)
	}
	if rs := searchAs(t, blair, "zeta service"); len(rs) != 0 {
		t.Errorf("blair searching MCP servers = %q", hits(rs))
	}
	if rs := searchAs(t, blair, "chat tools"); len(rs) != 0 {
		t.Errorf("blair searching the model = %q", hits(rs))
	}
	if rs := searchAs(t, blair, "blair"); len(rs) != 0 {
		t.Errorf("blair searching users = %q", hits(rs))
	}

	// A deleted conversation is gone.
	code, e = blair.call("DELETE", "/v1/conversations/"+blairConv, nil, nil, nil)
	mustCode(t, "delete conversation", code, e, 200, "")
	wantHits(t, "blair after delete", searchAs(t, blair, "zephyr"), "agent:Zephyr campus guide")

	// An archived team: nobody chats with its agents; its members still
	// open them, and staff see the state.
	var sum apitypes.TeamSummary
	env.admin.get("/v1/admin/teams/zephyr", &sum)
	code, e = env.admin.call("PATCH", "/v1/admin/teams/zephyr", map[string]string{"status": "archived"}, &sum, ifMatch(sum.Team.Revision))
	mustCode(t, "archive", code, e, 200, "")
	if rs := searchAs(t, blair, "zephyr"); len(rs) != 0 {
		t.Errorf("blair after archive = %q", hits(rs))
	}
	if b := findHit(searchAs(t, alex, "zephyr"), "agent", "Zephyr team bot"); b == nil || !*b.CanOpen || *b.CanChat {
		t.Errorf("alex's bot after archive = %+v", b)
	}
	if tm := findHit(searchAs(t, env.auditor, "zephyr"), "team", "Zephyr Office"); tm == nil || tm.Status == nil || *tm.Status != "archived" {
		t.Errorf("auditor's team after archive = %+v", tm)
	}
}

func TestSearchRankingAndValidation(t *testing.T) {
	env := newAgentEnv(t)
	for _, name := range []string{"Mazeppa archive", "Old zephyr notes", "Zephyr"} {
		code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": name}, nil, nil)
		mustCode(t, "kb "+name, code, e, 201, "")
	}
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": "Zeppelin files", "classification": "open"}, nil, nil)
	mustCode(t, "source", code, e, 201, "")

	// Prefix, then word start, then anywhere, case-insensitively; within a
	// rank, knowledge bases before sources.
	wantHits(t, "owner", searchAs(t, env.member, "ZEP"),
		"knowledge_base:Zephyr", "data_source:Zeppelin files", "knowledge_base:Old zephyr notes", "knowledge_base:Mazeppa archive")
	var two []apitypes.SearchResult
	code, e = env.member.call("GET", "/v1/search?q=zep&limit=2", nil, &two, nil)
	mustCode(t, "limit", code, e, 200, "")
	wantHits(t, "limit 2", two, "knowledge_base:Zephyr", "data_source:Zeppelin files")
	// An agent's description matches too, after every name match.
	code, e = env.owner.call("POST", env.base+"/agents", map[string]any{"name": "Records helper",
		"description": "Answers questions about transcripts and diplomas"}, nil, nil)
	mustCode(t, "agent", code, e, 201, "")
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Old transcript notes"}, nil, nil)
	mustCode(t, "kb transcript", code, e, 201, "")
	wantHits(t, "description", searchAs(t, env.member, "TRANSCRIPT"), "knowledge_base:Old transcript notes", "agent:Records helper")

	// LIKE wildcards are literal.
	if rs := searchAs(t, env.member, "%_"); len(rs) != 0 {
		t.Errorf("wildcards matched %q", hits(rs))
	}

	for _, tc := range []struct{ q, code string }{
		{"q=z", "invalid_query"}, {"q=%20z%20", "invalid_query"}, {"", "invalid_query"},
		{"q=zep&limit=0", "invalid_limit"}, {"q=zep&limit=51", "invalid_limit"}, {"q=zep&limit=x", "invalid_limit"},
	} {
		code, e := env.member.call("GET", "/v1/search?"+tc.q, nil, nil, nil)
		mustCode(t, "search "+tc.q, code, e, 400, tc.code)
	}

	// API keys can't search (session only).
	var key struct {
		Secret string `json:"secret"`
	}
	code, e = env.owner.call("POST", env.base+"/api-keys", map[string]any{"name": "search", "kind": "personal", "scopes": []string{"query"}}, &key, nil)
	mustCode(t, "key", code, e, 201, "")
	req, _ := http.NewRequest("GET", env.app.URL+"/v1/search?q=zep", nil)
	req.Header.Set("Authorization", "Bearer "+key.Secret)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	_ = json.NewDecoder(res.Body).Decode(&body)
	if res.StatusCode != 401 {
		t.Errorf("search with an API key = %d %v", res.StatusCode, body)
	}
	// Anonymous: 401.
	res2, err := http.Get(env.app.URL + "/v1/search?q=zep")
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if res2.StatusCode != 401 {
		t.Errorf("anonymous search = %d", res2.StatusCode)
	}
}
