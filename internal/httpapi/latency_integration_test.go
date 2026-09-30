package httpapi_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/ncecere/grounded/internal/httpapi/apitypes"
	"github.com/ncecere/grounded/internal/tracing/tracingtest"
)

// timedEvent is an SSE event with the time since the request was sent.
type timedEvent struct {
	sseEvent
	at time.Duration
}

type timedEvents []timedEvent

// first is the time of the first event called name (-1: none).
func (evs timedEvents) first(name string) time.Duration {
	for _, e := range evs {
		if e.name == name {
			return e.at
		}
	}
	return -1
}

func (evs timedEvents) events() sseEvents {
	out := make(sseEvents, len(evs))
	for i, e := range evs {
		out[i] = e.sseEvent
	}
	return out
}

// timedStream posts a chat and returns its events, each with the time it
// arrived.
func (s *session) timedStream(t *testing.T, path string, body any) timedEvents {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", s.app.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", s.app.URL)
	req.Header.Set("X-CSRF-Token", s.csrf)
	start := time.Now()
	res, err := s.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("chat = %d", res.StatusCode)
	}
	var out timedEvents
	var name string
	var data []string
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "" && (name != "" || len(data) > 0):
			out = append(out, timedEvent{sseEvent{name, json.RawMessage(strings.Join(data, "\n"))}, time.Since(start)})
			name, data = "", nil
		case strings.HasPrefix(line, "event: "):
			name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = append(data, strings.TrimPrefix(line, "data: "))
		}
	}
	return out
}

// statusSteps are the steps of the status events, in order.
func statusSteps(evs sseEvents) []string {
	var out []string
	for _, e := range evs.all("status") {
		var d struct{ Step string }
		_ = json.Unmarshal(e.data, &d)
		out = append(out, d.Step)
	}
	return out
}

// answerSteps renders the children of a trace's agent.answer span with
// their start (from the answer's) and duration, for the log.
func answerSteps(trace []sdktrace.ReadOnlySpan) string {
	var answer sdktrace.ReadOnlySpan
	for _, sp := range trace {
		if sp.Name() == "agent.answer" {
			answer = sp
		}
	}
	if answer == nil {
		return "(no agent.answer span)"
	}
	var kids []sdktrace.ReadOnlySpan
	for _, sp := range trace {
		if sp.Parent().SpanID() == answer.SpanContext().SpanID() {
			kids = append(kids, sp)
		}
	}
	sort.Slice(kids, func(i, j int) bool { return kids[i].StartTime().Before(kids[j].StartTime()) })
	ms := func(d time.Duration) int64 { return d.Milliseconds() }
	var b strings.Builder
	fmt.Fprintf(&b, "agent.answer %d ms\n", ms(answer.EndTime().Sub(answer.StartTime())))
	for _, sp := range kids {
		fmt.Fprintf(&b, "  +%5d ms  %-18s %5d ms\n", ms(sp.StartTime().Sub(answer.StartTime())), sp.Name(), ms(sp.EndTime().Sub(sp.StartTime())))
	}
	return b.String()
}

