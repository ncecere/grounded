package httpapi_test

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Query budgets: how many round trips to the database one request makes on the paths that carry the load (a batch is
// one). A request's latency before the first model call is mostly these, so the counts are kept from growing
// unnoticed. A budget is a ceiling with a little room, not a target: when a change needs more, read the list this test
// prints, make sure each statement is needed, and raise the number in the same change. Before the first pass over these
// paths a follow-up question made 64, a public question 95 and a search 24; #248 took them to 51, 52 and 19, and #251
// (settings cached briefly, internal/ttlcache) to 44, 44 and 16, with an MCP search going from 31 to 24. Since #251
// the steps before the first model call also run concurrently (internal/agents/preflight.go), so the wait is no longer
// their sum; the counts still measure the load on the database.
const (
	budgetChatFollowUp = 47 // a signed-in question in an existing conversation
	budgetPublicChat   = 47 // an anonymous visitor's question on a public agent
	budgetRetrieve     = 18 // POST .../kbs/{id}/retrieve
	budgetMCPList      = 15 // MCP tools/list with an API key (one knowledge base, one agent)
	budgetMCPSearch    = 27 // MCP tools/call search with an API key
)

func TestQueryBudgets(t *testing.T) {
	env := newPublishEnv(t)
	ag := env.publishAgent(t, "Budget", env.agentConfig(env.kb.Id.String()))
	pub := env.publicAgent(t, "Budget public")
	setMCP(t, env.admin, true)
	key := createKey(t, env.member, env.base, map[string]any{"name": "budget", "scopes": []string{"mcp"}})
	mcpList := map[string]any{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
	mcpSearch := map[string]any{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": map[string]any{
		"name": "search", "arguments": map[string]any{"knowledge_base": "student-help", "query": "parking permit"}}}
	mcpCall := func(what string, body any) {
		t.Helper()
		if res, e := mcpRaw(t, env.app.URL, "POST", key.Secret, body); res.StatusCode != 200 || e.Error.Code != 0 {
			t.Fatalf("%s = %d %+v", what, res.StatusCode, e)
		}
	}
	if err := env.app.stopWorker(); err != nil { // background work would be counted too
		t.Fatal(err)
	}
	code, evs, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Where can students park?"})
	mustCode(t, "first question", code, e, 200, "")
	var conv struct{ ConversationId *string }
	evs.one(t, "conversation", &conv)
	anon := newVisitor(t, env.app.URL)
	if code, e := anon.start(pub.Id, "", ""); code != 201 && code != 200 {
		t.Fatalf("session = %d %s", code, e)
	}
	if code, _, e := anon.ask(pub.Id, "Where can students park?"); code != 200 {
		t.Fatalf("public first question = %d %s", code, e)
	}

	measure := func(name string, budget int, request func()) {
		t.Helper()
		request() // once unmeasured, just before: the settings cached for a few seconds are warm, as under load
		env.app.queries.start()
		request()
		sql := env.app.queries.stop()
		if len(sql) > budget {
			t.Errorf("%s made %d round trips, budget %d:\n%s", name, len(sql), budget, statementCounts(sql))
		}
	}
	measure("chat follow-up", budgetChatFollowUp, func() {
		code, _, e := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "And when do the halls open?", "conversationId": *conv.ConversationId})
		mustCode(t, "follow-up", code, e, 200, "")
	})
	measure("public chat", budgetPublicChat, func() {
		if code, _, e := anon.ask(pub.Id, "When do residence halls open?"); code != 200 {
			t.Fatalf("public question = %d %s", code, e)
		}
	})
	measure("mcp tools/list", budgetMCPList, func() { mcpCall("tools/list", mcpList) })
	measure("mcp search", budgetMCPSearch, func() { mcpCall("search", mcpSearch) })
	measure("retrieve", budgetRetrieve, func() {
		var res apitypes.RetrieveResult
		code, e := env.member.call("POST", env.base+"/kbs/"+env.kb.Id.String()+"/retrieve", map[string]any{"query": "parking permit", "topK": 5}, &res, nil)
		mustCode(t, "retrieve", code, e, 200, "")
	})
}

// statementCounts lists each distinct statement with how often it ran, most frequent first.
func statementCounts(sql []string) string {
	counts := map[string]int{}
	for _, s := range sql {
		s = strings.Join(strings.Fields(s), " ")
		if name, _, ok := strings.Cut(s, " :"); ok && strings.HasPrefix(s, "-- name: ") {
			s = name
		} else if len(s) > 90 {
			s = s[:90]
		}
		counts[s]++
	}
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		if counts[keys[i]] != counts[keys[j]] {
			return counts[keys[i]] > counts[keys[j]]
		}
		return keys[i] < keys[j]
	})
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "  %3d  %s\n", counts[k], k)
	}
	return b.String()
}
