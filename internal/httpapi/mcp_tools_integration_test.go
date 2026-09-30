package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/mcpserver"
)

// schemaEnum is the enum of a tool's argument.
func schemaEnum(t *testing.T, tool *mcp.Tool, arg string) []string {
	t.Helper()
	raw, _ := json.Marshal(tool.InputSchema)
	var s struct {
		Properties map[string]struct{ Enum []string }
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatal(err)
	}
	return s.Properties[arg].Enum
}

// toolNames are the names of the listed tools, in order.
func toolNames(t *testing.T, cs *mcp.ClientSession) ([]string, map[string]*mcp.Tool) {
	t.Helper()
	res, err := cs.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	byName := map[string]*mcp.Tool{}
	for _, tool := range res.Tools {
		names = append(names, tool.Name)
		byName[tool.Name] = tool
	}
	return names, byName
}

func TestMCPSearchAndAsk(t *testing.T) {
	env := newAgentEnv(t)
	url := env.app.URL
	ag := env.publishAgent(t, "Parking helper", env.agentConfig(env.kb.Id.String()))
	setMCP(t, env.admin, true)
	key := createKey(t, env.member, env.base, map[string]any{"name": "assistant", "scopes": []string{"mcp"}})
	cs := mustConnect(t, url, key.Secret, "")

	// The tools, in a fixed order, with enums of what the key may use.
	names, tools := toolNames(t, cs)
	if strings.Join(names, ",") != "ask,search" {
		t.Fatalf("tools = %v", names)
	}
	if got := schemaEnum(t, tools["search"], "knowledge_base"); len(got) != 1 || got[0] != "student-help" {
		t.Errorf("knowledge_base enum = %v", got)
	}
	if got := schemaEnum(t, tools["ask"], "agent"); len(got) != 1 || got[0] != ag.Slug {
		t.Errorf("agent enum = %v", got)
	}
	if d := tools["search"].Description; !strings.Contains(d, "- student-help: Student help") {
		t.Errorf("search description = %q", d)
	}
	if tools["search"].OutputSchema == nil || tools["ask"].OutputSchema == nil {
		t.Error("tools without an output schema")
	}

	// search: passages as text and as structured content; usage on the mcp channel; audited without content.
	var found mcpserver.SearchResult
	res := callTool(t, cs, "search", map[string]any{"knowledge_base": "student-help", "query": "Where do I buy a parking permit?", "top_k": 2}, &found)
	if res.IsError || found.KnowledgeBase != "student-help" || len(found.Passages) == 0 || len(found.Passages) > 2 || found.Passages[0].N != 1 {
		t.Fatalf("search = %+v %s", found, toolText(res))
	}
	if p := found.Passages[0]; p.Text == "" || p.DocumentID == "" || p.HeadingPath == nil || !strings.Contains(toolText(res), "[1] ") {
		t.Errorf("passage = %+v, text %q", p, toolText(res))
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'query' AND metadata->>'channel' = 'mcp' AND api_key_id = $1`, key.Key.Id); n != 1 {
		t.Errorf("mcp query usage = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'mcp.search' AND actor_kind = 'api_key' AND target_id = $1
		AND metadata->>'apiKeyId' = $2 AND metadata->>'knowledgeBase' = 'student-help' AND (metadata->>'results')::int = $3
		AND metadata->>'outcome' = 'ok' AND metadata::text NOT LIKE '%permit%'`, env.kb.Id.String(), key.Key.Id.String(), len(found.Passages)); n != 1 {
		t.Errorf("mcp.search audit entries = %d", n)
	}

	// Arguments outside the schema are tool errors, not transport errors.
	for _, args := range []map[string]any{
		{"knowledge_base": "elsewhere", "query": "parking"},
		{"knowledge_base": "student-help", "query": ""},
		{"knowledge_base": "student-help", "query": "parking", "top_k": 500},
	} {
		if r := callTool(t, cs, "search", args, nil); !r.IsError {
			t.Errorf("search %v = %s", args, toolText(r))
		}
	}

	// ask: the answer with citations, stored as the key owner's conversation, on the mcp channel.
	var ans mcpserver.AskResult
	res = callTool(t, cs, "ask", map[string]any{"agent": ag.Slug, "question": "Where do students buy a parking permit?"}, &ans)
	if res.IsError || ans.Agent != ag.Slug || ans.Answer == "" || ans.Conversation == "" || ans.Citations == nil {
		t.Fatalf("ask = %+v %s", ans, toolText(res))
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE channel = 'mcp' AND agent_id = $1`, ag.Id); n != 1 {
		t.Errorf("mcp answers = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'chat_tokens_in' AND metadata->>'channel' = 'mcp'`); n != 1 {
		t.Errorf("mcp chat usage = %d", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action = 'mcp.ask' AND actor_kind = 'api_key' AND target_id = $1
		AND metadata->>'agent' = $2 AND metadata->>'outcome' = 'ok' AND metadata ? 'results' AND metadata::text NOT LIKE '%permit%'`, ag.Id.String(), ag.Slug); n != 1 {
		t.Errorf("mcp.ask audit entries = %d", n)
	}
	// A follow-up continues the conversation.
	var next mcpserver.AskResult
	res = callTool(t, cs, "ask", map[string]any{"agent": ag.Slug, "question": "And how much is it?", "conversation": ans.Conversation}, &next)
	if res.IsError || next.Conversation != ans.Conversation {
		t.Fatalf("follow-up = %+v %s", next, toolText(res))
	}
	if n := env.scalar(t, `SELECT count(*) FROM conversations c JOIN messages m ON m.conversation_id = c.id WHERE c.agent_id = $1`, ag.Id); n != 4 {
		t.Errorf("stored messages = %d", n)
	}

	// The handle belongs to the key: another key of the same person, or a forged one, gets nothing.
	other := createKey(t, env.member, env.base, map[string]any{"name": "other", "scopes": []string{"mcp"}})
	cs2 := mustConnect(t, url, other.Secret, "")
	for _, handle := range []string{ans.Conversation, "c1_forged", "not-a-handle"} {
		r := callTool(t, cs2, "ask", map[string]any{"agent": ag.Slug, "question": "And how much is it?", "conversation": handle}, nil)
		if !r.IsError || !strings.Contains(toolText(r), "wasn't found") {
			t.Errorf("handle %q from another key = %s", handle, toolText(r))
		}
	}

	// A service key keeps no conversations: no handle, and a follow-up is refused.
	service := createKey(t, env.owner, env.base, map[string]any{"name": "svc", "kind": "service", "scopes": []string{"mcp"}})
	cs3 := mustConnect(t, url, service.Secret, "")
	var stateless mcpserver.AskResult
	if r := callTool(t, cs3, "ask", map[string]any{"agent": ag.Slug, "question": "Where do students buy a parking permit?"}, &stateless); r.IsError || stateless.Conversation != "" {
		t.Errorf("service ask = %+v %s", stateless, toolText(r))
	}
	if r := callTool(t, cs3, "ask", map[string]any{"agent": ag.Slug, "question": "More?", "conversation": ans.Conversation}, nil); !r.IsError {
		t.Errorf("service follow-up = %s", toolText(r))
	}
}

func TestMCPKeyLimits(t *testing.T) {
	env := newAgentEnv(t)
	url := env.app.URL
	ag := env.publishAgent(t, "Parking helper", env.agentConfig(env.kb.Id.String()))
	setMCP(t, env.admin, true)
	var other apitypes.KnowledgeBase
	code, e := env.owner.call("POST", env.base+"/kbs", map[string]any{"name": "Staff & Faculty"}, &other, nil)
	mustCode(t, "second kb", code, e, 201, "")

	// A key limited to another knowledge base: that one only, and no agent (the agent needs Student help).
	limited := createKey(t, env.owner, env.base, map[string]any{"name": "limited", "scopes": []string{"mcp"}, "knowledgeBaseIds": []string{other.Id.String()}})
	cs := mustConnect(t, url, limited.Secret, "2025-06-18")
	names, tools := toolNames(t, cs)
	if strings.Join(names, ",") != "search" || strings.Join(schemaEnum(t, tools["search"], "knowledge_base"), ",") != "staff-faculty" {
		t.Fatalf("limited key's tools = %v %v", names, schemaEnum(t, tools["search"], "knowledge_base"))
	}
	if r := callTool(t, cs, "search", map[string]any{"knowledge_base": "student-help", "query": "parking"}, nil); !r.IsError {
		t.Errorf("search outside the key's list = %s", toolText(r))
	}
	if r, err := cs.CallTool(t.Context(), &mcp.CallToolParams{Name: "ask", Arguments: map[string]any{"agent": ag.Slug, "question": "Hi"}}); err == nil && !r.IsError {
		t.Errorf("ask without agents = %s", toolText(r))
	}

	// Classification: a level whose keys may not retrieve directly takes the knowledge base off the list.
	key := createKey(t, env.owner, env.base, map[string]any{"name": "all", "scopes": []string{"mcp", "query"}})
	var levels []apitypes.Classification
	env.admin.get("/v1/classifications", &levels)
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"directRetrieve": false}, nil, ifMatch(levels[0].Revision))
	mustCode(t, "no direct retrieve", code, e, 200, "")
	cs = mustConnect(t, url, key.Secret, "")
	if got := schemaEnum(t, mustTool(t, cs, "search"), "knowledge_base"); strings.Join(got, ",") != "staff-faculty" {
		t.Errorf("searchable under the ceiling = %v", got)
	}
	if r := callTool(t, cs, "search", map[string]any{"knowledge_base": "student-help", "query": "parking"}, nil); !r.IsError {
		t.Errorf("search above the ceiling = %s", toolText(r))
	}
	env.admin.get("/v1/classifications", &levels)
	code, e = env.admin.call("PATCH", "/v1/admin/classifications/open", map[string]any{"directRetrieve": true}, nil, ifMatch(levels[0].Revision))
	mustCode(t, "direct retrieve again", code, e, 200, "")

	// Budgets: at 100%, search and ask are tool errors that say why, and nothing is recorded as spent.
	today := time.Now().UTC().Format(time.DateOnly)
	code, e = env.admin.call("POST", "/v1/admin/models/"+env.chat.Id.String()+"/prices", map[string]any{"effectiveFrom": today,
		"prices": []any{map[string]any{"unit": "chat_tokens_in", "price": "1000000"}, map[string]any{"unit": "chat_tokens_out", "price": "1000000"}}}, nil, nil)
	mustCode(t, "prices", code, e, 201, "")
	setCostSettings(t, env.admin, "enforce")
	setTeamBudget(t, env.admin, env.team, "inherit", "1000000")
	if r := callTool(t, cs, "ask", map[string]any{"agent": ag.Slug, "question": "Where do students buy a parking permit?"}, nil); r.IsError {
		t.Fatalf("ask under budget = %s", toolText(r))
	}
	var sp apitypes.TeamSpend
	env.owner.get(env.base+"/spend", &sp)
	setTeamBudget(t, env.admin, env.team, "inherit", *sp.Status.Spent)
	for _, call := range []struct {
		tool string
		args map[string]any
	}{
		{"search", map[string]any{"knowledge_base": "student-help", "query": "parking"}},
		{"ask", map[string]any{"agent": ag.Slug, "question": "Where do students buy a parking permit?"}},
	} {
		r := callTool(t, cs, call.tool, call.args, nil)
		if !r.IsError || !strings.Contains(strings.ToLower(toolText(r)), "budget") {
			t.Errorf("%s at 100%% = %+v %s", call.tool, r, toolText(r))
		}
	}
	if n := env.scalar(t, `SELECT count(*) FROM audit_log WHERE action LIKE 'mcp.%' AND metadata->>'outcome' = 'refused'
		AND metadata->>'error' = 'budget_exhausted'`); n != 2 {
		t.Errorf("refusals audited = %d", n)
	}
}

// mustTool is one listed tool.
func mustTool(t *testing.T, cs *mcp.ClientSession, name string) *mcp.Tool {
	t.Helper()
	_, tools := toolNames(t, cs)
	if tools[name] == nil {
		t.Fatalf("no %s tool", name)
	}
	return tools[name]
}

// TestMCPClaims: with SystemOne citation checks on, ask returns the claims
// and their verdicts.
func TestMCPClaims(t *testing.T) {
	env, ag := claimsEnv(t)
	setMCP(t, env.admin, true)
	key := createKey(t, env.member, env.base, map[string]any{"name": "assistant", "scopes": []string{"mcp"}})
	cs := mustConnect(t, env.app.URL, key.Secret, "")
	var ans mcpserver.AskResult
	res := callTool(t, cs, "ask", map[string]any{"agent": ag.Slug, "question": "What does a transcript cost?"}, &ans)
	if res.IsError || len(ans.Citations) != 2 || len(ans.Claims) != 3 {
		t.Fatalf("ask = %+v %s", ans, toolText(res))
	}
	var got []string
	for _, c := range ans.Claims {
		got = append(got, c.Verdict+": "+c.Text)
	}
	if !slicesEqual(got, wantClaims) || !strings.Contains(toolText(res), "Claims checked: 1 of 3 supported.") {
		t.Errorf("claims = %q, text %q", got, toolText(res))
	}
}
