package httpapi_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/observability"
)

// Per-claim verification (docs/v0.2.1.md I9, docs/systemone.md §3): each
// factual sentence of an answer is one claim with one verdict, streamed,
// stored with the message, returned by the OpenAI-compatible endpoint and
// counted the same way by an evaluation.

// claimsAnswer has a supported sentence citing two sources, an unsupported
// one (the fake SystemOne API says_nothing on UNSUPPORTED) and an uncited one.
const claimsAnswer = "Official transcripts cost ten dollars per copy [1][2]. Rush orders UNSUPPORTED arrive the same day [1]. " +
	"Pick them up at the front desk."

// claimView is a claim as "verdict: text".
func claimView(cs *[]apitypes.Claim) []string {
	if cs == nil {
		return nil
	}
	var out []string
	for _, c := range *cs {
		out = append(out, string(c.Verdict)+": "+c.Text)
	}
	return out
}

var wantClaims = []string{
	"supported: Official transcripts cost ten dollars per copy.",
	"not_supported: Rush orders UNSUPPORTED arrive the same day.",
	"uncited: Pick them up at the front desk.",
}

// claimsEnv is a SystemOne environment with citation checks on and an agent
// answering claimsAnswer.
func claimsEnv(t *testing.T) (*systemOneEnv, apitypes.Agent) {
	t.Helper()
	env := newSystemOneEnv(t)
	env.putChecks(t, nil, nil)
	kb := env.checksKB(t, "Fees", mixedCiteDocs)
	ag := env.publishAgent(t, "Fees", env.agentConfig(kb.Id.String()))
	env.proxy.SetAnswer(claimsAnswer)
	t.Cleanup(func() { env.proxy.SetAnswer("") })
	return env, ag
}

// checkClaimShapes checks what claimView leaves out: offsets into the text,
// indexes, supporting sources and per-source outcomes with occurrences.
func checkClaimShapes(t *testing.T, where, text string, cs *[]apitypes.Claim) {
	t.Helper()
	if cs == nil || len(*cs) != 3 {
		t.Fatalf("%s: claims = %+v", where, cs)
	}
	runes := []rune(text)
	for i, c := range *cs {
		if c.Index != i || c.End > len(runes) || !strings.HasPrefix(string(runes[c.Start:c.End]), strings.Fields(c.Text)[0]) {
			t.Errorf("%s: claim %d = %+v in %q", where, i, c, text)
		}
	}
	first, second, third := (*cs)[0], (*cs)[1], (*cs)[2]
	if len(first.Sources) != 2 || first.Checks == nil || len(*first.Checks) != 2 || (*first.Checks)[1].N != 2 ||
		(*first.Checks)[1].Occurrence == nil || *(*first.Checks)[1].Occurrence != 0 || first.Confidence == nil {
		t.Errorf("%s: multi-source claim = %+v", where, first)
	}
	// The second [1] of the answer cites the second claim.
	if second.Checks == nil || (*second.Checks)[0].Occurrence == nil || *(*second.Checks)[0].Occurrence != 1 ||
		(*second.Checks)[0].Verification != "unsupported" || len(second.Sources) != 0 {
		t.Errorf("%s: unsupported claim = %+v", where, second)
	}
	if third.Checks != nil || len(third.Sources) != 0 || third.Confidence != nil {
		t.Errorf("%s: uncited claim = %+v", where, third)
	}
}

