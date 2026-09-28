package agentloop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/testutil"
)

// --- scripted provider ----------------------------------------------------

type turnFunc func(ctx context.Context, c llm.Context, o llm.Options) []llm.Event

type scripted struct {
	mu    sync.Mutex
	turns []turnFunc
	ctxs  []llm.Context
	opts  []llm.Options
}

func (s *scripted) Stream(ctx context.Context, _ llm.Model, c llm.Context, o llm.Options) <-chan llm.Event {
	s.mu.Lock()
	i := len(s.ctxs)
	s.ctxs = append(s.ctxs, c)
	s.opts = append(s.opts, o)
	var f turnFunc
	if i < len(s.turns) {
		f = s.turns[i]
	} else {
		f = s.turns[len(s.turns)-1]
	}
	s.mu.Unlock()
	ch := make(chan llm.Event)
	go func() {
		defer close(ch)
		for _, e := range f(ctx, c, o) {
			ch <- e
		}
	}()
	return ch
}

func (s *scripted) calls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.ctxs)
}

// reply turns a final message into a realistic event sequence.
func reply(msg llm.AssistantMessage) turnFunc {
	return func(context.Context, llm.Context, llm.Options) []llm.Event {
		var evs []llm.Event
		partial := llm.AssistantMessage{Model: msg.Model}
		evs = append(evs, llm.Event{Type: llm.EventStart, ContentIndex: -1, Message: partial.Clone()})
		for i, b := range msg.Content {
			partial.Content = append(partial.Content, b)
			var start, d, end llm.EventType
			switch b.(type) {
			case llm.Text:
				start, d, end = llm.EventTextStart, llm.EventTextDelta, llm.EventTextEnd
			case llm.Thinking:
				start, d, end = llm.EventThinkingStart, llm.EventThinkingDelta, llm.EventThinkingEnd
			case llm.ToolCall:
				start, d, end = llm.EventToolCallStart, llm.EventToolCallDelta, llm.EventToolCallEnd
			}
			evs = append(evs,
				llm.Event{Type: start, ContentIndex: i, Message: partial.Clone()},
				llm.Event{Type: d, ContentIndex: i, Delta: "x", Message: partial.Clone()},
				llm.Event{Type: end, ContentIndex: i, Message: partial.Clone()})
		}
		final := msg.Clone()
		if msg.StopReason == llm.StopReasonError || msg.StopReason == llm.StopReasonAborted {
			return append(evs, llm.Event{Type: llm.EventError, ContentIndex: -1, Reason: msg.StopReason, Message: final,
				Err: &gateway.Error{Kind: final.ErrorKind, Message: final.ErrorMessage}})
		}
		return append(evs, llm.Event{Type: llm.EventDone, ContentIndex: -1, Reason: msg.StopReason, Message: final})
	}
}

func text(s string) llm.AssistantMessage {
	return llm.AssistantMessage{StopReason: llm.StopReasonStop, Content: []llm.Block{llm.Thinking{Text: "hm"}, llm.Text{Text: s}}}
}

func callsMsg(calls ...llm.ToolCall) llm.AssistantMessage {
	m := llm.AssistantMessage{StopReason: llm.StopReasonToolUse, Content: []llm.Block{llm.Text{Text: "Let me look."}}}
	for _, c := range calls {
		m.Content = append(m.Content, c)
	}
	return m
}

func call(id, name, args string) llm.ToolCall {
	return llm.ToolCall{ID: id, Name: name, Arguments: json.RawMessage(args)}
}

// --- tools ----------------------------------------------------------------

var searchSchema = json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","minLength":1},"maxResults":{"type":"integer","minimum":1,"maximum":20}},"required":["query"],"additionalProperties":false}`)

func searchTool(got *[]string) Tool {
	var mu sync.Mutex
	return Tool{
		Name: "search_knowledge", Label: "Search", Description: "Search the KBs.", Parameters: searchSchema,
		Execute: func(ctx context.Context, id string, params json.RawMessage, onUpdate func(ToolResult)) (ToolResult, error) {
			mu.Lock()
			*got = append(*got, string(params))
			mu.Unlock()
			var p struct{ Query string }
			_ = json.Unmarshal(params, &p)
			return ToolResult{Content: "<sources>" + p.Query + "</sources>", Details: map[string]int{"hits": 2}}, nil
		},
	}
}

// --- invariants -----------------------------------------------------------

type recorder struct {
	mu     sync.Mutex
	events []Event
	active int32
}

