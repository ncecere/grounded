package httpapi_test

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/moderation"
)

// Answers streamed in checked paragraphs (docs/v0.4.0.md §4).

var permitParagraphs = []string{
	"Parking permits are sold online through the parking office [1].",
	"A semester permit costs less than paying every day [1].",
	"Bring your student card when you collect the permit [1].",
	"The office is closed on public holidays [1].",
}

func joinParagraphs(ps ...string) string { return strings.Join(ps, "\n\n") }

// checkedAnswer is one streamed answer and the moderation calls it made.
type checkedAnswer struct {
	evs   sseEvents
	start apitypes.ChatEventMessageStart
	end   apitypes.ChatEventMessageEnd
	calls int
}

func (env *moderationEnv) askChecked(t *testing.T, slug, question string) checkedAnswer {
	t.Helper()
	before := env.proxy.ModerationRequests()
	code, evs, e := env.member.stream(env.chatPath(slug), map[string]any{"message": question})
	mustCode(t, "checked chat", code, e, 200, "")
	a := checkedAnswer{evs: evs, calls: env.proxy.ModerationRequests() - before}
	evs.one(t, "message_start", &a.start)
	evs.one(t, "message_end", &a.end)
	if a.start.Mode == nil || *a.start.Mode != "stream_checked" || (a.start.Buffered != nil && *a.start.Buffered) || len(evs.all("thinking_delta")) != 0 {
		t.Fatalf("message_start = %+v, thinking deltas %d", a.start, len(evs.all("thinking_delta")))
	}
	return a
}

// textAfter reports whether a text_delta follows the named event.
func (evs sseEvents) textAfter(name string) bool {
	names := evs.names()
	i := slices.Index(names, name)
	return i >= 0 && slices.Contains(names[i+1:], "text_delta")
}