// TestClaimsInChat: citations_checked carries the claims; the stored
// message has the same claims after a reload, and the check record keeps
// them without text. A message stored by v0.2.0 (a record without claims)
// keeps its per-marker verdicts and uncited sentences, without claims.
func TestClaimsInChat(t *testing.T) {
	env, ag := claimsEnv(t)
	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "chat", code, e, 200, "")
	var checked apitypes.ChatEventCitationsChecked
	evs.one(t, "citations_checked", &checked)
	if got := claimView(checked.Claims); !slicesEqual(got, wantClaims) {
		t.Fatalf("streamed claims = %q", got)
	}
	checkClaimShapes(t, "streamed", checked.Text, checked.Claims)
	rec := citationsRecord(t, env.agentEnv, ag.Id.String()) // fails on any text in the record
	if rec.SupportedClaims != 1 || rec.NotSupportedClaims != 1 || rec.UncitedClaims != 1 || len(rec.ClaimList) != 3 || rec.ClaimList[0].Text != "" {
		t.Errorf("record = %+v", rec)
	}
	// Analytics count the same claims as the chat's summary (1 of 3 supported · 1 uncited), next to the pairs.
	var an apitypes.AgentAnalytics
	env.editor.get(env.base+"/agents/"+ag.Id.String()+"/analytics", &an)
	if c := an.Totals.Citations; c.SupportedClaims != 1 || c.NotSupportedClaims != 1 || c.UncitedClaims != 1 || c.ClaimSupportRate == nil ||
		*c.ClaimSupportRate > 0.34 || *c.ClaimSupportRate < 0.33 || c.Pairs != 3 {
		t.Errorf("citation totals = %+v", c)
	}
	// The settings say how many published agents the checks are on for (citations: by the platform default).
	var st apitypes.SystemOneSettings
	env.auditor.get("/v1/admin/systemone", &st)
	if st.Agents.Citations < 1 || st.Agents.Any < st.Agents.Citations || st.Agents.Scope != 0 {
		t.Errorf("agent use = %+v", st.Agents)
	}

	var conv apitypes.ChatEventConversation
	evs.one(t, "conversation", &conv)
	path := "/v1/conversations/" + conv.ConversationId.String()
	var detail apitypes.ConversationDetail
	env.member.get(path, &detail)
	stored := detail.Messages[len(detail.Messages)-1]
	if got := claimView(stored.Claims); !slicesEqual(got, wantClaims) {
		t.Fatalf("stored claims = %q", got)
	}
	checkClaimShapes(t, "stored", stored.Text, stored.Claims)

	// A v0.2.0 record: no claims, the rest as before.
	if _, err := env.app.Pool.Exec(t.Context(), `UPDATE message_events SET citations = citations - 'claimList' - 'supportedClaims'
		- 'notSupportedClaims' - 'uncitedClaims' - 'uncheckedClaims' WHERE message_id = $1`, stored.Id); err != nil {
		t.Fatal(err)
	}
	var reloaded apitypes.ConversationDetail
	env.member.get(path, &reloaded)
	old := reloaded.Messages[len(reloaded.Messages)-1]
	if old.Claims != nil || !equalMarkers(markerVerifications(*old.Citations), map[int][]string{1: {"verified", "unsupported"}, 2: {"verified"}}) ||
		!slicesEqual(uncitedText(old.Text, old.Uncited), []string{"Pick them up at the front desk."}) {
		t.Errorf("v0.2.0 message = claims %+v, citations %+v, uncited %+v", old.Claims, old.Citations, old.Uncited)
	}
}

// TestClaimsOverOpenAI: the OpenAI-compatible endpoint returns claims next
// to citations, in the response and in the final chunk of a stream.
func TestClaimsOverOpenAI(t *testing.T) {
	env, ag := claimsEnv(t)
	var k apitypes.APIKeyCreated
	code, e := env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	model := "agent:" + env.team + "/" + ag.Slug
	messages := []map[string]any{{"role": "user", "content": "What does a transcript cost?"}}

	code, raw, _ := openaiCall(t, env.app.URL, k.Secret, map[string]any{"model": model, "messages": messages})
	var comp struct {
		Choices []struct {
			Message struct{ Content string }
		}
		Citations []apitypes.Citation
		Claims    *[]apitypes.Claim
	}
	if code != 200 || json.Unmarshal(raw, &comp) != nil || len(comp.Citations) != 2 {
		t.Fatalf("completion = %d %s", code, raw)
	}
	if got := claimView(comp.Claims); !slicesEqual(got, wantClaims) {
		t.Errorf("completion claims = %q", got)
	}
	checkClaimShapes(t, "completion", comp.Choices[0].Message.Content, comp.Claims)

	// Streamed: the final chunk (held until the check ends) carries them.
	b, _ := json.Marshal(map[string]any{"model": model, "stream": true, "messages": messages})
	req, _ := http.NewRequest("POST", env.app.URL+"/v1/chat/completions", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+k.Secret)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("stream = %v %v", res, err)
	}
	defer res.Body.Close()
	var content string
	var claims *[]apitypes.Claim
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		line, ok := strings.CutPrefix(sc.Text(), "data: ")
		if !ok || line == "[DONE]" {
			continue
		}
		var ch struct {
			Choices []struct {
				Delta struct{ Content string }
			}
			Claims *[]apitypes.Claim
		}
		if err := json.Unmarshal([]byte(line), &ch); err != nil {
			t.Fatalf("chunk %q: %v", line, err)
		}
		if len(ch.Choices) > 0 {
			content += ch.Choices[0].Delta.Content
		}
		if ch.Claims != nil {
			claims = ch.Claims
		}
	}
	if got := claimView(claims); !slicesEqual(got, wantClaims) {
		t.Errorf("streamed claims = %q", got)
	}
	checkClaimShapes(t, "stream", content, claims)
}