func (r *recorder) emit(e Event) {
	if atomic.AddInt32(&r.active, 1) != 1 {
		panic("emit called concurrently")
	}
	defer atomic.AddInt32(&r.active, -1)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, e)
}

func (r *recorder) types() []EventType {
	var out []EventType
	for _, e := range r.events {
		out = append(out, e.Type)
	}
	return out
}

func (r *recorder) of(t EventType) []Event {
	var out []Event
	for _, e := range r.events {
		if e.Type == t {
			out = append(out, e)
		}
	}
	return out
}

func checkInvariants(t *testing.T, evs []Event, returned []llm.Message) {
	t.Helper()
	if len(evs) < 2 || evs[0].Type != AgentStart || evs[len(evs)-1].Type != AgentEnd {
		t.Fatalf("run must start with agent_start and end with agent_end: %v", evs)
	}
	for _, e := range evs[1 : len(evs)-1] {
		if e.Type == AgentStart || e.Type == AgentEnd {
			t.Fatal("agent_start/agent_end must occur exactly once")
		}
	}
	var ended []llm.Message
	turn := 0
	inTurn := false
	phase := "" // "", "assistant", "assistant_done", "tools", "results"
	var calls []llm.ToolCall
	openTools := map[string]bool{}
	results := 0
	for _, e := range evs[1 : len(evs)-1] {
		switch e.Type {
		case TurnStart:
			if inTurn {
				t.Fatal("turn_start inside a turn")
			}
			turn++
			if e.Turn != turn {
				t.Fatalf("turn number %d, want %d", e.Turn, turn)
			}
			inTurn, phase, calls, results = true, "", nil, 0
		case MessageStart:
			if _, ok := e.Message.(llm.AssistantMessage); ok {
				if phase != "" {
					t.Fatalf("assistant message_start in phase %q", phase)
				}
				phase = "assistant"
			} else {
				if phase != "assistant_done" && phase != "tools" && phase != "results" {
					t.Fatalf("tool result message_start in phase %q", phase)
				}
				if len(openTools) > 0 {
					t.Fatal("tool result message before every tool_execution_end")
				}
				phase = "results"
			}
		case MessageUpdate:
			if phase != "assistant" || e.LLMEvent == nil || e.LLMEvent.Type.Terminal() || e.LLMEvent.Type == llm.EventStart {
				t.Fatalf("bad message_update in phase %q: %+v", phase, e.LLMEvent)
			}
		case MessageEnd:
			ended = append(ended, e.Message)
			switch m := e.Message.(type) {
			case llm.AssistantMessage:
				if phase != "assistant" {
					t.Fatalf("assistant message_end in phase %q", phase)
				}
				phase, calls = "assistant_done", m.ToolCalls()
			case llm.ToolResultMessage:
				if m.ToolCallID != calls[results].ID {
					t.Fatalf("result %d for %s, want %s (call order)", results, m.ToolCallID, calls[results].ID)
				}
				results++
			}
		case ToolExecutionStart:
			if phase != "assistant_done" && phase != "tools" {
				t.Fatalf("tool_execution_start in phase %q", phase)
			}
			phase = "tools"
			openTools[e.ToolCallID] = true
		case ToolExecutionUpdate:
			if !openTools[e.ToolCallID] {
				t.Fatal("tool_execution_update outside its execution")
			}
		case ToolExecutionEnd:
			if !openTools[e.ToolCallID] {
				t.Fatal("tool_execution_end without start")
			}
			delete(openTools, e.ToolCallID)
		case TurnEnd:
			if !inTurn || (phase != "assistant_done" && phase != "results") {
				t.Fatalf("turn_end in phase %q (message_end must come first)", phase)
			}
			// Every call gets a result, except in a turn that ended in error/abort.
			if len(e.ToolResults) != results || (results != 0 && results != len(calls)) {
				t.Fatalf("turn_end has %d results, %d calls, %d result messages", len(e.ToolResults), len(calls), results)
			}
			inTurn = false
		}
	}
	if inTurn {
		t.Fatal("run ended inside a turn")
	}
	final := evs[len(evs)-1].Messages
	if !reflect.DeepEqual(final, ended) || !reflect.DeepEqual(returned, ended) {
		t.Fatalf("agent_end/returned messages differ from message_end messages:\n%v\n%v\n%v", final, returned, ended)
	}
}

