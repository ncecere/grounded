package httpapi_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/testutil"
)

// The answer pipeline's re-test findings (docs/v0.4.2.md, As built: R1).

// shownText is the answer text a client that follows text_reset shows.
func shownText(evs sseEvents) string {
	var b strings.Builder
	for _, e := range evs {
		switch e.name {
		case "text_reset":
			b.Reset()
		case "text_delta":
			var d struct{ Delta string }
			_ = json.Unmarshal(e.data, &d)
			b.WriteString(d.Delta)
		}
	}
	return b.String()
}

// retrievalQuery is the query of the search before the model (always mode).
func retrievalQuery(t *testing.T, evs sseEvents) string {
	t.Helper()
	var ret apitypes.ChatEventRetrieval
	evs.one(t, "retrieval", &ret)
	return ret.Query
}

// TestRewriteThatAnswersIsNotSearched (US2-01): a rewrite model that
// answers the follow-up (a marker, a statement) isn't searched or shown:
// the follow-up is searched with the earlier question, signed in and for a
// signed-out visitor. A rewrite that reads as a query is used.
func TestRewriteThatAnswersIsNotSearched(t *testing.T) {
	env := newPublishEnv(t)
	first, follow := "Where do students buy a parking permit?", "Can I pay for it by card?"
	answered := "Yes, students can pay for a parking permit by card at the campus office [1]."
	env.proxy.SetRewrite(answered)
	t.Cleanup(func() { env.proxy.SetRewrite("") })

	env.publishAgent(t, "Permits", env.agentConfig(env.kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath("permits"), map[string]any{"message": first})
	mustCode(t, "first", code, e, 200, "")
	var conv struct{ ConversationId string }
	evs.one(t, "conversation", &conv)
	ask := func() string {
		t.Helper()
		code, evs, e := env.member.stream(env.chatPath("permits"), map[string]any{"message": follow, "conversationId": conv.ConversationId})
		mustCode(t, "follow-up", code, e, 200, "")
		return retrievalQuery(t, evs)
	}
	if q := ask(); q != first+" "+follow {
		t.Errorf("signed in, the answer as a rewrite: searched %q", q)
	}
	env.proxy.SetRewrite("Can students pay for a parking permit by card?")
	if q := ask(); q != "Can students pay for a parking permit by card?" {
		t.Errorf("signed in, a good rewrite: searched %q", q)
	}

	// A signed-out visitor's follow-up (the session continues its conversation).
	env.proxy.SetRewrite(answered)
	pub := env.publicAgent(t, "Open permits")
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("start = %d %s", code, e)
	}
	if code, _, e := v.ask(pub.Id, first); code != 200 {
		t.Fatalf("visitor first = %d %s", code, e)
	}
	code, evs, e = v.ask(pub.Id, follow)
	mustCode(t, "visitor follow-up", code, e, 200, "")
	if q := retrievalQuery(t, evs); q != first+" "+follow || strings.Contains(q, "[1]") {
		t.Errorf("visitor searched %q", q)
	}
}