// TestAnswerLatency measures the time to the first token of a first
// message and of a follow-up that stands on its own, with delays like a
// real install's (scope check 500 ms, embedding 400 ms, judging requests
// 300-2500 ms, the model's first token 500 ms, a reasoning model's query
// rewrite 3 s), and logs the answers' traces.
func TestAnswerLatency(t *testing.T) {
	spans := tracingtest.RecordSpans(t)
	env := newSystemOneEnv(t)
	env.putSettings(t, map[string]any{"candidates": 10})
	env.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": true})
	env.publishAgent(t, "Fees", env.agentConfig(env.kb.Id.String()))
	ms := time.Millisecond
	env.proxy.SetScopeDelay(500 * ms)
	env.proxy.SetEmbedLatency(400 * ms)
	env.proxy.SetJudgingDelays(300*ms, 700*ms, 1100*ms, 2500*ms, 400*ms, 900*ms, 1600*ms, 350*ms, 2000*ms, 500*ms)
	env.proxy.SetReplyDelay(500*ms, 3*time.Second) // the owner's rewrite took 5 s

	ask := func(label, message string, conversation *string) *string {
		t.Helper()
		body := map[string]any{"message": message}
		if conversation != nil {
			body["conversationId"] = *conversation
		}
		evs := env.member.timedStream(t, env.chatPath("fees"), body)
		ttft := evs.first("text_delta")
		var conv struct{ ConversationId *string }
		evs.events().one(t, "conversation", &conv)
		var answer struct{ Text string }
		evs.events().one(t, "message_end", &answer)
		steps := answerSteps(spans.Trace(spans.Find(t, "agent.answer", func(sp sdktrace.ReadOnlySpan) bool {
			return sp.EndTime().After(time.Now().Add(-2 * time.Second))
		}).SpanContext().TraceID()))
		t.Logf("%s: first token after %d ms (%s)\n%s", label, ttft.Milliseconds(), strings.Join(evs.events().names(), " "), steps)
		if ttft < 0 || answer.Text == "" {
			t.Errorf("%s: answer %q", label, answer.Text)
		}
		return conv.ConversationId
	}
	conv := ask("first message", "What is the transcript fee?", nil)
	ask("standalone follow-up", "When do residence halls open for move-in in August?", conv)
}

// TestSearchOverlapsTheScopeCheck: in always mode the search runs while
// the scope check answers (its delay doesn't add to the time to first
// token), judging waits for it, so small talk and an out-of-scope refusal
// make no judging request (the search's tokens are still recorded), and
// the status events name each step in order.
func TestSearchOverlapsTheScopeCheck(t *testing.T) {
	env := newSystemOneEnv(t)
	env.putSettings(t, nil)
	env.putChecks(t, map[string]any{"enabled": false}, map[string]any{"enabled": true})
	ag := env.publishAgent(t, "Fees", env.agentConfig(env.kb.Id.String()))
	env.proxy.SetScopeDelay(600 * time.Millisecond)
	env.proxy.SetEmbedLatency(600 * time.Millisecond)

	judged := env.proxy.JudgingRequests()
	evs := env.member.timedStream(t, env.chatPath("fees"), map[string]any{"message": "What is the transcript fee?"})
	if ttft := evs.first("text_delta"); ttft < 0 || ttft > time.Second { // one after the other: 1.2 s and more
		t.Errorf("first token after %v: the scope check and the search did not overlap", ttft)
	}
	names := strings.Join(evs.events().names(), ",")
	if !strings.HasPrefix(names, "conversation,status,status,retrieval,status,message_start,") ||
		strings.Join(statusSteps(evs.events()), ",") != "searching,checking,answering" || env.proxy.JudgingRequests() == judged {
		t.Errorf("events = %s, steps = %v", names, statusSteps(evs.events()))
	}
	if evs.first("status") > 300*time.Millisecond {
		t.Errorf("the first status event came after %v", evs.first("status"))
	}

	embedRows := func() int64 {
		return env.scalar(t, `SELECT count(*) FROM usage_events WHERE kind = 'embed_tokens' AND agent_id = $1`, ag.Id)
	}
	for _, tc := range []struct{ message, steps, reason string }{
		{"OFFTOPIC Which car should I buy?", "searching", "out_of_scope"},
		{"Hello!", "searching,answering", "small_talk"},
	} {
		judged, chats, rows := env.proxy.JudgingRequests(), len(env.proxy.ChatRequests()), embedRows()
		code, evs, e := env.member.stream(env.chatPath("fees"), map[string]any{"message": tc.message})
		mustCode(t, tc.message, code, e, 200, "")
		var end apitypes.ChatEventMessageEnd
		evs.one(t, "message_end", &end)
		if end.NoContextReason == nil || string(*end.NoContextReason) != tc.reason || len(evs.all("retrieval")) != 0 ||
			strings.Join(statusSteps(evs), ",") != tc.steps {
			t.Errorf("%s = %v %v %+v", tc.message, evs.names(), statusSteps(evs), end)
		}
		if env.proxy.JudgingRequests() != judged {
			t.Errorf("%s: %d judging requests", tc.message, env.proxy.JudgingRequests()-judged)
		}
		if wantChats := map[string]int{"out_of_scope": 0, "small_talk": 1}[tc.reason]; len(env.proxy.ChatRequests())-chats != wantChats {
			t.Errorf("%s: %d chat requests", tc.message, len(env.proxy.ChatRequests())-chats)
		}
		if embedRows() != rows+1 {
			t.Errorf("%s: the discarded search's tokens were not recorded", tc.message)
		}
	}
}