func run(t *testing.T, ctx context.Context, cfg Config, history []llm.Message) (*recorder, []llm.Message, error) {
	t.Helper()
	rec := &recorder{}
	msgs, err := Run(ctx, cfg, history, rec.emit)
	checkInvariants(t, rec.events, msgs)
	return rec, msgs, err
}

var question = []llm.Message{llm.UserMessage{Content: "How do I drop a class?"}}

// --- tests ----------------------------------------------------------------

func TestToolThenAnswer(t *testing.T) {
	var got []string
	p := &scripted{turns: []turnFunc{
		reply(callsMsg(call("c1", "search_knowledge", `{"query":"drop class","maxResults":null}`))),
		reply(text("Use the student portal [1].")),
	}}
	cfg := Config{Provider: p, SystemPrompt: "sys", Tools: []Tool{searchTool(&got)},
		Options: llm.Options{ToolChoice: llm.ToolChoiceRequired, User: "grounded-t-a"}}
	rec, msgs, err := run(t, context.Background(), cfg, question)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 3 {
		t.Fatalf("messages = %+v", msgs)
	}
	res := msgs[1].(llm.ToolResultMessage)
	if res.IsError || res.Content != "<sources>drop class</sources>" || res.ToolName != "search_knowledge" || res.Details == nil {
		t.Fatalf("result = %+v", res)
	}
	// The optional null was dropped before Execute.
	if len(got) != 1 || got[0] != `{"query":"drop class"}` {
		t.Fatalf("execute got %v", got)
	}
	if msgs[2].(llm.AssistantMessage).Text() != "Use the student portal [1]." {
		t.Fatalf("answer = %+v", msgs[2])
	}
	// Turn 1 offered tools with tool_choice; turn 2 kept tools but not tool_choice.
	if len(p.ctxs[0].Tools) != 1 || p.opts[0].ToolChoice != "required" || p.opts[1].ToolChoice != "" || len(p.ctxs[1].Tools) != 1 {
		t.Errorf("tool offer: %+v / %+v", p.opts, p.ctxs)
	}
	if p.opts[1].User != "grounded-t-a" {
		t.Error("options not kept on later turns")
	}
	// The second request carries the history, the tool call and its result.
	if n := len(p.ctxs[1].Messages); n != 3 || p.ctxs[1].SystemPrompt != "sys" {
		t.Errorf("turn 2 context: %d messages", n)
	}
	want := "agent_start turn_start message_start message_update message_update message_update message_update message_update message_update message_end " +
		"tool_execution_start tool_execution_end message_start message_end turn_end " +
		"turn_start message_start message_update message_update message_update message_update message_update message_update message_end turn_end agent_end"
	if got := fmt.Sprint(rec.types()); got != "["+want+"]" {
		t.Errorf("events:\n%s\nwant\n[%s]", got, want)
	}
	if te := rec.of(TurnEnd); len(te[0].ToolResults) != 1 || te[1].Message.(llm.AssistantMessage).Text() == "" {
		t.Errorf("turn_end = %+v", te)
	}
	// History is not modified.
	if len(question) != 1 {
		t.Error("history modified")
	}
}

func TestValidationErrorsBecomeToolResults(t *testing.T) {
	var got []string
	p := &scripted{turns: []turnFunc{
		reply(callsMsg(
			call("missing", "search_knowledge", `{}`),
			call("type", "search_knowledge", `{"query":5}`),
			call("range", "search_knowledge", `{"query":"x","maxResults":99}`),
			call("extra", "search_knowledge", `{"query":"x","bogus":true}`),
			call("badjson", "search_knowledge", `"{\"query\": oops"`),
			call("array", "search_knowledge", `[1]`),
			call("nullreq", "search_knowledge", `{"query":null}`),
			call("ok", "search_knowledge", `{"query":"fine"}`),
			call("unknown", "delete_everything", `{}`),
		)),
		reply(text("done")),
	}}
	rec, msgs, err := run(t, context.Background(), Config{Provider: p, Tools: []Tool{searchTool(&got)}}, question)
	if err != nil {
		t.Fatal(err)
	}
	results := rec.of(TurnEnd)[0].ToolResults
	if len(results) != 9 {
		t.Fatalf("results = %d", len(results))
	}
	for _, r := range results {
		if (r.ToolCallID == "ok") == r.IsError {
			t.Errorf("%s: isError=%v content=%q", r.ToolCallID, r.IsError, r.Content)
		}
	}
	byID := map[string]string{}
	for _, r := range results {
		byID[r.ToolCallID] = r.Content
	}
	for id, want := range map[string]string{
		"missing": "missing property", "type": "want string", "range": "maximum", "extra": "additional",
		"badjson": "not valid JSON", "array": "must be a JSON object", "nullreq": "want string", "unknown": `"delete_everything" not found`,
	} {
		if !strings.Contains(byID[id], want) {
			t.Errorf("%s: %q does not mention %q", id, byID[id], want)
		}
	}
	t.Logf("example validation result:\n%s", byID["type"])
	if !strings.Contains(byID["type"], "received arguments") || strings.Contains(byID["type"], "mem://") {
		t.Errorf("message format: %q", byID["type"])
	}
	if len(got) != 1 || got[0] != `{"query":"fine"}` {
		t.Errorf("only the valid call runs: %v", got)
	}
	if msgs[len(msgs)-1].(llm.AssistantMessage).Text() != "done" {
		t.Error("loop did not continue after invalid calls")
	}
	// tool_execution_end for invalid calls reports isError.
	for _, e := range rec.of(ToolExecutionEnd) {
		if e.IsError != (e.ToolCallID != "ok") || e.Result == nil {
			t.Errorf("end %s isError=%v", e.ToolCallID, e.IsError)
		}
	}
}

