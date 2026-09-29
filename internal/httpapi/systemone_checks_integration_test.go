package httpapi_test

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/agents"
	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// Documents for citation checks. The fake answers with a list of every
// source's first line when source 1's carries FAKE-LIST, and the fake
// SystemOne API judges each claim by its markers (fakesystemone.go).
var (
	mixedCiteDocs = []upload{
		{"fee.txt", []byte("FAKE-LIST Official transcripts cost ten dollars per copy.\n")},
		{"rush.txt", []byte("FAKE-LIST UNSUPPORTED Rush orders arrive the same day.\n")},
		{"free.txt", []byte("FAKE-LIST CONTRADICTED Transcripts are free for alumni.\n")},
	}
	unsupportedCiteDocs = []upload{{"hours.txt", []byte("UNSUPPORTED The office opens at 7 am.\n")}}
)

// checksKB creates a knowledge base over its own source with docs.
func (env *systemOneEnv) checksKB(t *testing.T, name string, docs []upload) apitypes.KnowledgeBase {
	t.Helper()
	var src apitypes.DataSource
	code, e := env.owner.call("POST", env.base+"/sources", map[string]any{"name": name, "classification": "open"}, &src, nil)
	mustCode(t, "source", code, e, 201, "")
	path := env.base + "/sources/" + src.Id.String() + "/documents"
	env.owner.uploadFiles(path, docs, "")
	env.owner.waitForDocuments(t, path)
	var kb apitypes.KnowledgeBase
	code, e = env.owner.call("POST", env.base+"/kbs", map[string]any{"name": name, "topK": 5}, &kb, nil)
	mustCode(t, "kb", code, e, 201, "")
	code, e = env.owner.call("PUT", env.base+"/kbs/"+kb.Id.String()+"/sources/"+src.Id.String(), nil, nil, nil)
	mustCode(t, "attach", code, e, 200, "")
	return kb
}

// putChecks saves the platform settings with judging off and the given
// citation and scope sections over their defaults.
func (env *systemOneEnv) putChecks(t *testing.T, citations, scope map[string]any) apitypes.SystemOneSettings {
	t.Helper()
	var cur, out apitypes.SystemOneSettings
	env.admin.get("/v1/admin/systemone", &cur)
	c := map[string]any{"enabled": true, "mode": "annotate", "autoAccept": 0.8, "timeoutMs": 5000}
	for k, v := range citations {
		c[k] = v
	}
	s := map[string]any{"enabled": false, "smallTalk": 0.5, "inScope": 0.2, "timeoutMs": 5000}
	for k, v := range scope {
		s[k] = v
	}
	code, e := env.admin.call("PUT", "/v1/admin/systemone", map[string]any{"modelId": env.judge.Id, "judging": cur.Judging,
		"citations": c, "scope": s}, &out, ifMatch(cur.Revision))
	mustCode(t, "put SystemOne checks", code, e, 200, "")
	return out
}

