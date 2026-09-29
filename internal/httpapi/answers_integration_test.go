package httpapi_test

import (
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Answer behaviour found in the v0.2 review: model punctuation (M2) and
// follow-ups searched on their own (M3).

// TestAnswerPunctuationNormalised: the final text of an answer has plain
// hyphens and spaces (stored and in message_end), whatever the model wrote.
func TestAnswerPunctuationNormalised(t *testing.T) {
	env := newAgentEnv(t)
	env.publishAgent(t, "Punctuation", env.agentConfig(env.kb.Id.String()))
	env.proxy.SetAnswer("Write to military\u2011benefits@example.edu or call 555\u2011392\u20114357 since Jan\u202f1\u202f1975\u202f【1】.")
	t.Cleanup(func() { env.proxy.SetAnswer("") })

	code, evs, e := env.member.stream(env.chatPath("punctuation"), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "chat", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	want := "Write to military-benefits@example.edu or call 555-392-4357 since Jan 1 1975 [1]."
	if end.Text != want || len(end.Citations) != 1 {
		t.Fatalf("message_end text = %q (%d citations)", end.Text, len(end.Citations))
	}
	var conv struct{ ConversationId *string }
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+*conv.ConversationId, &detail)
	if n := len(detail.Messages); n != 2 || detail.Messages[1].Text != want {
		t.Fatalf("stored = %+v", detail.Messages)
	}
}

// TestFollowUpsAreSearchedInContext: a follow-up that the rewrite returns
// unchanged (the fake gateway repeats the message) is searched together
// with the earlier questions, on the third turn as on the second.
func TestFollowUpsAreSearchedInContext(t *testing.T) {
	env := newAgentEnv(t)
	env.publishAgent(t, "Follow ups", env.agentConfig(env.kb.Id.String()))
	path := env.chatPath("follow-ups")
	ask := func(message string, conversation *string) (string, *string) {
		t.Helper()
		body := map[string]any{"message": message}
		if conversation != nil {
			body["conversationId"] = *conversation
		}
		code, evs, e := env.member.stream(path, body)
		mustCode(t, message, code, e, 200, "")
		var conv struct{ ConversationId *string }
		evs.one(t, "conversation", &conv)
		var ret struct{ Query string }
		evs.one(t, "retrieval", &ret)
		return ret.Query, conv.ConversationId
	}
	first := "Where do students buy a parking permit?"
	q, conv := ask(first, nil)
	if q != first {
		t.Fatalf("first turn searched %q", q)
	}
	if q, _ = ask("How much does it cost?", conv); q != first+" How much does it cost?" {
		t.Errorf("second turn searched %q", q)
	}
	if q, _ = ask("And for a second one?", conv); q != first+" How much does it cost? And for a second one?" {
		t.Errorf("third turn searched %q", q)
	}
	// A follow-up that names its subject is searched as the model rewrote it.
	clear := "When do the residence halls open for move-in in August?"
	if q, _ = ask(clear, conv); q != clear {
		t.Errorf("a clear follow-up searched %q", q)
	}
	// The rewrite leaves room for a reasoning model's thinking.
	for _, raw := range env.proxy.ChatRequests() {
		if body := string(raw); strings.Contains(body, "standalone") && !strings.Contains(body, "_tokens\":1024") {
			t.Errorf("rewrite request = %s", body)
		}
	}
}