func TestExecuteErrorsAndPanics(t *testing.T) {
	tools := []Tool{
		{Name: "fails", Execute: func(context.Context, string, json.RawMessage, func(ToolResult)) (ToolResult, error) {
			return ToolResult{Details: "d"}, errors.New("backend down")
		}},
		{Name: "panics", Execute: func(context.Context, string, json.RawMessage, func(ToolResult)) (ToolResult, error) {
			panic("boom")
		}},
		{Name: "soft", Execute: func(context.Context, string, json.RawMessage, func(ToolResult)) (ToolResult, error) {
			return ToolResult{Content: "No results.", IsError: true}, nil
		}},
	}
	p := &scripted{turns: []turnFunc{reply(callsMsg(call("a", "fails", `{}`), call("b", "panics", ``), call("c", "soft", `null`))), reply(text("ok"))}}
	rec, _, err := run(t, context.Background(), Config{Provider: p, Tools: tools}, question)
	if err != nil {
		t.Fatal(err)
	}
	res := rec.of(TurnEnd)[0].ToolResults
	if !res[0].IsError || res[0].Content != "backend down" || res[0].Details != "d" {
		t.Errorf("fails = %+v", res[0])
	}
	if !res[1].IsError || !strings.Contains(res[1].Content, "boom") {
		t.Errorf("panics = %+v", res[1])
	}
	if !res[2].IsError || res[2].Content != "No results." {
		t.Errorf("soft = %+v", res[2])
	}
}

func TestParallelExecution(t *testing.T) {
	var running, maxRunning int32
	barrier := make(chan struct{})
	var once sync.Once
	mk := func(name string, delay time.Duration) Tool {
		return Tool{Name: name, Execute: func(ctx context.Context, id string, _ json.RawMessage, onUpdate func(ToolResult)) (ToolResult, error) {
			n := atomic.AddInt32(&running, 1)
			for {
				m := atomic.LoadInt32(&maxRunning)
				if n <= m || atomic.CompareAndSwapInt32(&maxRunning, m, n) {
					break
				}
			}
			if n == 2 {
				once.Do(func() { close(barrier) })
			}
			select { // wait until both run, proving concurrency
			case <-barrier:
			case <-time.After(2 * time.Second):
			}
			onUpdate(ToolResult{Content: "working " + id})
			time.Sleep(delay)
			atomic.AddInt32(&running, -1)
			return ToolResult{Content: "result " + id}, nil
		}}
	}
	p := &scripted{turns: []turnFunc{reply(callsMsg(call("slow", "slow", `{}`), call("fast", "fast", `{}`))), reply(text("ok"))}}
	rec, msgs, err := run(t, context.Background(), Config{Provider: p, Tools: []Tool{mk("slow", 150*time.Millisecond), mk("fast", 0)}}, question)
	if err != nil {
		t.Fatal(err)
	}
	if atomic.LoadInt32(&maxRunning) != 2 {
		t.Error("parallel tools did not run concurrently")
	}
	var starts, ends []string
	for _, e := range rec.of(ToolExecutionStart) {
		starts = append(starts, e.ToolCallID)
	}
	for _, e := range rec.of(ToolExecutionEnd) {
		ends = append(ends, e.ToolCallID)
	}
	if fmt.Sprint(starts) != "[slow fast]" || fmt.Sprint(ends) != "[fast slow]" {
		t.Errorf("starts %v ends %v", starts, ends)
	}
	if len(rec.of(ToolExecutionUpdate)) != 2 {
		t.Errorf("updates = %d", len(rec.of(ToolExecutionUpdate)))
	}
	// Results in call order.
	if msgs[1].(llm.ToolResultMessage).ToolCallID != "slow" || msgs[2].(llm.ToolResultMessage).ToolCallID != "fast" {
		t.Errorf("result order = %v %v", msgs[1], msgs[2])
	}
}