func lastRecord(t *testing.T, env *agentEnv, column, agentID string) string {
	t.Helper()
	var raw []byte
	if err := env.app.Pool.QueryRow(t.Context(), `SELECT `+column+` FROM message_events WHERE agent_id = $1 ORDER BY id DESC LIMIT 1`, agentID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func citationsRecord(t *testing.T, env *agentEnv, agentID string) agents.CitationsRecord {
	t.Helper()
	var rec agents.CitationsRecord
	raw := lastRecord(t, env, "citations", agentID)
	if raw == "" {
		t.Fatal("no citations record")
	}
	_ = json.Unmarshal([]byte(raw), &rec)
	for _, word := range []string{"transcript", "Rush", "alumni", "FAKE"} {
		if strings.Contains(raw, word) {
			t.Errorf("citations record carries text: %s", raw)
		}
	}
	return rec
}

// verifications maps each citation's first source word to its verification.
func verifications(cites []apitypes.Citation) map[string]string {
	out := map[string]string{}
	for _, c := range cites {
		v := "-"
		if c.Verification != nil {
			v = string(*c.Verification)
		}
		switch {
		case strings.Contains(c.Snippet, "UNSUPPORTED"):
			out["rush"] = v
		case strings.Contains(c.Snippet, "CONTRADICTED"):
			out["free"] = v
		default:
			out["fee"] = v
		}
	}
	return out
}

// TestCitationChecksStreaming: annotate marks citations after message_end
// (citations_checked), stores the verdicts on the message and counts them;
// enforce removes unsupported markers and a strict agent with nothing
// supported refuses.
func TestCitationChecksStreaming(t *testing.T) {
	env := newSystemOneEnv(t)
	settings := env.putChecks(t, nil, nil)
	if !settings.Citations.Enabled || settings.Citations.Mode != "annotate" || settings.Scope.Enabled {
		t.Fatalf("settings = %+v", settings)
	}
	kb := env.checksKB(t, "Fees", mixedCiteDocs)
	ag := env.publishAgent(t, "Fees", env.agentConfig(kb.Id.String()))

	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "chat", code, e, 200, "")
	names := strings.Join(evs.names(), ",")
	if !strings.HasSuffix(names, "message_end,citations_checked,done") {
		t.Fatalf("events = %s", names)
	}
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	var checked apitypes.ChatEventCitationsChecked
	evs.one(t, "citations_checked", &checked)
	if len(end.Citations) != 3 || end.Citations[0].Verification != nil {
		t.Fatalf("message_end citations = %+v", end.Citations)
	}
	want := map[string]string{"fee": "verified", "rush": "unsupported", "free": "contradicted"}
	if got := verifications(checked.Citations); !equalMaps(got, want) || checked.Text != end.Text || checked.Refused ||
		checked.Verified != 1 || checked.Unsupported != 2 || checked.MessageId != end.MessageId {
		t.Fatalf("checked = %+v (%v)", checked, got)
	}
	if c := checked.Citations[0]; c.Confidence == nil || *c.Confidence <= 0 {
		t.Errorf("confidence = %v", c.Confidence)
	}
	// The verdicts are stored on the message.
	var conv apitypes.ChatEventConversation
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+conv.ConversationId.String(), &detail)
	stored := detail.Messages[len(detail.Messages)-1]
	if stored.Citations == nil || !equalMaps(verifications(*stored.Citations), want) {
		t.Errorf("stored citations = %+v", stored.Citations)
	}
	rec := citationsRecord(t, env.agentEnv, ag.Id.String())
	if rec.Mode != "annotate" || rec.Claims != 3 || rec.Pairs != 3 || rec.Verified != 1 || rec.Unsupported != 1 ||
		rec.Contradicted != 1 || rec.Removed != 0 || rec.Requests != 3 {
		t.Errorf("record = %+v", rec)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'systemone_tokens' AND metadata->>'feature' = 'citations'`); n != 1 {
		t.Errorf("citation usage rows = %d", n)
	}

	// Enforce (agent override): the unsupported and contradicted markers go.
	cfg := env.agentConfig(kb.Id.String())
	cfg["systemOne"] = map[string]any{"citationMode": "enforce"}
	strictAg := env.publishAgent(t, "Strict fees", cfg)
	code, evs, e = env.member.stream(env.chatPath("strict-fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "enforce", code, e, 200, "")
	evs.one(t, "citations_checked", &checked)
	evs.one(t, "message_end", &end)
	if len(checked.Citations) != 1 || verifications(checked.Citations)["fee"] != "verified" || strings.Count(checked.Text, "[") != 1 ||
		!strings.Contains(checked.Text, "Rush orders arrive the same day.") || strings.Count(end.Text, "[") != 3 {
		t.Fatalf("enforced = %q %+v", checked.Text, checked.Citations)
	}
	if rec := citationsRecord(t, env.agentEnv, strictAg.Id.String()); rec.Mode != "enforce" || rec.Removed != 2 || rec.Refused {
		t.Errorf("enforce record = %+v", rec)
	}
	evs.one(t, "conversation", &conv)
	env.member.get("/v1/conversations/"+conv.ConversationId.String(), &detail)
	if got := detail.Messages[len(detail.Messages)-1].Text; got != checked.Text {
		t.Errorf("stored text %q, want the enforced %q", got, checked.Text)
	}

	// Enforce, strict, nothing supported: the refusal replaces the answer.
	cfg = env.agentConfig(env.checksKB(t, "Hours", unsupportedCiteDocs).Id.String())
	cfg["systemOne"] = map[string]any{"citationMode": "enforce"}
	hours := env.publishAgent(t, "Hours", cfg)
	code, evs, e = env.member.stream(env.chatPath("hours"), map[string]any{"message": "When does the office open?"})
	mustCode(t, "enforce refusal", code, e, 200, "")
	evs.one(t, "citations_checked", &checked)
	if !checked.Refused || checked.Text != agents.DefaultRefusal || len(checked.Citations) != 0 {
		t.Fatalf("refusal = %+v", checked)
	}
	if rec := citationsRecord(t, env.agentEnv, hours.Id.String()); !rec.Refused || rec.Removed != 1 {
		t.Errorf("refusal record = %+v", rec)
	}
	if n := env.scalar(t, `SELECT count(*) FROM message_events WHERE agent_id = $1 AND refused`, hours.Id); n != 1 {
		t.Errorf("refused events = %d", n)
	}

	// A slow check leaves the citations unchecked.
	env.putChecks(t, map[string]any{"timeoutMs": 500}, nil)
	env.proxy.SetCitationDelay(2 * time.Second)
	code, evs, e = env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	env.proxy.SetCitationDelay(0)
	mustCode(t, "slow check", code, e, 200, "")
	evs.one(t, "citations_checked", &checked)
	if got := verifications(checked.Citations); got["fee"] != "unchecked" || got["rush"] != "unchecked" || checked.Unchecked != 3 {
		t.Errorf("slow check = %v", got)
	}

	// Analytics: support rate per agent, counts without text.
	var an apitypes.AgentAnalytics
	env.editor.get(env.base+"/agents/"+ag.Id.String()+"/analytics", &an)
	c := an.Totals.Citations
	if c.Answers != 2 || c.Pairs != 6 || c.Verified != 1 || c.Unsupported != 1 || c.Contradicted != 1 || c.Unchecked != 3 ||
		c.SupportRate == nil || *c.SupportRate < 0.33 || *c.SupportRate > 0.34 || c.LatencyP50Ms == nil {
		t.Errorf("agent citations = %+v", c)
	}
	var ov apitypes.PlatformAnalytics
	env.admin.get("/v1/admin/analytics", &ov)
	if ov.Totals.Citations.Answers != 4 || ov.Totals.Citations.Refused != 1 || ov.Totals.Citations.Removed != 3 {
		t.Errorf("platform citations = %+v", ov.Totals.Citations)
	}
	rates := map[string]*float64{}
	for _, a := range ov.TopAgents {
		rates[a.AgentSlug] = a.CitationSupportRate
	}
	if r := rates["hours"]; r == nil || *r != 0 {
		t.Errorf("support rates = %v", rates)
	}
}

func equalMaps(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

// TestCitationChecksBufferedJSONAndOpenAI: JSON and buffered answers are
// checked before release; the OpenAI endpoint annotates streamed answers
// only, and enforces on non-streamed ones.
func TestCitationChecksBufferedJSONAndOpenAI(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putChecks(t, map[string]any{"mode": "enforce"}, nil)
	kb := env.checksKB(t, "Fees", mixedCiteDocs)
	env.publishAgent(t, "Fees", env.agentConfig(kb.Id.String()))

	// JSON: enforced in the answer, no event needed.
	var ans apitypes.ChatAnswer
	code, e := env.member.call("POST", env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?", "stream": false}, &ans, nil)
	mustCode(t, "json", code, e, 200, "")
	if len(ans.Citations) != 1 || verifications(ans.Citations)["fee"] != "verified" || strings.Count(ans.Text, "[") != 1 {
		t.Fatalf("json = %q %+v", ans.Text, ans.Citations)
	}

	// OpenAI-compatible, streamed: annotated in the final chunk, text untouched.
	var k apitypes.APIKeyCreated
	code, e = env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	model := "agent:" + env.team + "/fees"
	body := map[string]any{"model": model, "stream": true, "messages": []map[string]any{{"role": "user", "content": "What does a transcript cost?"}}}
	code, raw, _ := openaiCall(t, env.app.URL, k.Secret, body)
	if code != 200 {
		t.Fatalf("openai stream = %d %s", code, raw)
	}
	var streamed strings.Builder
	var final []apitypes.Citation
	for _, line := range strings.Split(string(raw), "\n") {
		data, ok := strings.CutPrefix(line, "data: ")
		if !ok || data == "[DONE]" {
			continue
		}
		var ch struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Citations []apitypes.Citation `json:"citations"`
		}
		_ = json.Unmarshal([]byte(data), &ch)
		for _, c := range ch.Choices {
			streamed.WriteString(c.Delta.Content)
			if c.FinishReason != nil {
				final = ch.Citations
			}
		}
	}
	want := map[string]string{"fee": "verified", "rush": "unsupported", "free": "contradicted"}
	if got := verifications(final); !equalMaps(got, want) || strings.Count(streamed.String(), "[") != 3 {
		t.Fatalf("openai stream: %q, citations %v", streamed.String(), got)
	}
	// Not streamed: enforced.
	body["stream"] = false
	code, raw, _ = openaiCall(t, env.app.URL, k.Secret, body)
	var comp struct {
		Choices []struct {
			Message struct{ Content string } `json:"message"`
		} `json:"choices"`
		Citations []apitypes.Citation `json:"citations"`
	}
	_ = json.Unmarshal(raw, &comp)
	if code != 200 || len(comp.Citations) != 1 || strings.Count(comp.Choices[0].Message.Content, "[") != 1 {
		t.Fatalf("openai json = %d %s", code, raw)
	}

	// Buffer mode: checked before the text is released.
	var cur apitypes.ModerationPolicy
	env.admin.get("/v1/admin/moderation/policies/team", &cur)
	code, e = env.admin.call("PUT", "/v1/admin/moderation/policies/team", map[string]any{
		"modelId": env.judge.Id, "outputMode": "buffer", "failClosed": false,
		"categories": map[string]any{"self_harm": rules(rule("block", 0.5), rule("block", 0.5))},
	}, nil, ifMatch(cur.Revision))
	mustCode(t, "buffer policy", code, e, 200, "")
	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "buffered", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if len(evs.all("citations_checked")) != 0 || evs.text("text_delta") != end.Text || strings.Count(end.Text, "[") != 1 ||
		verifications(end.Citations)["fee"] != "verified" {
		t.Fatalf("buffered = %v %q %+v", evs.names(), evs.text("text_delta"), end.Citations)
	}
}

// goDocs are five sources for the arrays-and-slices answer.
var goDocs = []upload{
	{"faq.txt", []byte("Why are maps, slices, and channels references while arrays are values? Arrays are values in Go.\n")},
	{"effective_go.txt", []byte("Arrays are values. The size of an array is part of its type. Slices wrap arrays.\n")},
	{"spec.txt", []byte("An array is a numbered sequence of elements of a single type.\n")},
	{"tour.txt", []byte("A slice is a dynamically-sized, flexible view into the elements of an array.\n")},
	{"blog.txt", []byte("Passing a pointer to an array is possible, but slices are the idiomatic choice.\n")},
}

// goAnswer is a real answer (Qwen) with Go array types in inline code and
// a trailing citation list: `[3]int` once lost its [3] and cited source 3,
// and "Citations: [1], [2], [5]" was judged as a claim, marking correct
// sources unsupported.
const goAnswer = "In Go, arrays and slices behave differently [1].\n\n" +
	"* Arrays have a fixed length [2]. The size is part of the type (e.g., `[3]int` and `[4]int` are distinct types) [2].\n" +
	"* Arrays are values: assigning one array to another copies all the elements [1][2].\n\n" +
	"For C-like behavior with arrays, you can pass a pointer to the array, but using slices is considered more idiomatic [5].\n\n" +
	"Citations: [1], [2], [5]"

// TestCitationChecksCodeAndCitationList: through the chat path, inline
// code keeps its brackets and cites nothing, the citation list is not
// checked, and every citation verifies, in annotate and enforce modes.
func TestCitationChecksCodeAndCitationList(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putChecks(t, nil, nil)
	kb := env.checksKB(t, "Go", goDocs)
	ag := env.publishAgent(t, "Go", env.agentConfig(kb.Id.String()))
	cfg := env.agentConfig(kb.Id.String())
	cfg["systemOne"] = map[string]any{"citationMode": "enforce"}
	strict := env.publishAgent(t, "Go strict", cfg)
	env.proxy.SetAnswer(goAnswer)
	t.Cleanup(func() { env.proxy.SetAnswer("") })

	for _, tc := range []struct {
		slug, agentID string
	}{{"go", ag.Id.String()}, {"go-strict", strict.Id.String()}} {
		code, evs, e := env.member.stream(env.chatPath(tc.slug), map[string]any{"message": "How do arrays and slices differ?"})
		mustCode(t, tc.slug, code, e, 200, "")
		var end apitypes.ChatEventMessageEnd
		evs.one(t, "message_end", &end)
		var checked apitypes.ChatEventCitationsChecked
		evs.one(t, "citations_checked", &checked)
		if end.Text != goAnswer || checked.Text != goAnswer || checked.Refused {
			t.Fatalf("%s: text %q, checked %q", tc.slug, end.Text, checked.Text)
		}
		var got []string
		for _, c := range checked.Citations {
			v := "-"
			if c.Verification != nil {
				v = string(*c.Verification)
			}
			got = append(got, fmt.Sprintf("%d %s", c.N, v))
		}
		if want := []string{"1 verified", "2 verified", "5 verified"}; !slices.Equal(got, want) || len(end.Citations) != 3 {
			t.Errorf("%s: citations %v, want %v (message_end %d)", tc.slug, got, want, len(end.Citations))
		}
		// Five sentences are checked (six pairs); the citation list is not.
		rec := citationsRecord(t, env.agentEnv, tc.agentID)
		if rec.Claims != 5 || rec.Pairs != 6 || rec.Verified != 6 || rec.Unsupported != 0 || rec.Removed != 0 || rec.Refused {
			t.Errorf("%s: record %+v", tc.slug, rec)
		}
	}
}

// TestScopeCheck: small talk is answered without retrieval; a strict agent
// refuses an out-of-scope question without retrieval or a chat-model
// call; a non-strict one answers; failures fail open; decisions are
// recorded without text.
func TestScopeCheck(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": true})
	var status apitypes.SystemOneStatus
	if env.member.get("/v1/systemone/status", &status); !status.Scope.Enabled || status.Citations.Enabled {
		t.Errorf("status = %+v", status)
	}
	ag := env.publishAgent(t, "Help", env.agentConfig(env.kb.Id.String()))
	embeds := len(env.proxy.EmbedBatches())

	// Small talk: one short chat call, no retrieval.
	chats := len(env.proxy.ChatRequests())
	code, evs, e := env.member.stream(env.chatPath("help"), map[string]any{"message": "Hello!"})
	mustCode(t, "small talk", code, e, 200, "")
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if end.Text != testutil.FakeSmallTalk || end.NoContextReason == nil || *end.NoContextReason != "small_talk" || end.Refused ||
		len(evs.all("retrieval")) != 0 || len(env.proxy.ChatRequests()) != chats+1 || len(env.proxy.EmbedBatches()) != embeds {
		t.Fatalf("small talk = %v %+v", evs.names(), end)
	}
	if sys := systemPrompts(env.proxy); !strings.Contains(sys[len(sys)-1], "small talk") || strings.Contains(sys[len(sys)-1], "<sources>") {
		t.Errorf("small-talk prompt = %s", sys[len(sys)-1])
	}
	if raw := lastRecord(t, env.agentEnv, "scope", ag.Id.String()); !strings.Contains(raw, `"decision": "small_talk"`) ||
		!strings.Contains(raw, `"action": "reply"`) || strings.Contains(raw, "Hello") {
		t.Errorf("small-talk record = %s", raw)
	}

	// Out of scope, strict: refused in its own words (nothing was searched), without retrieval or a chat call.
	chats = len(env.proxy.ChatRequests())
	code, evs, e = env.member.stream(env.chatPath("help"), map[string]any{"message": "OFFTOPIC Which car should I buy?"})
	mustCode(t, "out of scope", code, e, 200, "")
	evs.one(t, "message_end", &end)
	if end.Text != "This is outside what Help covers." || !end.Refused || end.NoContextReason == nil || *end.NoContextReason != "out_of_scope" ||
		len(evs.all("retrieval")) != 0 || len(env.proxy.ChatRequests()) != chats {
		t.Fatalf("out of scope = %v %+v", evs.names(), end)
	}
	if raw := lastRecord(t, env.agentEnv, "scope", ag.Id.String()); !strings.Contains(raw, `"action": "refused"`) || strings.Contains(raw, "car") {
		t.Errorf("out-of-scope record = %s", raw)
	}

	// In scope: answered normally, with retrieval.
	code, evs, e = env.member.stream(env.chatPath("help"), map[string]any{"message": "Where do students buy a parking permit?"})
	mustCode(t, "in scope", code, e, 200, "")
	evs.one(t, "message_end", &end)
	if len(evs.all("retrieval")) != 1 || end.NoContextReason != nil || !strings.HasSuffix(end.Text, "[1]") {
		t.Errorf("in scope = %v %+v", evs.names(), end)
	}

	// Not strict: an out-of-scope question is answered normally.
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["strictlyGrounded"] = false
	loose := env.publishAgent(t, "Loose", cfg)
	code, evs, e = env.member.stream(env.chatPath("loose"), map[string]any{"message": "OFFTOPIC Where do students buy a parking permit?"})
	mustCode(t, "loose", code, e, 200, "")
	evs.one(t, "message_end", &end)
	if len(evs.all("retrieval")) != 1 || end.Refused || end.NoContextReason != nil {
		t.Errorf("loose = %v %+v", evs.names(), end)
	}
	if raw := lastRecord(t, env.agentEnv, "scope", loose.Id.String()); !strings.Contains(raw, `"decision": "out_of_scope"`) || !strings.Contains(raw, `"action": "none"`) {
		t.Errorf("loose record = %s", raw)
	}

	// Failures fail open; the agent override turns the check off.
	env.proxy.FailScopeWith(500)
	code, evs, e = env.member.stream(env.chatPath("help"), map[string]any{"message": "OFFTOPIC Which car should I buy?"})
	env.proxy.FailScopeWith(0)
	mustCode(t, "scope failure", code, e, 200, "")
	if len(evs.all("retrieval")) != 1 || !strings.Contains(lastRecord(t, env.agentEnv, "scope", ag.Id.String()), `"skipped"`) {
		t.Errorf("fail open = %v", evs.names())
	}
	cfg = env.agentConfig(env.kb.Id.String())
	cfg["systemOne"] = map[string]any{"scope": "off"}
	off := env.publishAgent(t, "Unchecked", cfg)
	before := env.proxy.ScopeRequests()
	code, _, e = env.member.stream(env.chatPath("unchecked"), map[string]any{"message": "Hello!"})
	mustCode(t, "override off", code, e, 200, "")
	if env.proxy.ScopeRequests() != before || lastRecord(t, env.agentEnv, "scope", off.Id.String()) != "" {
		t.Error("scope checked with the override off")
	}

	var an apitypes.AgentAnalytics
	env.editor.get(env.base+"/agents/"+ag.Id.String()+"/analytics", &an)
	if s := an.Totals.Scope; s.Checked != 4 || s.SmallTalk != 1 || s.OutOfScope != 1 || s.Refused != 1 || s.Skipped != 1 || s.LatencyP50Ms == nil {
		t.Errorf("scope totals = %+v", s)
	}
	if n := env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'systemone_tokens' AND metadata->>'feature' = 'scope'`); n < 4 {
		t.Errorf("scope usage rows = %d", n)
	}
}

