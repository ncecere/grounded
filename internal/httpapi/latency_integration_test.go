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
		if ttft < 0 || !strings.Contains(answer.Text, "transcripts") && !strings.Contains(answer.Text, "halls") {
			t.Errorf("%s: answer %q", label, answer.Text)
		}
		return conv.ConversationId
	}
	conv := ask("first message", "What is the transcript fee?", nil)
	ask("standalone follow-up", "When do residence halls open for move-in in August?", conv)
}
