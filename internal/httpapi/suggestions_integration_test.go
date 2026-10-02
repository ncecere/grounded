package httpapi_test

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

const permitQuestion = "Where do students buy a parking permit?"

// suggestionsOf returns the suggestions event's list (nil without one).
func suggestionsOf(t *testing.T, evs sseEvents) []string {
	t.Helper()
	if len(evs.all("suggestions")) == 0 {
		return nil
	}
	var s apitypes.ChatEventSuggestions
	evs.one(t, "suggestions", &s)
	return s.Suggestions
}

// suggestCalls counts the follow-up suggestion calls the fake gateway got.
func suggestCalls(env *agentEnv) int { return len(env.proxy.SuggestionRequests()) }

// TestFollowUpSuggestions: an answer with citations gets up to 3 follow-up
// questions after message_end, before done, from a separate call that
// reads the question, the answer and the passages' titles and headings;
// they are metered as chat tokens with the feature suggestions. None after
// a refusal, an answer without citations, with the setting off, or for
// JSON replies and the OpenAI-compatible endpoint; the reply is parsed
// defensively.
func TestFollowUpSuggestions(t *testing.T) {
	env := newAgentEnv(t)
	ag := env.publishAgent(t, "Help", env.agentConfig(env.kb.Id.String()))
	if ag.Draft.FollowUpSuggestions == nil || !*ag.Draft.FollowUpSuggestions {
		t.Fatalf("a new agent's followUpSuggestions = %v, want on", ag.Draft.FollowUpSuggestions)
	}

	code, evs, e := env.member.stream(env.chatPath("help"), map[string]any{"message": permitQuestion})
	mustCode(t, "chat", code, e, 200, "")
	if names := strings.Join(evs.names(), ","); !strings.HasSuffix(names, "message_end,suggestions,done") {
		t.Fatalf("events = %s", names)
	}
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	var ev apitypes.ChatEventSuggestions
	evs.one(t, "suggestions", &ev)
	if ev.MessageId != end.MessageId || len(ev.Suggestions) == 0 || len(ev.Suggestions) > 3 ||
		ev.Suggestions[0] != testutil.FakeSuggestion("Parking") || end.CitationsPending != nil {
		t.Fatalf("suggestions = %+v (message_end %+v)", ev, end)
	}
	reqs := env.proxy.SuggestionRequests()
	if len(reqs) != 1 {
		t.Fatalf("suggestion calls = %d", len(reqs))
	}
	var body struct {
		MaxTokens int `json:"max_tokens"`
		Messages  []struct{ Role, Content string }
		Tools     []any
	}
	_ = json.Unmarshal(reqs[0], &body)
	if body.MaxTokens != 1024 || len(body.Tools) != 0 || len(body.Messages) != 2 || !strings.Contains(body.Messages[1].Content, "Question: "+permitQuestion) ||
		!strings.Contains(body.Messages[1].Content, "- Parking") || strings.Contains(body.Messages[1].Content, "[1]") {
		t.Errorf("suggestion request = %s", reqs[0])
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE agent_id = $1 AND kind IN ('chat_tokens_in', 'chat_tokens_out')
		AND metadata->>'feature' = 'suggestions' AND metadata->>'channel' = 'ui' AND quantity > 0`, ag.Id); n != 2 {
		t.Errorf("suggestion usage events = %d, want 2", n)
	}

	// The reply is read defensively: labels, markers, emphasis, duplicates,
	// the question asked and over-long lines are dropped; at most 3 are kept.
	env.proxy.SetSuggestions("Here are some ideas:\n1. **How much does a permit cost?** [1]\n- How much does a permit cost\n" + permitQuestion +
		"\n- " + strings.Repeat("very ", 40) + "long?\n- Where can visitors park?\n- Can I get a refund?\n- Is there a night permit?")
	_, evs, _ = env.member.stream(env.chatPath("help"), map[string]any{"message": permitQuestion})
	want := []string{"How much does a permit cost?", "Where can visitors park?", "Can I get a refund?"}
	if got := suggestionsOf(t, evs); !slices.Equal(got, want) {
		t.Errorf("parsed suggestions = %q, want %q", got, want)
	}
	env.proxy.SetSuggestions("")

	// NONE: no event (the call was made).
	before := suggestCalls(env)
	_, evs, _ = env.member.stream(env.chatPath("help"), map[string]any{"message": permitQuestion + " " + testutil.FakeNoSuggestions})
	if suggestionsOf(t, evs) != nil || suggestCalls(env) != before+1 {
		t.Errorf("NONE: suggestions %v, calls %d", suggestionsOf(t, evs), suggestCalls(env)-before)
	}

	// No call after a refusal or an answer without citations.
	for name, answer := range map[string]string{"refusal": testutil.FakeRefusal, "uncited": "Permits are sold by Transportation Services."} {
		env.proxy.SetAnswer(answer)
		before := suggestCalls(env)
		_, evs, _ = env.member.stream(env.chatPath("help"), map[string]any{"message": permitQuestion})
		if suggestionsOf(t, evs) != nil || suggestCalls(env) != before {
			t.Errorf("%s: suggestions %v, calls %d", name, suggestionsOf(t, evs), suggestCalls(env)-before)
		}
	}
	env.proxy.SetAnswer("")

	// No call for JSON replies or the OpenAI-compatible endpoint.
	before = suggestCalls(env)
	var ans apitypes.ChatAnswer
	code, e = env.member.call("POST", env.chatPath("help"), map[string]any{"message": permitQuestion, "stream": false}, &ans, nil)
	mustCode(t, "json chat", code, e, 200, "")
	var k apitypes.APIKeyCreated
	code, e = env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	code, raw, _ := openaiCall(t, env.app.URL, k.Secret, map[string]any{"model": "agent:" + env.team + "/help", "stream": true,
		"messages": []map[string]string{{"role": "user", "content": permitQuestion}}})
	if code != 200 || strings.Contains(string(raw), "suggest") || suggestCalls(env) != before {
		t.Errorf("json and openai: %d, calls %d: %s", code, suggestCalls(env)-before, raw)
	}

	// Off for this agent: no call.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["followUpSuggestions"] = false
	off := env.publishAgent(t, "Quiet", cfg)
	if off.Draft.FollowUpSuggestions == nil || *off.Draft.FollowUpSuggestions {
		t.Fatalf("followUpSuggestions after turning it off = %v", off.Draft.FollowUpSuggestions)
	}
	before = suggestCalls(env)
	_, evs, _ = env.member.stream(env.chatPath(off.Slug), map[string]any{"message": permitQuestion})
	if suggestionsOf(t, evs) != nil || suggestCalls(env) != before {
		t.Errorf("off: suggestions %v, calls %d", suggestionsOf(t, evs), suggestCalls(env)-before)
	}
}

// TestFollowUpSuggestionsModerated: with output moderation, the
// suggestions are checked like an answer (one check for all of them,
// metered with the feature suggestions) and dropped silently when the
// check fails; the answer is untouched.
func TestFollowUpSuggestionsModerated(t *testing.T) {
	env := newModerationEnv(t)
	env.putPolicy(t, "team", env.teamPolicy(map[string]any{"outputMode": "buffer"}))
	ag := env.publishAgent(t, "Help", env.agentConfig(env.kb.Id.String()))

	env.proxy.SetSuggestions("How do I hurt someone with a permit?\nWhere can visitors park?")
	_, evs, _ := env.member.stream(env.chatPath("help"), map[string]any{"message": permitQuestion})
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if suggestionsOf(t, evs) != nil || len(evs.all("moderation")) != 0 || len(end.Citations) == 0 {
		t.Fatalf("blocked suggestions: %v, moderation events %d, answer %+v", suggestionsOf(t, evs), len(evs.all("moderation")), end)
	}

	env.proxy.SetSuggestions("")
	_, evs, _ = env.member.stream(env.chatPath("help"), map[string]any{"message": permitQuestion})
	if got := suggestionsOf(t, evs); len(got) == 0 {
		t.Fatalf("passing suggestions = %v", got)
	}
	if n := env.scalar(t, `SELECT coalesce(sum(quantity), 0) FROM usage_events WHERE agent_id = $1 AND kind = 'moderation_requests'
		AND metadata->>'feature' = 'suggestions'`, ag.Id); n != 2 {
		t.Errorf("metered suggestion checks = %d, want 2", n)
	}
}

// TestFollowUpSuggestionsSaved: a saved answer stores its suggestions and
// replays them without a call.
func TestFollowUpSuggestionsSaved(t *testing.T) {
	env := newCacheEnv(t, newAgentEnv(t))
	_, evs, _ := env.member.stream(env.chatPath(env.agent.Slug), map[string]any{"message": cacheQuestion})
	first := suggestionsOf(t, evs)
	if len(first) == 0 || env.entries(t) != 1 {
		t.Fatalf("first answer: suggestions %v, entries %d", first, env.entries(t))
	}
	before := suggestCalls(env.agentEnv)
	_, evs, _ = env.editor.stream(env.chatPath(env.agent.Slug), map[string]any{"message": cacheQuestion})
	names := strings.Join(evs.names(), ",")
	if got := suggestionsOf(t, evs); !slices.Equal(got, first) || suggestCalls(env.agentEnv) != before || !strings.HasSuffix(names, "message_end,suggestions,done") {
		t.Errorf("replay: suggestions %v (want %v), calls %d, events %s", got, first, suggestCalls(env.agentEnv)-before, names)
	}
}