// TestToolTurnTextIsNotTheAnswer (BU2-01): the model writes narration and a
// draft, then calls a tool. The answer is its final turn only: streamed
// (text_reset takes the text back), checked paragraph by paragraph,
// retracted, buffered for a visitor, and on the OpenAI-compatible
// endpoint; stored without it, and not kept as thinking.
func TestToolTurnTextIsNotTheAnswer(t *testing.T) {
	env := newPublishEnv(t)
	narration := "I'll search the knowledge base first.\n\nA first draft: permits are sold online [1].\n\n"
	env.proxy.SetToolCalls(testutil.FakeToolCall{Name: "search_knowledge", Args: `{"query":"parking permit"}`, Text: narration})
	t.Cleanup(func() { env.proxy.SetToolCalls() })
	q := "Where do students buy a parking permit?"
	answered := func(step string, evs sseEvents) string {
		t.Helper()
		var end apitypes.ChatEventMessageEnd
		evs.one(t, "message_end", &end)
		if strings.Contains(end.Text, "draft") || strings.Contains(end.Text, "I'll search") || !strings.HasSuffix(end.Text, "[1]") {
			t.Fatalf("%s: message_end text = %q", step, end.Text)
		}
		if shown := strings.TrimSpace(shownText(evs)); shown != end.Text {
			t.Errorf("%s: the reader is left with %q, the answer is %q (events %v)", step, shown, end.Text, evs.names())
		}
		if th := evs.text("thinking_delta"); strings.Contains(th, "draft") {
			t.Errorf("%s: the draft is kept as thinking: %q", step, th)
		}
		return end.Text
	}
	cfg := env.agentConfig(env.kb.Id.String())
	cfg["retrievalMode"] = "tool"
	env.publishAgent(t, "Tool turns", cfg)
	chat := func(step string) (sseEvents, string) {
		t.Helper()
		code, evs, e := env.member.stream(env.chatPath("tool-turns"), map[string]any{"message": q})
		mustCode(t, step, code, e, 200, "")
		return evs, answered(step, evs)
	}

	// Streamed: the narration arrived, then text_reset took it back. Stored without it.
	evs, text := chat("streamed")
	if names := strings.Join(evs.names(), ","); !strings.Contains(names, "text_delta,text_reset") ||
		!strings.Contains(names, "text_reset,status,tool_call") {
		t.Errorf("streamed events = %s", names)
	}
	var conv struct{ ConversationId string }
	evs.one(t, "conversation", &conv)
	var detail apitypes.ConversationDetail
	env.member.get("/v1/conversations/"+conv.ConversationId, &detail)
	if last := detail.Messages[len(detail.Messages)-1]; last.Text != text {
		t.Errorf("stored text = %q", last.Text)
	}
	if n := env.scalar(t, `SELECT count(*) FROM messages WHERE content::text LIKE '%first draft%'`); n != 0 {
		t.Errorf("%d stored messages keep the draft", n)
	}

	// Checked paragraph by paragraph: a released paragraph of the narration is taken back too.
	policy := func(mode string) {
		env.putPolicy(t, "team", map[string]any{"modelId": env.classifier.Id, "outputMode": mode, "failClosed": true,
			"categories": map[string]any{"violence": rules(rule("block", 0.5), rule("block", 0.5))}})
	}
	policy("stream_checked")
	chat("stream_checked")
	policy("stream_retract")
	chat("stream_retract")
	policy("buffer")
	evs, _ = chat("buffer")
	if len(evs.all("text_reset")) != 0 || len(evs.all("text_delta")) != 1 {
		t.Errorf("buffered: %v", evs.names())
	}

	// A visitor's buffered answer gets only the answer.
	env.setPublic(t, true)
	env.publicPolicy(t)
	cfg["audience"] = "public"
	var pub apitypes.Agent
	code, e := env.editor.call("POST", env.base+"/agents", map[string]any{"name": "Public tool turns", "config": cfg}, &pub, nil)
	mustCode(t, "create public", code, e, 201, "")
	if code, raw := env.publish(env.tadmin, pub); code != 201 {
		t.Fatalf("publish public = %d %s", code, raw)
	}
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("start = %d %s", code, e)
	}
	code, evs, e = v.ask(pub.Id, q)
	mustCode(t, "public", code, e, 200, "")
	answered("public", evs)
	if len(evs.all("text_reset")) != 0 {
		t.Errorf("a buffered answer took back text it never sent: %v", evs.names())
	}

	// The OpenAI-compatible stream can't take text back: it holds the text of an agent with tools.
	policy("stream_retract")
	var k apitypes.APIKeyCreated
	code, e = env.member.call("POST", env.base+"/api-keys", map[string]any{"name": "sdk", "scopes": []string{"query"}}, &k, nil)
	mustCode(t, "key", code, e, 201, "")
	content := openaiStreamContent(t, env.app.URL, k.Secret, "agent:"+env.team+"/tool-turns", q)
	if strings.Contains(content, "draft") || !strings.HasSuffix(content, "[1]") {
		t.Errorf("OpenAI stream content = %q", content)
	}
}

// openaiStreamContent streams a question on the OpenAI-compatible endpoint
// and joins the content deltas.
func openaiStreamContent(t *testing.T, base, key, model, q string) string {
	t.Helper()
	b, _ := json.Marshal(map[string]any{"model": model, "stream": true, "messages": []map[string]string{{"role": "user", "content": q}}})
	req, _ := http.NewRequest("POST", base+"/v1/chat/completions", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("OpenAI stream = %v %v", res, err)
	}
	defer res.Body.Close()
	var content strings.Builder
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
		}
		_ = json.Unmarshal([]byte(line), &ch)
		for _, c := range ch.Choices {
			content.WriteString(c.Delta.Content)
		}
	}
	return content.String()
}