// TestClaimsInEvaluations: a full-answer run's share of supported claims
// counts the claims chat shows (1 of 3: the uncited sentence counts as not
// supported), and the result carries them. Its SystemOne checks ran at
// background priority (docs/v0.4.1.md §4).
func TestClaimsInEvaluations(t *testing.T) {
	env, ag := claimsEnv(t)
	waits := systemOneWaits(t, "citations", "background")
	set := env.newEvalSet(t, map[string]any{"agentId": ag.Id, "name": "Fees"})
	question := "What does a transcript cost?"
	env.addQuestion(t, set, question, map[string]any{"filenames": []string{"fee.txt"}})
	d := env.runEval(t, set, map[string]any{"kind": "answer"})
	r := resultFor(d, question)
	if d.Run.Status != "completed" || r.Scores == nil || r.Answer == nil {
		t.Fatalf("run = %+v result %+v", d.Run, r)
	}
	if got := claimView(r.Claims); !slicesEqual(got, wantClaims) {
		t.Fatalf("result claims = %q", got)
	}
	checkClaimShapes(t, "result", *r.Answer, r.Claims)
	sc := r.Scores
	if sc.SupportedShare == nil || *sc.SupportedShare != 1.0/3 || sc.SupportedClaims == nil || *sc.SupportedClaims != 1 ||
		sc.ClaimsScored == nil || *sc.ClaimsScored != 3 || sc.Uncited == nil || *sc.Uncited != 1 {
		t.Errorf("scores = %+v", sc)
	}
	if s := d.Run.Summary; s.SupportedShare == nil || *s.SupportedShare != 1.0/3 {
		t.Errorf("summary = %+v", s)
	}
	if n := systemOneWaits(t, "citations", "background"); n <= waits {
		t.Errorf("background citation checks = %d, want more than %d", n, waits)
	}
}

// systemOneWaits is how many SystemOne slot waits this process recorded for
// a feature and priority (grounded_systemone_wait_seconds).
func systemOneWaits(t *testing.T, feature, priority string) uint64 {
	t.Helper()
	reg := prometheus.NewRegistry()
	reg.MustRegister(observability.SystemOneWait)
	mfs, err := reg.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, mf := range mfs {
		for _, m := range mf.GetMetric() {
			labels := map[string]string{}
			for _, l := range m.GetLabel() {
				labels[l.GetName()] = l.GetValue()
			}
			if labels["feature"] == feature && labels["priority"] == priority {
				return m.GetHistogram().GetSampleCount()
			}
		}
	}
	return 0
}

// TestUncitedIsNotAFailure: an answer whose only issue is an uncited
// sentence isn't a failed question for the gap report and may be saved
// (owner decision, 2026-10-01); the chat still shows the uncited claim.
func TestUncitedIsNotAFailure(t *testing.T) {
	env, ag := claimsEnv(t)
	env.proxy.SetAnswer("Official transcripts cost ten dollars per copy [1][2]. Pick them up at the front desk.")
	cachePath := env.base + "/agents/" + ag.Id.String() + "/answer-cache"
	var st apitypes.AgentAnswerCache
	env.editor.get(cachePath, &st)
	code, e := env.editor.call("PUT", cachePath, map[string]any{"enabled": true, "nearIdentical": false, "expiryHours": 24}, nil, ifMatch(st.Revision))
	mustCode(t, "cache on", code, e, 200, "")
	code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": "What does a transcript cost?"})
	mustCode(t, "chat", code, e, 200, "")
	var checked apitypes.ChatEventCitationsChecked
	evs.one(t, "citations_checked", &checked)
	if got := claimView(checked.Claims); !slicesEqual(got, []string{wantClaims[0], wantClaims[2]}) {
		t.Fatalf("claims = %q", got)
	}
	if n := env.scalar(t, `SELECT count(*) FROM gap_questions WHERE agent_id = $1`, ag.Id); n != 0 {
		t.Errorf("failed questions = %d, want 0", n)
	}
	if n := env.scalar(t, `SELECT count(*) FROM answer_cache WHERE agent_id = $1`, ag.Id); n != 1 {
		t.Errorf("saved answers = %d, want 1", n)
	}
}
