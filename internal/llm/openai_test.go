package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
)

var searchTool = Tool{
	Name:        "search_knowledge",
	Description: "Search the knowledge bases.",
	Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}`),
}

func TestRecordedToolCallStream(t *testing.T) {
	rec := newRecorder(t, sseHandler(fixture(t, "gptoss_toolcall.sse")))
	evs := stream(t, provider(rec.URL, 5*time.Second), Context{
		SystemPrompt: "You answer from sources.",
		Messages:     []Message{UserMessage{Content: "When is the Springfield drop/add end date 2024?"}},
		Tools:        []Tool{searchTool},
	}, Options{User: UserTag("registrar", "helper"), MaxTokens: 512})

	if n := count(evs, EventThinkingDelta); n != 72 {
		t.Errorf("thinking deltas = %d, want 72", n)
	}
	if n := count(evs, EventToolCallDelta); n != 19 {
		t.Errorf("toolcall deltas = %d, want 19", n)
	}
	if count(evs, EventThinkingStart) != 1 || count(evs, EventThinkingEnd) != 1 || count(evs, EventToolCallEnd) != 1 {
		t.Errorf("block events: %d/%d/%d", count(evs, EventThinkingStart), count(evs, EventThinkingEnd), count(evs, EventToolCallEnd))
	}
	if count(evs, EventTextStart) != 0 {
		t.Error("empty content delta must not open a text block")
	}
	done := terminal(evs)
	if done.Type != EventDone || done.Reason != StopReasonToolUse {
		t.Fatalf("terminal = %s %s", done.Type, done.Reason)
	}
	msg := done.Message
	if len(msg.Content) != 2 {
		t.Fatalf("content = %+v", msg.Content)
	}
	if th := msg.Thinking(); !strings.HasPrefix(th, "We need to answer") {
		t.Errorf("thinking = %q", th)
	}
	calls := msg.ToolCalls()
	if len(calls) != 1 || calls[0].ID != "chatcmpl-tool-a51ba31661b534c7" || calls[0].Name != "search_knowledge" {
		t.Fatalf("calls = %+v", calls)
	}
	var args struct{ Query string }
	if err := json.Unmarshal(calls[0].Arguments, &args); err != nil || !strings.Contains(args.Query, "Springfield drop add end date 2024") {
		t.Fatalf("args = %s (%v)", calls[0].Arguments, err)
	}
	if strings.Contains(string(calls[0].Arguments), "\n") {
		t.Errorf("arguments not compacted: %q", calls[0].Arguments)
	}
	want := Usage{Input: 138, Output: 110, Reasoning: 72, Total: 248}
	if msg.Usage != want {
		t.Errorf("usage = %+v, want %+v", msg.Usage, want)
	}
	if msg.ResponseID != "chatcmpl-a1499a07cdfdb137" || msg.Model != "gpt-oss-120b" {
		t.Errorf("ids = %q %q", msg.ResponseID, msg.Model)
	}
	// The toolcall_end event carries the finished call.
	for _, e := range evs {
		if e.Type == EventToolCallEnd && (e.ToolCall == nil || e.ToolCall.ID != calls[0].ID || e.ContentIndex != 1) {
			t.Errorf("toolcall_end = %+v", e)
		}
		if e.Type == EventThinkingEnd && e.Content != msg.Thinking() {
			t.Error("thinking_end content mismatch")
		}
	}

	// Request: stream with usage, max_tokens, tools, user tag, bearer key.
	body := rec.body(0)
	if body["stream"] != true || body["model"] != "gpt-oss-120b" || body["user"] != "grounded-registrar-helper" || body["max_tokens"] != float64(512) {
		t.Errorf("body = %v", body)
	}
	if so, _ := body["stream_options"].(map[string]any); so["include_usage"] != true {
		t.Errorf("stream_options = %v", body["stream_options"])
	}
	if _, ok := body["tool_choice"]; ok {
		t.Error("tool_choice must not be sent by default")
	}
	msgs := body["messages"].([]any)
	if first := msgs[0].(map[string]any); first["role"] != "system" {
		t.Errorf("first message = %v", first)
	}
	if rec.auth[0] != "Bearer sk-secret" {
		t.Error("missing bearer key")
	}
}

func TestRecordedTextStream(t *testing.T) {
	rec := newRecorder(t, sseHandler(fixture(t, "gptoss_text.sse")))
	evs := stream(t, provider(rec.URL, 5*time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{})
	done := terminal(evs)
	if done.Type != EventDone || done.Reason != StopReasonStop {
		t.Fatalf("terminal = %s %s %s", done.Type, done.Reason, done.Message.ErrorMessage)
	}
	msg := done.Message
	if len(msg.Content) != 2 || msg.Content[0].BlockType() != "thinking" || msg.Content[1].BlockType() != "text" {
		t.Fatalf("content = %+v", msg.Content)
	}
	if !strings.Contains(msg.Text(), "\u202f[1]") {
		t.Errorf("text lost U+202F before the marker: %q", msg.Text())
	}
	if msg.Usage.Reasoning != 50 || msg.Usage.Input != 115 || msg.Usage.Output != 72 {
		t.Errorf("usage = %+v", msg.Usage)
	}
	// The thinking block ends when text starts, before any text event.
	var order []EventType
	for _, e := range evs {
		if e.Type == EventThinkingEnd || e.Type == EventTextStart {
			order = append(order, e.Type)
		}
	}
	if len(order) != 2 || order[0] != EventThinkingEnd {
		t.Errorf("order = %v", order)
	}
	// Snapshots are immutable: the first thinking delta still shows one word.
	for _, e := range evs {
		if e.Type == EventThinkingDelta {
			if e.Message.Thinking() != e.Delta {
				t.Errorf("first snapshot mutated: %q vs delta %q", e.Message.Thinking(), e.Delta)
			}
			break
		}
	}
	// Text deltas add up to the final text.
	var sb strings.Builder
	for _, e := range evs {
		if e.Type == EventTextDelta {
			sb.WriteString(e.Delta)
		}
	}
	if sb.String() != msg.Text() {
		t.Error("text deltas do not add up")
	}
}

func TestMultipleToolCallsInterleaved(t *testing.T) {
	raw := sse(
		delta(`{"role":"assistant","content":""}`),
		delta(`{"content":"Let me check."}`),
		delta(`{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"search_knowledge","arguments":""}}]}`),
		delta(`{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"lookup","arguments":"{\"id\":"}}]}`),
		delta(`{"tool_calls":[{"index":0,"function":{"arguments":"{\"query\":"}}]}`),
		delta(`{"tool_calls":[{"index":1,"function":{"arguments":"7}"}}]}`),
		delta(`{"tool_calls":[{"index":0,"function":{"arguments":"\"fees\"}"}}]}`),
		finish("tool_calls"),
		usageChunk,
	)
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{Messages: []Message{UserMessage{Content: "q"}}}, Options{})
	msg := terminal(evs).Message
	calls := msg.ToolCalls()
	if len(calls) != 2 || calls[0].ID != "call_a" || calls[1].ID != "call_b" {
		t.Fatalf("calls = %+v", calls)
	}
	if string(calls[0].Arguments) != `{"query":"fees"}` || string(calls[1].Arguments) != `{"id":7}` || calls[1].Name != "lookup" {
		t.Fatalf("args = %s %s", calls[0].Arguments, calls[1].Arguments)
	}
	if msg.Text() != "Let me check." || msg.StopReason != StopReasonToolUse || msg.Usage.Total != 15 {
		t.Fatalf("msg = %+v", msg)
	}
	// Tool call ends come in content order.
	var ends []int
	for _, e := range evs {
		if e.Type == EventToolCallEnd {
			ends = append(ends, e.ContentIndex)
		}
	}
	if fmt.Sprint(ends) != "[1 2]" {
		t.Errorf("ends = %v", ends)
	}
}

func TestToolCallsWithoutIndexOrID(t *testing.T) {
	raw := sse(
		delta(`{"tool_calls":[{"function":{"name":"search_knowledge","arguments":"{\"query\""}}]}`),
		delta(`{"tool_calls":[{"function":{"arguments":": \"x\"}"}}]}`),
		delta(`{"tool_calls":[{"id":"call_2","function":{"name":"broken","arguments":"{not json"}}]}`),
		delta(`{"tool_calls":[{"id":"call_2","function":{"arguments":" at all"}}]}`),
		finish("stop"), // some servers say stop even with tool calls
	)
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	msg := terminal(evs).Message
	calls := msg.ToolCalls()
	if len(calls) != 2 {
		t.Fatalf("calls = %+v", calls)
	}
	if calls[0].ID != "call_0" || string(calls[0].Arguments) != `{"query":"x"}` {
		t.Errorf("first = %+v %s", calls[0], calls[0].Arguments)
	}
	if calls[1].ID != "call_2" || string(calls[1].Arguments) != `"{not json at all"` {
		t.Errorf("second = %+v %s", calls[1], calls[1].Arguments)
	}
	if msg.StopReason != StopReasonToolUse {
		t.Errorf("stop reason = %s", msg.StopReason)
	}
}

func TestLengthStopAndEmptyArguments(t *testing.T) {
	raw := sse(
		delta(`{"reasoning":"thinking via the reasoning field"}`),
		delta(`{"content":"Partial answer"}`),
		delta(`{"tool_calls":[{"index":0,"id":"t","function":{"name":"noargs","arguments":""}}]}`),
		finish("length"),
	)
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	done := terminal(evs)
	if done.Type != EventDone || done.Reason != StopReasonLength {
		t.Fatalf("terminal = %+v", done)
	}
	if done.Message.Thinking() != "thinking via the reasoning field" || done.Message.Text() != "Partial answer" {
		t.Errorf("msg = %+v", done.Message)
	}
	if args := done.Message.ToolCalls()[0].Arguments; string(args) != "{}" {
		t.Errorf("empty args = %s", args)
	}
}

func TestFinishReasonMapping(t *testing.T) {
	for in, want := range map[string]StopReason{
		"stop": StopReasonStop, "length": StopReasonLength, "tool_calls": StopReasonToolUse,
		"function_call": StopReasonToolUse, "content_filter": StopReasonStop, "eos": StopReasonStop,
	} {
		if got := mapFinishReason(in); got != want {
			t.Errorf("%s -> %s, want %s", in, got, want)
		}
	}
}

func TestInterleavedTextAndThinking(t *testing.T) {
	raw := sse(
		delta(`{"reasoning_content":"a"}`),
		delta(`{"content":"b"}`),
		delta(`{"reasoning_content":"c"}`),
		delta(`{"content":"d"}`),
		finish("stop"),
	)
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	msg := terminal(evs).Message
	var kinds []string
	for _, b := range msg.Content {
		kinds = append(kinds, b.BlockType())
	}
	if strings.Join(kinds, ",") != "thinking,text,thinking,text" || msg.Text() != "bd" || msg.Thinking() != "ac" {
		t.Fatalf("content = %v %+v", kinds, msg.Content)
	}
}

func TestThinkingFieldCompat(t *testing.T) {
	raw := sse(
		delta(`{"reasoning_content":"rc","reasoning":"r"}`),
		finish("stop"),
	)
	for field, want := range map[string]string{"": "rc", "reasoning_content": "rc", "reasoning": "r"} {
		rec := newRecorder(t, sseHandler(raw))
		m := testModel()
		m.Compat.ThinkingField = field
		evs := collect(t, provider(rec.URL, time.Second).Stream(context.Background(), m, Context{}, Options{}))
		if got := terminal(evs).Message.Thinking(); got != want {
			t.Errorf("field %q: thinking = %q, want %q", field, got, want)
		}
	}
}

func TestSSEFramingRobustness(t *testing.T) {
	raw := ": keep-alive comment\r\n" +
		"retry: 1000\r\n" +
		"id: 1\r\n" +
		"data:" + delta(`{"content":"no "}`) + "\r\n\r\n" +
		"\n\n" +
		"data: " + delta(`{"content":"blank "}`) + "\n" + // no blank line between events
		"data: " + delta(`{"content":"lines "}`) + "\n" +
		"event: message\n" +
		"data: " + delta(`{"content":"ok"}`) + "\n\n" +
		": ping\n\n" +
		"data: " + finish("stop") + "\n\n" +
		"data:[DONE]\n\n" +
		"data: " + delta(`{"content":"ignored after DONE"}`) + "\n\n"
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	done := terminal(evs)
	if done.Type != EventDone || done.Message.Text() != "no blank lines ok" {
		t.Fatalf("terminal = %s %q %s", done.Type, done.Message.Text(), done.Message.ErrorMessage)
	}
}

func TestSSEMultiLineData(t *testing.T) {
	// A JSON payload split over two data lines is joined with "\n".
	raw := "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"},\n" +
		"data: \"finish_reason\":\"stop\"}]}\n\n" +
		"data: [DONE]\n\n"
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	if done := terminal(evs); done.Type != EventDone || done.Message.Text() != "hi" {
		t.Fatalf("terminal = %+v", done)
	}
}

func TestEOFWithoutDoneAfterFinish(t *testing.T) {
	raw := "data: " + delta(`{"content":"x"}`) + "\n\ndata: " + finish("stop") // no trailing newline, no [DONE]
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	if done := terminal(evs); done.Type != EventDone || done.Message.Text() != "x" {
		t.Fatalf("terminal = %+v", done)
	}
}

func TestStreamEndsWithoutFinishReason(t *testing.T) {
	cases := map[string]struct {
		raw  string
		kind string
	}{
		"done without finish": {sse(delta(`{"content":"x"}`)), gateway.KindBadResponse},
		"eof without finish":  {"data: " + delta(`{"content":"x"}`) + "\n\n", gateway.KindUnavailable},
		"empty body":          {"", gateway.KindUnavailable},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			rec := newRecorder(t, sseHandler(tc.raw))
			evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
			e := terminal(evs)
			if e.Type != EventError || e.Reason != StopReasonError || e.Message.ErrorKind != tc.kind || e.Message.ErrorMessage == "" {
				t.Fatalf("terminal = %+v", e)
			}
			var ge *gateway.Error
			if !errors.As(e.Err, &ge) || ge.Kind != tc.kind {
				t.Fatalf("err = %v", e.Err)
			}
		})
	}
}

func TestMalformedChunk(t *testing.T) {
	raw := "data: " + delta(`{"content":"partial"}`) + "\n\ndata: {not json\n\n" + "data: " + finish("stop") + "\n\n"
	rec := newRecorder(t, sseHandler(raw))
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	e := terminal(evs)
	if e.Type != EventError || e.Message.ErrorKind != gateway.KindBadResponse || e.Message.Text() != "partial" {
		t.Fatalf("terminal = %+v", e)
	}
	if e.Message.StopReason != StopReasonError {
		t.Errorf("stop reason = %s", e.Message.StopReason)
	}
}

func TestMidStreamErrorChunk(t *testing.T) {
	for name, tc := range map[string]struct{ raw, kind string }{
		"error object": {sse(delta(`{"content":"a"}`), `{"error":{"message":"upstream overloaded","code":503}}`), gateway.KindUnavailable},
		"rate limited": {sse(`{"error":{"message":"slow down","code":"429"}}`), gateway.KindRateLimited},
		"error event":  {"event: error\ndata: {\"detail\":\"boom\"}\n\n", gateway.KindUnavailable},
	} {
		t.Run(name, func(t *testing.T) {
			rec := newRecorder(t, sseHandler(tc.raw))
			evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
			e := terminal(evs)
			if e.Type != EventError || e.Message.ErrorKind != tc.kind {
				t.Fatalf("terminal = %+v", e)
			}
		})
	}
}

func TestJSONResponseToStreamingRequest(t *testing.T) {
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"x","choices":[{"index":0,"message":{"role":"assistant","content":"hello","reasoning_content":"hm",
			"tool_calls":[{"id":"c1","type":"function","function":{"name":"f","arguments":"{\"a\":1}"}}]},"finish_reason":"tool_calls"}],
			"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`)
	})
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	msg := terminal(evs).Message
	if terminal(evs).Type != EventDone || msg.Text() != "hello" || msg.Thinking() != "hm" || len(msg.ToolCalls()) != 1 || msg.Usage.Total != 5 {
		t.Fatalf("msg = %+v", msg)
	}

	bad := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `<html>`)
	})
	evs = stream(t, provider(bad.URL, time.Second), Context{}, Options{})
	if e := terminal(evs); e.Type != EventError || e.Message.ErrorKind != gateway.KindBadResponse {
		t.Fatalf("terminal = %+v", e)
	}
}