// TestCheckedParagraphs: each paragraph is checked with everything before
// it and released in order; a failing paragraph replaces the whole answer
// and is stored withheld; an outage in the middle fails closed; a long
// paragraph is cut at sentence ends; JSON answers are checked once; the
// extra checks are metered.
func TestCheckedParagraphs(t *testing.T) {
	env := newModerationEnv(t)
	env.putPolicy(t, "team", env.teamPolicy(map[string]any{"outputMode": "stream_checked", "failClosed": true}))
	ag := env.publishAgent(t, "Help", env.agentConfig(env.kb.Id.String()))
	const question = "Where do students buy a parking permit?"

	// Every paragraph passes: four checks of the answer so far, four releases, the whole text.
	env.proxy.SetAnswer(joinParagraphs(permitParagraphs...))
	a := env.askChecked(t, "help", question)
	if got := a.evs.text("text_delta"); got != joinParagraphs(permitParagraphs...) || len(a.evs.all("text_delta")) != 4 ||
		a.end.Text != got || len(a.end.Citations) == 0 || len(a.evs.all("moderation")) != 0 {
		t.Fatalf("passed: deltas %d %q, end %+v", len(a.evs.all("text_delta")), got, a.end)
	}
	if a.calls != 5 { // the question, then one check per paragraph
		t.Errorf("moderation calls = %d, want 5", a.calls)
	}
	if rec := lastRecord(t, env.agentEnv, "moderation_output", ag.Id.String()); !strings.Contains(rec, `"checks": 4`) || !strings.Contains(rec, `"decision": "pass"`) {
		t.Errorf("output record = %s", rec)
	}
	if n := env.scalar(t, `SELECT coalesce(sum(quantity), 0) FROM usage_events WHERE agent_id = $1 AND kind = 'moderation_requests'`, ag.Id); n != 5 {
		t.Errorf("metered moderation requests = %d, want 5", n)
	}

	// Paragraph 3 fails: paragraphs 1 and 2 were shown, then the notice replaces the whole answer; the 4th is never
	// checked or sent, and the answer is stored withheld.
	env.proxy.SetAnswer(joinParagraphs(permitParagraphs[0], permitParagraphs[1], "Never hurt someone over a parking space UNSAFE-VIOLENCE [1].", permitParagraphs[3]))
	a = env.askChecked(t, "help", question)
	var mod apitypes.ChatEventModeration
	a.evs.one(t, "moderation", &mod)
	if got := a.evs.text("text_delta"); got != joinParagraphs(permitParagraphs[:2]...)+"\n\n" || a.evs.textAfter("moderation") {
		t.Fatalf("released before the failing paragraph = %q (events %v)", got, a.evs.names())
	}
	if mod.Stage != "output" || mod.Action != "retracted" || mod.Category == nil || *mod.Category != "violence" ||
		a.end.Text != moderation.DefaultNotice || len(a.end.Citations) != 0 || a.calls != 4 {
		t.Fatalf("moderation %+v, end %+v, calls %d", mod, a.end, a.calls)
	}
	if n := env.scalar(t, `SELECT count(*) FROM messages WHERE id = $1 AND error_code = 'moderation_withheld'`, a.end.MessageId); n != 1 {
		t.Error("the answer isn't stored withheld")
	}
	if n := env.scalar(t, `SELECT count(*) FROM messages WHERE content::text LIKE '%UNSAFE-VIOLENCE%' OR (id = $1 AND content::text LIKE '%permit%')`,
		a.end.MessageId); n != 0 {
		t.Errorf("the withheld answer's text is stored (%d)", n)
	}
	if rec := lastRecord(t, env.agentEnv, "moderation_output", ag.Id.String()); !strings.Contains(rec, `"checks": 3`) || !strings.Contains(rec, `"decision": "block"`) {
		t.Errorf("output record = %s", rec)
	}

	// The provider fails after the first paragraph's check: fail closed, nothing more is shown.
	env.proxy.SetAnswer(joinParagraphs(permitParagraphs...))
	env.proxy.FailModerationAfter(2, 500) // the question and paragraph 1 answer
	a = env.askChecked(t, "help", question)
	env.proxy.FailModerationWith(0)
	a.evs.one(t, "moderation", &mod)
	if got := a.evs.text("text_delta"); got != permitParagraphs[0]+"\n\n" || mod.Action != "unavailable" || a.end.Text != moderation.UnavailableNotice ||
		a.evs.textAfter("moderation") {
		t.Fatalf("outage: deltas %q, moderation %+v, end %q", got, mod, a.end.Text)
	}
	if n := env.scalar(t, `SELECT count(*) FROM messages WHERE id = $1 AND error_code = 'moderation_unavailable'`, a.end.MessageId); n != 1 {
		t.Error("the answer isn't stored as unavailable")
	}

	// One long paragraph is cut at sentence ends (about 800 characters each).
	long := strings.TrimSpace(strings.Repeat("Students renew parking permits online before they expire [1]. ", 40))
	env.proxy.SetAnswer(long)
	a = env.askChecked(t, "help", question)
	deltas := a.evs.all("text_delta")
	if a.evs.text("text_delta") != long || len(deltas) < 3 {
		t.Fatalf("long paragraph: %d deltas", len(deltas))
	}
	for _, d := range deltas[:len(deltas)-1] {
		var p struct{ Delta string }
		_ = json.Unmarshal(d.data, &p)
		if !strings.HasSuffix(p.Delta, "expire [1]. ") || len(p.Delta) > 900 {
			t.Errorf("chunk of %d characters ends %q", len(p.Delta), p.Delta[max(0, len(p.Delta)-16):])
		}
	}

	// A JSON answer streams nothing: it is checked once, whole.
	env.proxy.SetAnswer(joinParagraphs(permitParagraphs...))
	before := env.proxy.ModerationRequests()
	var ans apitypes.ChatAnswer
	code, e := env.member.call("POST", env.chatPath("help"), map[string]any{"message": question, "stream": false}, &ans, nil)
	mustCode(t, "json", code, e, 200, "")
	if calls := env.proxy.ModerationRequests() - before; calls != 2 || ans.Text != joinParagraphs(permitParagraphs...) {
		t.Errorf("JSON: %d moderation calls, text %q", calls, ans.Text)
	}
}

