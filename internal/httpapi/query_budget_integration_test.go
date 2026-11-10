package httpapi_test

import (
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Query budgets: how many round trips to the database one request makes on the paths that carry the load (a batch is
// one). A request's latency before the first model call is mostly these, one after another, so the counts are kept
// from growing unnoticed. A budget is a ceiling with a little room, not a target: when a change needs more, read the
// list this test prints, make sure each statement is needed, and raise the number in the same change. Before the
// first pass over these paths a follow-up question made 64, a public question 95 and a search 24.
const (
	budgetChatFollowUp = 54 // a signed-in question in an existing conversation
	budgetPublicChat   = 55 // an anonymous visitor's question on a public agent
	budgetRetrieve     = 21 // POST .../kbs/{id}/retrieve
)

func TestQueryBudgets(t *testing.T) {
	env := newPublishEnv(t)
	ag := env.publishAgent(t, "Budget", env.agentConfig(env.kb.Id.String()))
	pub := env.publicAgent(t, "Budget public")
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