func TestHTTPErrors(t *testing.T) {
	for status, kind := range map[int]string{
		401: gateway.KindAuth, 403: gateway.KindAuth, 404: gateway.KindNotFound, 400: gateway.KindBadRequest,
		429: gateway.KindRateLimited, 500: gateway.KindUnavailable, 503: gateway.KindUnavailable,
	} {
		rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = io.WriteString(w, `{"error":{"message":"nope"}}`)
		})
		evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
		if len(evs) != 1 {
			t.Errorf("%d: want only the error event, got %d events", status, len(evs))
		}
		e := terminal(evs)
		var ge *gateway.Error
		if e.Type != EventError || e.Reason != StopReasonError || e.Message.ErrorKind != kind || !errors.As(e.Err, &ge) || ge.Status != status {
			t.Errorf("%d: terminal = %+v", status, e)
		}
		if strings.Contains(e.Message.ErrorMessage, "sk-secret") {
			t.Error("error message leaks the key")
		}
	}
}

func TestTransportError(t *testing.T) {
	evs := stream(t, provider("http://127.0.0.1:1/v1", time.Second), Context{}, Options{})
	e := terminal(evs)
	if len(evs) != 1 || e.Type != EventError || e.Message.ErrorKind != gateway.KindUnavailable {
		t.Fatalf("events = %+v", evs)
	}
	evs = stream(t, provider("://bad", time.Second), Context{}, Options{})
	if e := terminal(evs); e.Message.ErrorKind != gateway.KindBadRequest {
		t.Fatalf("bad url = %+v", e)
	}
}