// TestCheckedParagraphsSavedAnswer: a checked answer that passed is saved,
// and its replay is sent whole, not checked again.
func TestCheckedParagraphsSavedAnswer(t *testing.T) {
	env := newModerationEnv(t)
	env.putPolicy(t, "team", env.teamPolicy(map[string]any{"outputMode": "stream_checked", "failClosed": true}))
	cache := newCacheEnv(t, env.agentEnv)
	env.proxy.SetAnswer(joinParagraphs(permitParagraphs...))

	first := env.askChecked(t, cache.agent.Slug, cacheQuestion)
	if len(first.evs.all("text_delta")) != 4 || cache.entries(t) != 1 {
		t.Fatalf("first: %d deltas, %d saved", len(first.evs.all("text_delta")), cache.entries(t))
	}
	before, chats := env.proxy.ModerationRequests(), len(env.proxy.ChatRequests())
	code, evs, e := env.member.stream(env.chatPath(cache.agent.Slug), map[string]any{"message": cacheQuestion})
	mustCode(t, "replay", code, e, 200, "")
	var start apitypes.ChatEventMessageStart
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_start", &start)
	evs.one(t, "message_end", &end)
	if len(evs.all("text_delta")) != 1 || evs.text("text_delta") != first.end.Text || end.Text != first.end.Text || len(end.Citations) == 0 {
		t.Fatalf("replay: events %v, text %q", evs.names(), evs.text("text_delta"))
	}
	if env.proxy.ModerationRequests() != before || len(env.proxy.ChatRequests()) != chats || start.Mode != nil {
		t.Errorf("replay checked again (%d calls) or called the model, mode %v", env.proxy.ModerationRequests()-before, start.Mode)
	}
	// A withheld answer is never saved.
	env.proxy.SetAnswer(joinParagraphs(permitParagraphs[0], "UNSAFE-VIOLENCE [1]."))
	a := env.askChecked(t, cache.agent.Slug, "Where can a student buy a parking permit online?")
	if len(a.evs.all("moderation")) != 1 || cache.entries(t) != 1 {
		t.Errorf("withheld answer: moderation %d, saved %d", len(a.evs.all("moderation")), cache.entries(t))
	}
}

// TestCheckedParagraphsCitationChecks: the citations are checked after the
// last paragraph, as for streamed answers; claims and verdicts follow
// message_end.
func TestCheckedParagraphsCitationChecks(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putChecks(t, nil, nil)
	var cur apitypes.ModerationPolicy
	env.admin.get("/v1/admin/moderation/policies/team", &cur)
	code, e := env.admin.call("PUT", "/v1/admin/moderation/policies/team", map[string]any{
		"modelId": env.judge.Id, "outputMode": "stream_checked", "failClosed": true,
		"categories": map[string]any{"self_harm": rules(rule("block", 0.5), rule("block", 0.5))},
	}, nil, ifMatch(cur.Revision))
	mustCode(t, "checked policy", code, e, 200, "")
	kb := env.checksKB(t, "Fees", mixedCiteDocs)
	env.publishAgent(t, "Fees", env.agentConfig(kb.Id.String()))

	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "checked with citation checks", code, e, 200, "")
	names := evs.names()
	lastText, end, checked := -1, slices.Index(names, "message_end"), slices.Index(names, "citations_checked")
	for i, n := range names {
		if n == "text_delta" {
			lastText = i
		}
	}
	if len(evs.all("text_delta")) < 2 || lastText < 0 || lastText > end || end > checked {
		t.Fatalf("events = %v", names)
	}
	var cc apitypes.ChatEventCitationsChecked
	evs.one(t, "citations_checked", &cc)
	want := map[string]string{"fee": "verified", "rush": "unsupported", "free": "contradicted"}
	if got := verifications(cc.Citations); !equalMaps(got, want) || cc.Claims == nil || len(*cc.Claims) != 3 {
		t.Fatalf("citations_checked: %v, claims %v", got, cc.Claims)
	}
}