func TestSequentialExecution(t *testing.T) {
	var mu sync.Mutex
	var log []string
	var running int32
	mk := func(name string, mode Mode) Tool {
		return Tool{Name: name, Mode: mode, Execute: func(ctx context.Context, id string, _ json.RawMessage, _ func(ToolResult)) (ToolResult, error) {
			if atomic.AddInt32(&running, 1) != 1 {
				t.Error("sequential batch ran concurrently")
			}
			mu.Lock()
			log = append(log, "start "+id)
			mu.Unlock()
			time.Sleep(20 * time.Millisecond)
			mu.Lock()
			log = append(log, "end "+id)
			mu.Unlock()
			atomic.AddInt32(&running, -1)
			return ToolResult{Content: id}, nil
		}}
	}
	// One sequential tool makes the whole batch sequential.
	p := &scripted{turns: []turnFunc{reply(callsMsg(call("1", "par", `{}`), call("2", "seq", `{}`), call("3", "par", `{}`), call("4", "nope", `{}`))), reply(text("ok"))}}
	rec, _, err := run(t, context.Background(), Config{Provider: p, Tools: []Tool{mk("par", Parallel), mk("seq", Sequential)}}, question)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(log) != "[start 1 end 1 start 2 end 2 start 3 end 3]" {
		t.Errorf("log = %v", log)
	}
	// Each call's start is followed by its end before the next start.
	var seq []string
	for _, e := range rec.events {
		if e.Type == ToolExecutionStart || e.Type == ToolExecutionEnd {
			seq = append(seq, string(e.Type)[15:]+" "+e.ToolCallID)
		}
	}
	if fmt.Sprint(seq) != "[start 1 end 1 start 2 end 2 start 3 end 3 start 4 end 4]" {
		t.Errorf("events = %v", seq)
	}
}

func TestMaxTurnsForcesFinalTurn(t *testing.T) {
	var got []string
	loopForever := reply(callsMsg(call("c", "search_knowledge", `{"query":"again"}`)))
	p := &scripted{turns: []turnFunc{loopForever, loopForever, reply(text("Best effort answer."))}}
	rec, msgs, err := run(t, context.Background(), Config{Provider: p, SystemPrompt: "sys", MaxTurns: 2, Tools: []Tool{searchTool(&got)}}, question)
	if err != nil {
		t.Fatal(err)
	}
	if p.calls() != 3 || len(got) != 2 {
		t.Fatalf("provider calls %d, executions %d", p.calls(), len(got))
	}
	final := p.ctxs[2]
	if len(final.Tools) != 0 || !strings.HasPrefix(final.SystemPrompt, "sys\n\n") || !strings.Contains(final.SystemPrompt, DefaultFinalTurnInstruction) {
		t.Fatalf("final turn context: tools=%d prompt=%q", len(final.Tools), final.SystemPrompt)
	}
	if last := msgs[len(msgs)-1].(llm.AssistantMessage); last.Text() != "Best effort answer." {
		t.Fatalf("last = %+v", last)
	}
	for _, e := range rec.events {
		if e.Turn == 3 && !e.FinalTurn || e.Turn < 3 && e.FinalTurn {
			t.Fatalf("FinalTurn flag wrong on %s turn %d", e.Type, e.Turn)
		}
	}

	// The model keeps calling tools in the final turn: error results, then stop.
	p = &scripted{turns: []turnFunc{loopForever}}
	rec, msgs, err = run(t, context.Background(), Config{Provider: p, MaxTurns: 1, Tools: []Tool{searchTool(&got)},
		FinalTurnInstruction: "ANSWER NOW"}, question)
	if err != nil {
		t.Fatal(err)
	}
	if p.calls() != 2 || p.ctxs[1].SystemPrompt != "ANSWER NOW" {
		t.Fatalf("calls %d prompt %q", p.calls(), p.ctxs[1].SystemPrompt)
	}
	last := msgs[len(msgs)-1].(llm.ToolResultMessage)
	if !last.IsError || !strings.Contains(last.Content, "not available") {
		t.Fatalf("last = %+v", last)
	}
	if len(rec.of(TurnStart)) != 2 {
		t.Error("expected two turns")
	}

	// Default MaxTurns.
	p = &scripted{turns: []turnFunc{loopForever}}
	if _, _, err := run(t, context.Background(), Config{Provider: p, Tools: []Tool{searchTool(&got)}}, question); err != nil || p.calls() != DefaultMaxTurns+1 {
		t.Fatalf("default max turns: %d calls, %v", p.calls(), err)
	}
}