func TestAbortMidStream(t *testing.T) {
	release := make(chan struct{})
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: "+delta(`{"reasoning_content":"think"}`)+"\n\n")
		_, _ = io.WriteString(w, "data: "+delta(`{"content":"Hello"}`)+"\n\n")
		_, _ = io.WriteString(w, "data: "+delta(`{"tool_calls":[{"index":0,"id":"c","function":{"name":"f","arguments":"{\"a\":"}}]}`)+"\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	defer close(release)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := provider(rec.URL, time.Second).Stream(ctx, testModel(), Context{}, Options{})
	var evs []Event
	for ev := range ch {
		evs = append(evs, ev)
		if ev.Type == EventToolCallDelta {
			cancel()
		}
	}
	checkInvariants(t, evs)
	e := terminal(evs)
	if e.Type != EventError || e.Reason != StopReasonAborted || e.Message.StopReason != StopReasonAborted || !errors.Is(e.Err, context.Canceled) {
		t.Fatalf("terminal = %+v", e)
	}
	if e.Message.Text() != "Hello" || e.Message.Thinking() != "think" {
		t.Errorf("partial = %+v", e.Message)
	}
	if args := e.Message.ToolCalls()[0].Arguments; string(args) != `"{\"a\":"` {
		t.Errorf("partial args = %s", args)
	}
}

func TestAbortBeforeStart(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	evs := collect(t, provider("http://127.0.0.1:1/v1", time.Second).Stream(ctx, testModel(), Context{}, Options{}))
	if len(evs) != 1 || evs[0].Reason != StopReasonAborted {
		t.Fatalf("events = %+v", evs)
	}
	// Cancelled while waiting for headers.
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	evs = collect(t, provider(rec.URL, 5*time.Second).Stream(ctx, testModel(), Context{}, Options{}))
	if e := terminal(evs); e.Reason != StopReasonAborted || !errors.Is(e.Err, context.DeadlineExceeded) {
		t.Fatalf("terminal = %+v", e)
	}
}

func TestIdleTimeout(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: "+delta(`{"content":"slow"}`)+"\n\n")
		w.(http.Flusher).Flush()
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	p := provider(rec.URL, 5*time.Second)
	p.IdleTimeout = 100 * time.Millisecond
	start := time.Now()
	evs := stream(t, p, Context{}, Options{})
	e := terminal(evs)
	if e.Type != EventError || e.Reason != StopReasonError || e.Message.ErrorKind != gateway.KindUnavailable ||
		!strings.Contains(e.Message.ErrorMessage, "no data") || e.Message.Text() != "slow" {
		t.Fatalf("terminal = %+v", e)
	}
	if time.Since(start) > 3*time.Second {
		t.Error("idle timeout too slow")
	}
}

func TestLongStreamOutlivesConnectionTimeout(t *testing.T) {
	// Chunks every 30 ms for ~300 ms, with a 100 ms connection timeout: the
	// timeout covers the response headers only.
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for i := 0; i < 10; i++ {
			_, _ = io.WriteString(w, ": keep-alive\n\n")
			_, _ = io.WriteString(w, "data: "+delta(fmt.Sprintf(`{"content":"%d"}`, i))+"\n\n")
			w.(http.Flusher).Flush()
			time.Sleep(30 * time.Millisecond)
		}
		_, _ = io.WriteString(w, sse(finish("stop")))
	})
	p := provider(rec.URL, 100*time.Millisecond)
	p.IdleTimeout = time.Second
	evs := stream(t, p, Context{}, Options{})
	if e := terminal(evs); e.Type != EventDone || e.Message.Text() != "0123456789" {
		t.Fatalf("terminal = %+v", e)
	}
}