// TestSystemOneChecksSettings: the sections are validated, old clients
// that send judging only keep them, and nothing runs while they are off.
func TestSystemOneChecksSettings(t *testing.T) {
	env := newSystemOneEnv(t)
	st := env.putChecks(t, map[string]any{"mode": "enforce", "autoAccept": 0.9}, map[string]any{"enabled": true, "inScope": 0.3})
	var out apitypes.SystemOneSettings
	j := st.Judging
	j.Enabled = true
	code, e := env.admin.call("PUT", "/v1/admin/systemone", map[string]any{"modelId": env.judge.Id, "judging": j}, &out, ifMatch(st.Revision))
	mustCode(t, "judging only", code, e, 200, "")
	if out.Citations.Mode != "enforce" || out.Citations.AutoAccept != 0.9 || !out.Scope.Enabled || out.Scope.InScope != 0.3 || !out.Judging.Enabled {
		t.Errorf("kept = %+v", out)
	}
	code, raw := env.admin.raw("PUT", "/v1/admin/systemone", map[string]any{"modelId": env.judge.Id, "judging": j,
		"citations": map[string]any{"enabled": true, "mode": "loud", "autoAccept": 2, "timeoutMs": 5000}}, ifMatch(out.Revision))
	if code != 400 || !strings.Contains(string(raw), "citations.mode") || !strings.Contains(string(raw), "citations.autoAccept") {
		t.Errorf("invalid = %d %s", code, raw)
	}
	code, raw = env.editor.raw("POST", env.base+"/agents", map[string]any{"name": "Bad", "config": map[string]any{
		"systemOne": map[string]any{"citations": "maybe", "citationMode": "loud", "scope": "x"}}}, nil)
	if pb := decodeProblems(t, raw); code != 400 || !hasField(pb.Error.Details.Problems, "systemOne.citations") ||
		!hasField(pb.Error.Details.Problems, "systemOne.citationMode") || !hasField(pb.Error.Details.Problems, "systemOne.scope") {
		t.Errorf("invalid override = %d %s", code, raw)
	}

	// Everything off: no citation or scope requests, no records, no event.
	env.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": false})
	kb := env.checksKB(t, "Fees", mixedCiteDocs)
	ag := env.publishAgent(t, "Fees", env.agentConfig(kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "Hello!"})
	mustCode(t, "off", code, e, 200, "")
	for _, ev := range evs {
		if ev.name == "citations_checked" || strings.Contains(string(ev.data), "verification") || strings.Contains(string(ev.data), "small_talk") {
			t.Errorf("%s: %s", ev.name, ev.data)
		}
	}
	if env.proxy.CitationRequests()+env.proxy.ScopeRequests() != 0 || lastRecord(t, env.agentEnv, "citations", ag.Id.String()) != "" ||
		lastRecord(t, env.agentEnv, "scope", ag.Id.String()) != "" {
		t.Error("checks ran while off")
	}

	// Agent use: by the platform defaults (judging on, the checks off), else by an agent's own setting.
	var use apitypes.SystemOneSettings
	if env.auditor.get("/v1/admin/systemone", &use); use.Agents != (apitypes.SystemOneAgentUse{Judging: 1, Any: 1}) {
		t.Errorf("agent use, platform defaults = %+v", use.Agents)
	}
	cfg := env.agentConfig(kb.Id.String())
	cfg["systemOne"] = map[string]any{"judging": "off", "scope": "on", "citations": "off"}
	env.publishAgent(t, "Scoped", cfg)
	if env.auditor.get("/v1/admin/systemone", &use); use.Agents != (apitypes.SystemOneAgentUse{Judging: 1, Scope: 1, Any: 2}) {
		t.Errorf("agent use, one override = %+v", use.Agents)
	}
}