func TestNoToolsConfigured(t *testing.T) {
	p := &scripted{turns: []turnFunc{reply(text("Plain answer."))}}
	_, msgs, err := run(t, context.Background(), Config{Provider: p, Options: llm.Options{ToolChoice: "auto"}}, question)
	if err != nil || len(msgs) != 1 || len(p.ctxs[0].Tools) != 0 {
		t.Fatalf("msgs %v err %v", msgs, err)
	}
	// A hallucinated tool call without tools: unknown-tool result, then continue.
	p = &scripted{turns: []turnFunc{reply(callsMsg(call("h", "search_knowledge", `{}`))), reply(text("ok"))}}
	_, msgs, err = run(t, context.Background(), Config{Provider: p}, question)
	if err != nil || len(msgs) != 3 || !msgs[1].(llm.ToolResultMessage).IsError {
		t.Fatalf("msgs %v err %v", msgs, err)
	}
}

func TestLengthStopDoesNotExecute(t *testing.T) {
	var got []string
	truncated := callsMsg(call("c", "search_knowledge", `{"query":"trunc"}`))
	truncated.StopReason = llm.StopReasonLength
	p := &scripted{turns: []turnFunc{reply(truncated), reply(text("ok"))}}
	_, msgs, err := run(t, context.Background(), Config{Provider: p, Tools: []Tool{searchTool(&got)}}, question)
	if err != nil || len(got) != 0 {
		t.Fatalf("executed %v, err %v", got, err)
	}
	if r := msgs[1].(llm.ToolResultMessage); !r.IsError || !strings.Contains(r.Content, "token limit") {
		t.Fatalf("result = %+v", r)
	}
	// A length stop without tool calls simply ends the run.
	p = &scripted{turns: []turnFunc{reply(llm.AssistantMessage{StopReason: llm.StopReasonLength, Content: []llm.Block{llm.Text{Text: "cut"}}})}}
	if _, msgs, err := run(t, context.Background(), Config{Provider: p}, question); err != nil || len(msgs) != 1 {
		t.Fatalf("msgs %v err %v", msgs, err)
	}
}

func TestProviderError(t *testing.T) {
	failed := llm.AssistantMessage{StopReason: llm.StopReasonError, ErrorKind: gateway.KindRateLimited, ErrorMessage: "slow down",
		Content: []llm.Block{llm.Text{Text: "part"}}}
	p := &scripted{turns: []turnFunc{reply(failed)}}
	rec, msgs, err := run(t, context.Background(), Config{Provider: p}, question)
	var ge *gateway.Error
	if !errors.As(err, &ge) || ge.Kind != gateway.KindRateLimited {
		t.Fatalf("err = %v", err)
	}
	if len(msgs) != 1 || msgs[0].(llm.AssistantMessage).StopReason != llm.StopReasonError || msgs[0].(llm.AssistantMessage).Text() != "part" {
		t.Fatalf("msgs = %+v", msgs)
	}
	if len(rec.of(TurnEnd)) != 1 {
		t.Error("turn_end missing")
	}

	// An error before any content (e.g. HTTP 503): message_start still precedes message_end.
	p = &scripted{turns: []turnFunc{func(context.Context, llm.Context, llm.Options) []llm.Event {
		return []llm.Event{{Type: llm.EventError, ContentIndex: -1, Reason: llm.StopReasonError,
			Message: llm.AssistantMessage{StopReason: llm.StopReasonError, ErrorMessage: "down"}}}
	}}}
	_, _, err = run(t, context.Background(), Config{Provider: p}, question)
	if err == nil || err.Error() != "down" {
		t.Fatalf("err = %v", err)
	}
}