// TestToolResultsAreNotJudgedOut (BU2-02): with passage judging on, a tool
// result judged irrelevant to the (two-part) question is still given to the
// model, cited and shown; a prompt injection is still left out.
func TestToolResultsAreNotJudgedOut(t *testing.T) {
	env := newMCPEnv(t)
	var judge apitypes.Model
	code, e := env.admin.call("POST", "/v1/admin/models", map[string]any{"connectionId": env.conn.Id, "key": "jev", "upstreamModel": "jev-latest",
		"displayName": "Judge", "kind": "systemone", "maxClassification": "sensitive"}, &judge, nil)
	mustCode(t, "SystemOne model", code, e, 201, "")
	(&systemOneEnv{agentEnv: env.agentEnv, judge: judge}).putSettings(t, nil)
	env.approve(t, "check_outage")
	ag := env.toolAgent(t, "Judged tools", []string{"check_outage"}, testutil.FakeToolCall{Name: "check_outage", Args: `{"service":"email IRRELEVANT"}`})
	t.Cleanup(func() { env.proxy.SetToolCalls() })
	before := env.proxy.JudgingRequests()

	code, evs, errCode := env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Is email down right now? And how long does a guest pass last?"})
	mustCode(t, "chat", code, errCode, 200, "")
	var res apitypes.ChatEventToolResult
	evs.one(t, "tool_result", &res)
	if res.HitCount != 1 || res.Result == nil || !strings.Contains(*res.Result, "operating normally") {
		t.Fatalf("tool result = %+v", res)
	}
	var end apitypes.ChatEventMessageEnd
	evs.one(t, "message_end", &end)
	if !strings.Contains(end.Text, "operating normally") || len(end.Citations) != 1 {
		t.Fatalf("answer = %q %+v", end.Text, end.Citations)
	}
	if env.proxy.JudgingRequests() == before {
		t.Error("the tool result wasn't judged")
	}
	if rec, raw := judgingRecord(t, env.agentEnv, ag.Id.String()); rec.Kept != 1 || len(rec.Dropped) != 0 || rec.Evidence != 1 {
		t.Errorf("judging record = %s", raw)
	}

	// A prompt injection is still left out.
	env.proxy.SetToolCalls(testutil.FakeToolCall{Name: "check_outage", Args: `{"service":"INJECTION"}`})
	code, evs, errCode = env.member.stream(env.chatPath(ag.Slug), map[string]any{"message": "Is email down right now?"})
	mustCode(t, "injection", code, errCode, 200, "")
	evs.one(t, "tool_result", &res)
	if res.HitCount != 0 || res.Result == nil || !strings.Contains(*res.Result, "instructions to the assistant") {
		t.Fatalf("injected tool result = %+v", res)
	}
	evs.one(t, "message_end", &end)
	if strings.Contains(end.Text, "operating normally") {
		t.Errorf("an injected result reached the answer: %q", end.Text)
	}
}

// TestWeakContradictionIsNotShown (US2-03): a contradicting verdict below
// auto-accept reads as not supported (amber), on the citation, the claim
// and in the record; a confident one stays contradicted.
func TestWeakContradictionIsNotShown(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putChecks(t, nil, nil)
	kb := env.checksKB(t, "Wi-Fi", []upload{
		{"weak.txt", []byte("FAKE-LIST WEAKCONTRA It worked yesterday: you probably changed your password.\n")},
		{"strong.txt", []byte("FAKE-LIST CONTRADICTED Guest passes last a year.\n")},
	})
	ag := env.publishAgent(t, "Wi-Fi help", env.agentConfig(kb.Id.String()))
	code, evs, e := env.member.stream(env.chatPath("wi-fi-help"), map[string]any{"message": "Why won't my laptop connect to the Wi-Fi?"})
	mustCode(t, "chat", code, e, 200, "")
	var checked apitypes.ChatEventCitationsChecked
	evs.one(t, "citations_checked", &checked)
	got := map[string]string{}
	for _, c := range checked.Citations {
		if c.Verification != nil {
			got[strings.Fields(c.Snippet)[1]] = string(*c.Verification)
		}
	}
	if got["WEAKCONTRA"] != "unsupported" || got["CONTRADICTED"] != "contradicted" {
		t.Fatalf("verifications = %v", got)
	}
	if checked.Claims == nil {
		t.Fatal("no claims")
	}
	for _, cl := range *checked.Claims {
		for _, ch := range *cl.Checks {
			if strings.Contains(cl.Text, "yesterday") && ch.Verification != "unsupported" {
				t.Errorf("the weak claim's check = %+v", ch)
			}
		}
	}
	if rec := citationsRecord(t, env.agentEnv, ag.Id.String()); rec.Contradicted != 1 || rec.Unsupported != 1 || rec.LowConfidence != 1 {
		t.Errorf("record = %+v", rec)
	}
}

