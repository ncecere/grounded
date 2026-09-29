package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
)

// Answer behaviour found in the v0.2 review: model punctuation (M2),
// follow-ups searched on their own (M3) and verification per marker.

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

// markerVerifications lists each citation's per-marker verifications.
func markerVerifications(cites []apitypes.Citation) map[int][]string {
	out := map[int][]string{}
	for _, c := range cites {
		if c.Markers == nil {
			continue
		}
		for _, m := range *c.Markers {
			out[c.N] = append(out[c.N], string(m.Verification))
		}
	}
	return out
}

// uncitedText is the text of each uncited sentence.
func uncitedText(text string, spans *[]apitypes.UncitedSentence) []string {
	if spans == nil {
		return nil
	}
	runes := []rune(text)
	var out []string
	for _, s := range *spans {
		out = append(out, string(runes[s.Start:s.End]))
	}
	return out
}

// TestVerificationPerMarker: with citation checks on, each [n] marker gets
// the verdict of its own sentence (streamed, stored and over the
// OpenAI-compatible endpoint), and a factual sentence without a citation
// is listed as uncited and counted in the record.
func TestVerificationPerMarker(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putChecks(t, nil, nil)
	kb := env.checksKB(t, "Fees", mixedCiteDocs)
	ag := env.publishAgent(t, "Fees", env.agentConfig(kb.Id.String()))
	env.proxy.SetAnswer("Official transcripts cost ten dollars per copy [1]. Rush orders UNSUPPORTED arrive the same day [1]. " +
		"Pick them up at the front desk.")
	t.Cleanup(func() { env.proxy.SetAnswer("") })
	wantMarkers := map[int][]string{1: {"verified", "unsupported"}}
	wantUncited := []string{"Pick them up at the front desk."}

	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "chat", code, e, 200, "")
	var checked apitypes.ChatEventCitationsChecked
	evs.one(t, "citations_checked", &checked)
	if got := markerVerifications(checked.Citations); !equalMarkers(got, wantMarkers) || string(*checked.Citations[0].Verification) != "unsupported" {
		t.Fatalf("checked markers = %v (%+v)", got, checked.Citations)
	}
	if got := uncitedText(checked.Text, checked.Uncited); !slicesEqual(got, wantUncited) {
		t.Errorf("uncited = %q", got)
	}
	if rec := citationsRecord(t, env.agentEnv, ag.Id.String()); rec.Uncited != 1 || rec.Verified != 1 || rec.Unsupported != 1 {
		t.Errorf("record = %+v", rec)
	}
	// Stored: the markers' verdicts and the uncited sentence after a reload.
	var conv apitypes.ChatEventConversation
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+conv.ConversationId.String(), &detail)
	stored := detail.Messages[len(detail.Messages)-1]
	if got := markerVerifications(*stored.Citations); !equalMarkers(got, wantMarkers) || !slicesEqual(uncitedText(stored.Text, stored.Uncited), wantUncited) {
		t.Errorf("stored = %v %+v", got, stored.Uncited)
	}

	// The OpenAI-compatible endpoint: citations[].markers per marker.
	var k apitypes.APIKeyCreated
	code, e = env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	code, raw, _ := openaiCall(t, env.app.URL, k.Secret, map[string]any{"model": "agent:" + env.team + "/" + ag.Slug,
		"messages": []map[string]any{{"role": "user", "content": "What does a transcript cost?"}}})
	var comp struct{ Citations []apitypes.Citation }
	if code != 200 || json.Unmarshal(raw, &comp) != nil {
		t.Fatalf("completion = %d %s", code, raw)
	}
	if got := markerVerifications(comp.Citations); !equalMarkers(got, wantMarkers) {
		t.Errorf("openai markers = %v (%s)", got, raw)
	}
}

func equalMarkers(a, b map[int][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if !slicesEqual(v, b[k]) {
			return false
		}
	}
	return true
}

func slicesEqual(a, b []string) bool {
	return strings.Join(a, "\x00") == strings.Join(b, "\x00") && len(a) == len(b)
}