func TestProviderClosesWithoutTerminal(t *testing.T) {
	partial := llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "half"}}}
	p := &scripted{turns: []turnFunc{func(context.Context, llm.Context, llm.Options) []llm.Event {
		return []llm.Event{{Type: llm.EventStart, ContentIndex: -1}, {Type: llm.EventTextStart, Message: partial}}
	}}}
	_, msgs, err := run(t, context.Background(), Config{Provider: p}, question)
	m := msgs[0].(llm.AssistantMessage)
	if err == nil || m.StopReason != llm.StopReasonError || m.Text() != "half" || m.ErrorKind != gateway.KindBadResponse {
		t.Fatalf("msg %+v err %v", m, err)
	}
	// Events after the terminal one are drained and ignored.
	p = &scripted{turns: []turnFunc{func(ctx context.Context, c llm.Context, o llm.Options) []llm.Event {
		evs := reply(text("a"))(ctx, c, o)
		return append(evs, llm.Event{Type: llm.EventTextDelta, Delta: "late"})
	}}}
	if _, msgs, err := run(t, context.Background(), Config{Provider: p}, question); err != nil || msgs[0].(llm.AssistantMessage).Text() != "a" {
		t.Fatalf("msgs %v err %v", msgs, err)
	}
}

func TestAbortDuringStream(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p := &scripted{turns: []turnFunc{func(ctx context.Context, _ llm.Context, _ llm.Options) []llm.Event {
		cancel() // the client disconnects mid-answer
		<-ctx.Done()
		partial := llm.AssistantMessage{Content: []llm.Block{llm.Text{Text: "Partial ans"}}, StopReason: llm.StopReasonAborted, ErrorMessage: "Request was aborted"}
		return []llm.Event{
			{Type: llm.EventStart, ContentIndex: -1},
			{Type: llm.EventTextStart, ContentIndex: 0, Message: partial},
			{Type: llm.EventError, ContentIndex: -1, Reason: llm.StopReasonAborted, Message: partial}, // no Err set
		}
	}}}
	var got []string
	_, msgs, err := run(t, ctx, Config{Provider: p, Tools: []Tool{searchTool(&got)}}, question)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	m := msgs[0].(llm.AssistantMessage)
	if len(msgs) != 1 || m.StopReason != llm.StopReasonAborted || m.Text() != "Partial ans" {
		t.Fatalf("msgs = %+v", msgs)
	}

	// A stream that closes without a terminal event after cancellation is an abort too.
	ctx2, cancel2 := context.WithCancel(context.Background())
	cancel2()
	p = &scripted{turns: []turnFunc{func(context.Context, llm.Context, llm.Options) []llm.Event { return nil }}}
	rec := &recorder{}
	msgs, err = Run(ctx2, Config{Provider: p}, question, rec.emit)
	checkInvariants(t, rec.events, msgs)
	if !errors.Is(err, context.Canceled) || msgs[0].(llm.AssistantMessage).StopReason != llm.StopReasonAborted || p.calls() != 0 {
		t.Fatalf("pre-cancelled: %v %+v calls=%d", err, msgs, p.calls())
	}
}

func TestAbortDuringTools(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var executed []string
	var mu sync.Mutex
	tool := func(name string, mode Mode) Tool {
		return Tool{Name: name, Mode: mode, Execute: func(ctx context.Context, id string, _ json.RawMessage, _ func(ToolResult)) (ToolResult, error) {
			mu.Lock()
			executed = append(executed, id)
			mu.Unlock()
			if id == "1" {
				cancel()
				return ToolResult{}, ctx.Err()
			}
			return ToolResult{Content: "ran"}, nil
		}}
	}
	p := &scripted{turns: []turnFunc{reply(callsMsg(call("1", "t", `{}`), call("2", "t", `{}`))), reply(text("never"))}}
	_, msgs, err := run(t, ctx, Config{Provider: p, Tools: []Tool{tool("t", Sequential)}}, question)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v", err)
	}
	if p.calls() != 1 || fmt.Sprint(executed) != "[1]" {
		t.Fatalf("provider calls %d, executed %v", p.calls(), executed)
	}
	// assistant, two error results (the second never ran), aborted assistant.
	if len(msgs) != 4 {
		t.Fatalf("msgs = %+v", msgs)
	}
	if r := msgs[2].(llm.ToolResultMessage); !r.IsError || r.Content != "Operation aborted" {
		t.Errorf("second result = %+v", r)
	}
	if last := msgs[3].(llm.AssistantMessage); last.StopReason != llm.StopReasonAborted {
		t.Errorf("last = %+v", last)
	}
}