// readUntil streams a chat request and cancels it once stop says so,
// returning the events read until then.
func readUntil(t *testing.T, client *http.Client, req *http.Request, stop func(sseEvent) bool) sseEvents {
	t.Helper()
	ctx, cancel := context.WithCancel(req.Context())
	defer cancel()
	res, err := client.Do(req.WithContext(ctx))
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("chat = %v %v", res, err)
	}
	defer res.Body.Close()
	var out sseEvents
	var name string
	var data []string
	sc := bufio.NewScanner(res.Body)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "" && name != "":
			ev := sseEvent{name: name, data: json.RawMessage(strings.Join(data, "\n"))}
			out = append(out, ev)
			name, data = "", nil
			if stop(ev) {
				return out
			}
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = append(data, strings.TrimPrefix(line, "data: "))
		}
	}
	t.Fatalf("the stream ended before the stop: %v", out.names())
	return out
}

// TestStoppedAnswerIsStoredAsShown (US2-12): Stop keeps the text the reader
// got, not what the model wrote after: streamed (the deltas read), and a
// visitor's buffered answer they never got (nothing).
func TestStoppedAnswerIsStoredAsShown(t *testing.T) {
	env := newPublishEnv(t)
	env.proxy.SetChunkDelay(120 * time.Millisecond)
	t.Cleanup(func() { env.proxy.SetChunkDelay(0) })
	env.proxy.SetAnswer("Students buy parking permits online at the transportation office website before the term starts [1].")
	t.Cleanup(func() { env.proxy.SetAnswer("") })
	stored := func(agentID string) string {
		t.Helper()
		q := `SELECT count(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
			WHERE c.agent_id = $1 AND m.role = 'assistant' AND m.stop_reason = 'aborted'`
		for deadline := time.Now().Add(10 * time.Second); env.scalar(t, q, agentID) == 0; time.Sleep(50 * time.Millisecond) {
			if time.Now().After(deadline) {
				t.Fatal("no stopped answer stored")
			}
		}
		var content []byte
		if err := env.app.Pool.QueryRow(t.Context(), `SELECT m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
			WHERE c.agent_id = $1 AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1`, agentID).Scan(&content); err != nil {
			t.Fatal(err)
		}
		var blocks []struct{ Type, Text string }
		_ = json.Unmarshal(content, &blocks)
		text := ""
		for _, b := range blocks {
			if b.Type == "text" {
				text += b.Text
			}
		}
		return text
	}

	// Signed in, streamed: three words, then Stop.
	ag := env.publishAgent(t, "Stops", env.agentConfig(env.kb.Id.String()))
	b, _ := json.Marshal(map[string]any{"message": "Where do students buy a parking permit?"})
	req, _ := http.NewRequest("POST", env.app.URL+env.chatPath("stops"), bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", env.app.URL)
	req.Header.Set("X-CSRF-Token", env.member.csrf)
	deltas := 0
	evs := readUntil(t, env.member.client, req, func(ev sseEvent) bool {
		if ev.name == "text_delta" {
			deltas++
		}
		return deltas == 3
	})
	if got, want := stored(ag.Id.String()), strings.TrimSpace(evs.text("text_delta")); got != want {
		t.Errorf("stored %q, shown %q", got, want)
	}

	// A visitor's buffered answer: Stop while it's written, before any of it was sent.
	pub := env.publicAgent(t, "Open stops")
	v := newVisitor(t, env.app.URL)
	if code, e := v.start(pub.Id, "", ""); code != 201 {
		t.Fatalf("start = %d %s", code, e)
	}
	req, _ = http.NewRequest("POST", env.app.URL+"/v1/public/agents/"+pub.Id.String()+"/chat", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", env.app.URL)
	readUntil(t, v.client, req, func(ev sseEvent) bool { return ev.name == "status" && strings.Contains(string(ev.data), "answering") })
	if got := stored(pub.Id.String()); got != "" {
		t.Errorf("a buffered answer the visitor never got is stored as %q", got)
	}
}