// TestJudgingTimeLimit: judging waits at most the platform's time limit;
// requests still running are cancelled and their passages kept unjudged
// (skipped), counted in the record and on the search's span.
func TestJudgingTimeLimit(t *testing.T) {
	spans := tracingtest.RecordSpans(t)
	env := newSystemOneEnv(t)
	st := env.putSettings(t, nil)
	if st.Judging.TimeLimitMs == nil || *st.Judging.TimeLimitMs != 1500 {
		t.Fatalf("default time limit = %v", st.Judging.TimeLimitMs)
	}
	for _, bad := range []int{400, 10001} {
		var cur apitypes.SystemOneSettings
		env.admin.get("/v1/admin/systemone", &cur)
		j := cur.Judging
		j.TimeLimitMs = &bad
		code, e := env.admin.call("PUT", "/v1/admin/systemone", map[string]any{"modelId": env.judge.Id, "judging": j}, nil, ifMatch(cur.Revision))
		mustCode(t, fmt.Sprintf("time limit %d", bad), code, e, 400, "invalid_settings")
	}
	if st = env.putSettings(t, map[string]any{"timeLimitMs": 600}); *st.Judging.TimeLimitMs != 600 {
		t.Fatalf("saved time limit = %d", *st.Judging.TimeLimitMs)
	}
	// A client from before the setting keeps the saved value.
	var cur apitypes.SystemOneSettings
	env.admin.get("/v1/admin/systemone", &cur)
	j := cur.Judging
	j.TimeLimitMs = nil
	code, e := env.admin.call("PUT", "/v1/admin/systemone", map[string]any{"modelId": env.judge.Id, "judging": j}, &st, ifMatch(cur.Revision))
	if mustCode(t, "without the time limit", code, e, 200, ""); *st.Judging.TimeLimitMs != 600 {
		t.Fatalf("kept time limit = %d", *st.Judging.TimeLimitMs)
	}

	ag := env.publishAgent(t, "Fees", env.agentConfig(env.kb.Id.String()))
	before := env.proxy.JudgingRequests()
	env.proxy.SetJudgingDelays(20*time.Millisecond, 3*time.Second) // every other request is slow
	slow := 0
	for i := range 7 {
		slow += (before + i) % 2
	}
	evs := env.member.timedStream(t, env.chatPath("fees"), map[string]any{"message": "What is the transcript fee?"})
	env.proxy.SetJudgingDelays()
	if ttft := evs.first("text_delta"); ttft < 0 || ttft > 1500*time.Millisecond {
		t.Errorf("first token after %v with a 600 ms time limit", ttft)
	}
	var ret apitypes.ChatEventRetrieval
	evs.events().one(t, "retrieval", &ret)
	if ret.Judging == nil || ret.Judging.Judged != 7 || ret.Judging.Kept == 0 {
		t.Errorf("retrieval judging = %+v", ret.Judging)
	}
	if rec, raw := judgingRecord(t, env.agentEnv, ag.Id.String()); rec.Skipped != slow || rec.CutShort != 1 || rec.Candidates != 7 {
		t.Errorf("record = %s, want %d skipped", raw, slow)
	}
	retrieve := spans.Find(t, "agent.retrieve", func(sp sdktrace.ReadOnlySpan) bool { return attr(sp, "grounded.judging.cut_short") == "true" })
	if attr(retrieve, "grounded.judging.skipped") != fmt.Sprint(slow) || attr(retrieve, "grounded.judging.time_limit_ms") != "600" {
		t.Errorf("span = %v", retrieve.Attributes())
	}
}