func TestToolUpdatesAfterReturnAreIgnored(t *testing.T) {
	var late func(ToolResult)
	tool := Tool{Name: "t", Execute: func(_ context.Context, _ string, _ json.RawMessage, onUpdate func(ToolResult)) (ToolResult, error) {
		onUpdate(ToolResult{Content: "25%"})
		late = onUpdate
		return ToolResult{Content: "done"}, nil
	}}
	p := &scripted{turns: []turnFunc{reply(callsMsg(call("1", "t", `{}`))), reply(text("ok"))}}
	rec, _, err := run(t, context.Background(), Config{Provider: p, Tools: []Tool{tool}}, question)
	if err != nil {
		t.Fatal(err)
	}
	late(ToolResult{Content: "too late"})
	ups := rec.of(ToolExecutionUpdate)
	if len(ups) != 1 || ups[0].Result.Content != "25%" || ups[0].ToolName != "t" {
		t.Fatalf("updates = %+v", ups)
	}
}

func TestConfigErrors(t *testing.T) {
	exec := func(context.Context, string, json.RawMessage, func(ToolResult)) (ToolResult, error) {
		return ToolResult{}, nil
	}
	p := &scripted{turns: []turnFunc{reply(text("x"))}}
	for name, cfg := range map[string]Config{
		"no provider":  {},
		"no name":      {Provider: p, Tools: []Tool{{Execute: exec}}},
		"duplicate":    {Provider: p, Tools: []Tool{{Name: "a", Execute: exec}, {Name: "a", Execute: exec}}},
		"no execute":   {Provider: p, Tools: []Tool{{Name: "a"}}},
		"bad mode":     {Provider: p, Tools: []Tool{{Name: "a", Execute: exec, Mode: "whenever"}}},
		"bad json":     {Provider: p, Tools: []Tool{{Name: "a", Execute: exec, Parameters: json.RawMessage(`{`)}}},
		"bad schema":   {Provider: p, Tools: []Tool{{Name: "a", Execute: exec, Parameters: json.RawMessage(`{"type":"nonsense"}`)}}},
		"external ref": {Provider: p, Tools: []Tool{{Name: "a", Execute: exec, Parameters: json.RawMessage(`{"$ref":"https://example.com/s.json"}`)}}},
	} {
		called := false
		if _, err := Run(context.Background(), cfg, question, func(Event) { called = true }); err == nil || called {
			t.Errorf("%s: err=%v emitted=%v", name, err, called)
		}
	}
	// A nil emit is allowed.
	if _, err := Run(context.Background(), Config{Provider: p}, question, nil); err != nil {
		t.Fatal(err)
	}
}

// TestEndToEndWithFakeProxy runs the loop against the real adapter and the
// fake proxy: a search_knowledge call, then an answer quoting source 1.
func TestEndToEndWithFakeProxy(t *testing.T) {
	fp := testutil.NewFakeProxy(t)
	prov := llm.NewOpenAI(gateway.New(fp.BaseURL(), fp.APIKey, 5*time.Second))
	tool := Tool{
		Name: "search_knowledge", Label: "Search", Description: "Search.", Parameters: searchSchema,
		Execute: func(_ context.Context, _ string, params json.RawMessage, _ func(ToolResult)) (ToolResult, error) {
			return ToolResult{Content: "<sources>\n<source id=\"1\" title=\"Fees\">\nTuition is due Friday.\n</source>\n</sources>", Details: 1}, nil
		},
	}
	cfg := Config{Provider: prov, Model: llm.Model{ID: "test-chat", SupportsTools: true, Compat: llm.DecodeCompat(nil)},
		SystemPrompt: "Refusal message: \"No idea.\"", Tools: []Tool{tool}}
	rec, msgs, err := run(t, context.Background(), cfg, []llm.Message{llm.UserMessage{Content: "When is tuition due?"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 3 || msgs[2].(llm.AssistantMessage).Text() != "Tuition is due Friday. [1]" {
		t.Fatalf("msgs = %+v", msgs)
	}
	var thinking int
	for _, e := range rec.of(MessageUpdate) {
		if e.LLMEvent.Type == llm.EventThinkingDelta {
			thinking++
		}
	}
	if thinking != 2*len(testutil.FakeReasoning) {
		t.Errorf("thinking deltas = %d", thinking)
	}
	if u := msgs[2].(llm.AssistantMessage).Usage; u.Input == 0 || u.Reasoning != 3 {
		t.Errorf("usage = %+v", u)
	}
}