func TestResponseHeaderTimeout(t *testing.T) {
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	})
	evs := stream(t, provider(rec.URL, 80*time.Millisecond), Context{}, Options{})
	e := terminal(evs)
	if len(evs) != 1 || e.Message.ErrorKind != gateway.KindUnavailable || !strings.Contains(e.Message.ErrorMessage, "timed out") {
		t.Fatalf("terminal = %+v", e)
	}
}

func TestInterruptedStream(t *testing.T) {
	rec := newRecorder(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: "+delta(`{"content":"cut"}`)+"\n\n")
		w.(http.Flusher).Flush()
		conn, _, err := w.(http.Hijacker).Hijack()
		if err == nil {
			conn.Close()
		}
	})
	evs := stream(t, provider(rec.URL, time.Second), Context{}, Options{})
	if e := terminal(evs); e.Type != EventError || e.Message.ErrorKind != gateway.KindUnavailable {
		t.Fatalf("terminal = %+v", e)
	}
}

func TestComplete(t *testing.T) {
	rec := newRecorder(t, sseHandler(fixture(t, "gptoss_text.sse")))
	msg, err := Complete(context.Background(), provider(rec.URL, time.Second), testModel(), Context{}, Options{})
	if err != nil || msg.StopReason != StopReasonStop || msg.Text() == "" {
		t.Fatalf("complete = %+v %v", msg, err)
	}

	bad := newRecorder(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) })
	msg, err = Complete(context.Background(), provider(bad.URL, time.Second), testModel(), Context{}, Options{})
	var ge *gateway.Error
	if !errors.As(err, &ge) || ge.Kind != gateway.KindUnavailable || msg.StopReason != StopReasonError {
		t.Fatalf("complete error = %+v %v", msg, err)
	}

	// A provider that closes without a terminal event.
	msg, err = Complete(context.Background(), closedProvider{}, testModel(), Context{}, Options{})
	if err == nil || msg.StopReason != StopReasonError {
		t.Fatalf("closed = %+v %v", msg, err)
	}
	// An error event without Err still yields an error.
	_, err = Complete(context.Background(), fixedProvider{Event{Type: EventError, Reason: StopReasonError,
		Message: AssistantMessage{StopReason: StopReasonError, ErrorMessage: "x"}}}, testModel(), Context{}, Options{})
	if err == nil || err.Error() != "x" {
		t.Fatalf("err = %v", err)
	}
}

type closedProvider struct{}

func (closedProvider) Stream(context.Context, Model, Context, Options) <-chan Event {
	ch := make(chan Event)
	close(ch)
	return ch
}

type fixedProvider []Event

func (f fixedProvider) Stream(context.Context, Model, Context, Options) <-chan Event {
	ch := make(chan Event, len(f))
	for _, e := range f {
		ch <- e
	}
	close(ch)
	return ch
}

func TestSSELineTooLong(t *testing.T) {
	r := newSSEReader(strings.NewReader("data: "+strings.Repeat("x", maxSSELine+10)+"\n\n"), nil)
	if _, err := r.Next(); !errors.Is(err, errLineTooLong) {
		t.Fatalf("err = %v", err)
	}
}
