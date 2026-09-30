package agentloop

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ncecere/grounded/internal/gateway"
	"github.com/ncecere/grounded/internal/llm"
	"github.com/ncecere/grounded/internal/tracing"
)

// DefaultMaxTurns is used when Config.MaxTurns is not positive.
const DefaultMaxTurns = 4

// DefaultFinalTurnInstruction is appended to the system prompt for the forced
// final turn.
const DefaultFinalTurnInstruction = "You have reached the limit for tool use. Do not call any tools. " +
	"Answer now using only the information you already have."

// Config configures one Run.
type Config struct {
	Provider     llm.Provider
	Model        llm.Model
	SystemPrompt string
	Tools        []Tool
	// MaxTurns is how many turns may offer tools (default 4). If the model is
	// still calling tools after that, one more turn runs without tools.
	MaxTurns int
	// Options are sent on every turn, except ToolChoice, which is sent on the
	// first turn only (forcing a tool call on every turn would never let the
	// model answer).
	Options llm.Options
	// FinalTurnInstruction replaces DefaultFinalTurnInstruction.
	FinalTurnInstruction string
}

// EventType names a loop event.
type EventType string

const (
	AgentStart          EventType = "agent_start"
	AgentEnd            EventType = "agent_end"
	TurnStart           EventType = "turn_start"
	TurnEnd             EventType = "turn_end"
	MessageStart        EventType = "message_start"
	MessageUpdate       EventType = "message_update"
	MessageEnd          EventType = "message_end"
	ToolExecutionStart  EventType = "tool_execution_start"
	ToolExecutionUpdate EventType = "tool_execution_update"
	ToolExecutionEnd    EventType = "tool_execution_end"
)

// Event is one step of a run. Fields not relevant to Type are zero.
type Event struct {
	Type EventType
	// Turn is the 1-based turn number (0 for agent_start and agent_end).
	Turn int
	// FinalTurn is set on every event of the forced final turn (tools
	// withheld because MaxTurns was reached).
	FinalTurn bool

	// Message is the message for message_start/update/end (an
	// llm.AssistantMessage or llm.ToolResultMessage) and the assistant
	// message for turn_end. On message_update it is the partial message.
	Message llm.Message
	// LLMEvent is the provider event wrapped by message_update (never a
	// terminal done/error: those become message_end).
	LLMEvent *llm.Event

	// Tool execution events.
	ToolCallID string
	ToolName   string
	Args       json.RawMessage // the model's arguments as received
	Result     *ToolResult     // partial on update, final on end
	IsError    bool            // tool_execution_end

	// ToolResults are the turn's results in call order (turn_end).
	ToolResults []llm.ToolResultMessage
	// Messages are all new messages of the run (agent_end).
	Messages []llm.Message
}

// Run drives the model until it answers without tool calls, see the package
// documentation. history is the conversation so far and must end with the
// new user message; it is not modified. Run returns the new messages
// (assistant and tool results, in order). The error is non-nil when the run
// ended on a provider error (wrapping *gateway.Error) or was aborted
// (context.Canceled or DeadlineExceeded); the messages, including the partial
// assistant message, are still returned. An invalid Config returns an error
// before any event.
func Run(ctx context.Context, cfg Config, history []llm.Message, emit func(Event)) ([]llm.Message, error) {
	if cfg.Provider == nil {
		return nil, errors.New("agentloop: no provider")
	}
	tools, err := compileTools(cfg.Tools)
	if err != nil {
		return nil, err
	}
	maxTurns := cfg.MaxTurns
	if maxTurns <= 0 {
		maxTurns = DefaultMaxTurns
	}
	finalInstruction := cfg.FinalTurnInstruction
	if finalInstruction == "" {
		finalInstruction = DefaultFinalTurnInstruction
	}
	r := &runner{cfg: cfg, tools: tools, emitFn: emit}

	messages := append([]llm.Message(nil), history...)
	var added []llm.Message
	r.emit(Event{Type: AgentStart})
	end := func(err error) ([]llm.Message, error) {
		r.emit(Event{Type: AgentEnd, Messages: append([]llm.Message(nil), added...)})
		return added, err
	}

	for turn := 1; ; turn++ {
		final := turn > maxTurns
		r.turn, r.final = turn, final
		r.emit(Event{Type: TurnStart})
		tctx, span := tracing.Start(ctx, "agent.turn", attribute.Int("grounded.agent.turn", turn), attribute.Bool("grounded.agent.final_turn", final))

		lctx, opts := turnRequest(cfg, messages, turn, final, finalInstruction)

		var msg llm.AssistantMessage
		if ctx.Err() != nil {
			msg, err = r.abortedMessage(ctx)
		} else {
			msg, err = r.streamTurn(tctx, lctx, opts)
		}
		messages = append(messages, msg)
		added = append(added, msg)
		if msg.StopReason == llm.StopReasonError || msg.StopReason == llm.StopReasonAborted {
			endTurn(span, msg, 0)
			r.emit(Event{Type: TurnEnd, Message: msg})
			return end(err)
		}

		calls := msg.ToolCalls()
		if len(calls) == 0 {
			endTurn(span, msg, 0)
			r.emit(Event{Type: TurnEnd, Message: msg})
			return end(nil)
		}
		results := r.toolResults(tctx, msg, calls, final)
		for _, res := range results {
			messages = append(messages, res)
			added = append(added, res)
		}
		endTurn(span, msg, len(calls))
		r.emit(Event{Type: TurnEnd, Message: msg, ToolResults: results})
		if final {
			return end(nil)
		}
	}
}

// endTurn ends a turn's span with its stop reason and tool call count.
func endTurn(span trace.Span, msg llm.AssistantMessage, calls int) {
	span.SetAttributes(attribute.String("grounded.agent.stop_reason", string(msg.StopReason)), attribute.Int("grounded.agent.tool_calls", calls))
	if msg.StopReason == llm.StopReasonError || msg.StopReason == llm.StopReasonAborted {
		tracing.Fail(span, string(msg.StopReason))
	}
	span.End()
}

// turnRequest is the model request of a turn: tools are offered except on
// the final turn, which instead gets the final-turn instruction; a forced
// tool choice applies to the first turn only.
func turnRequest(cfg Config, messages []llm.Message, turn int, final bool, finalInstruction string) (llm.Context, llm.Options) {
	lctx := llm.Context{SystemPrompt: cfg.SystemPrompt, Messages: messages}
	opts := cfg.Options
	if turn > 1 {
		opts.ToolChoice = ""
	}
	if final {
		if lctx.SystemPrompt != "" {
			lctx.SystemPrompt += "\n\n"
		}
		lctx.SystemPrompt += finalInstruction
		opts.ToolChoice = ""
	} else if len(cfg.Tools) > 0 {
		lctx.Tools = toolDecls(cfg.Tools)
	}
	return lctx, opts
}

// toolResults runs the turn's tool calls, or refuses them on the final turn
// and when the response was cut off.
func (r *runner) toolResults(ctx context.Context, msg llm.AssistantMessage, calls []llm.ToolCall, final bool) []llm.ToolResultMessage {
	switch {
	case final:
		return r.failCalls(calls, "Tools are not available in this turn; answer without them.")
	case msg.StopReason == llm.StopReasonLength:
		// Arguments may be truncated; running them could do the wrong thing.
		return r.failCalls(calls, "This tool call was not executed: the response hit the output token limit, "+
			"so its arguments may be truncated. Re-issue the call with complete arguments.")
	}
	return r.execute(ctx, calls)
}

type runner struct {
	cfg    Config
	tools  map[string]*compiledTool
	emitFn func(Event)
	mu     sync.Mutex // serializes emit (parallel tools)
	turn   int
	final  bool
}

func (r *runner) emit(ev Event) {
	if r.emitFn == nil {
		return
	}
	if ev.Type != AgentStart && ev.Type != AgentEnd {
		ev.Turn, ev.FinalTurn = r.turn, r.final
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.emitFn(ev)
}

func abortErr(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return context.Canceled
}

// abortedMessage records a turn that could not start because the context was
// already cancelled (for example during tool execution).
func (r *runner) abortedMessage(ctx context.Context) (llm.AssistantMessage, error) {
	msg := llm.AssistantMessage{Model: r.cfg.Model.ID, StopReason: llm.StopReasonAborted, ErrorMessage: "Request was aborted"}
	r.emit(Event{Type: MessageStart, Message: msg})
	r.emit(Event{Type: MessageEnd, Message: msg})
	return msg, abortErr(ctx)
}

// streamTurn runs one provider stream, forwarding its events.
func (r *runner) streamTurn(ctx context.Context, lctx llm.Context, opts llm.Options) (llm.AssistantMessage, error) {
	var (
		started  bool
		terminal *llm.Event
		last     = llm.AssistantMessage{Model: r.cfg.Model.ID}
	)
	for ev := range r.cfg.Provider.Stream(ctx, r.cfg.Model, lctx, opts) {
		if terminal != nil {
			continue // drain anything after the terminal event
		}
		if ev.Type.Terminal() {
			e := ev
			terminal = &e
			continue
		}
		last = ev.Message
		if !started {
			started = true
			r.emit(Event{Type: MessageStart, Message: ev.Message})
		}
		if ev.Type == llm.EventStart {
			continue
		}
		e := ev
		r.emit(Event{Type: MessageUpdate, Message: ev.Message, LLMEvent: &e})
	}

	var msg llm.AssistantMessage
	var err error
	switch {
	case terminal == nil:
		msg = last
		msg.StopReason, msg.ErrorKind = llm.StopReasonError, gateway.KindBadResponse
		msg.ErrorMessage = "the model stream ended without a result"
		err = &gateway.Error{Kind: gateway.KindBadResponse, Message: msg.ErrorMessage}
		if ctx.Err() != nil {
			msg.StopReason, msg.ErrorKind, msg.ErrorMessage, err = llm.StopReasonAborted, "", "Request was aborted", ctx.Err()
		}
	case terminal.Type == llm.EventDone:
		msg = terminal.Message
	default:
		msg = terminal.Message
		err = terminal.Err
		if msg.StopReason != llm.StopReasonAborted {
			msg.StopReason = llm.StopReasonError
		}
		if err == nil {
			if msg.StopReason == llm.StopReasonAborted {
				err = abortErr(ctx)
			} else {
				err = errors.New(msg.ErrorMessage)
			}
		}
	}
	if !started {
		r.emit(Event{Type: MessageStart, Message: msg})
	}
	r.emit(Event{Type: MessageEnd, Message: msg})
	return msg, err
}

// outcome is a finished tool call.
type outcome struct {
	call    llm.ToolCall
	result  ToolResult
	isError bool
}

func (r *runner) resultMessage(o outcome) llm.ToolResultMessage {
	return llm.ToolResultMessage{
		ToolCallID: o.call.ID, ToolName: o.call.Name, Content: o.result.Content,
		Details: o.result.Details, IsError: o.isError,
	}
}

func (r *runner) endCall(o outcome) {
	res := o.result
	r.emit(Event{Type: ToolExecutionEnd, ToolCallID: o.call.ID, ToolName: o.call.Name, Args: o.call.Arguments, Result: &res, IsError: o.isError})
}

func (r *runner) emitResults(outcomes []outcome) []llm.ToolResultMessage {
	out := make([]llm.ToolResultMessage, len(outcomes))
	for i, o := range outcomes {
		out[i] = r.resultMessage(o)
		r.emit(Event{Type: MessageStart, Message: out[i]})
		r.emit(Event{Type: MessageEnd, Message: out[i]})
	}
	return out
}

func errorResult(msg string) ToolResult { return ToolResult{Content: msg, IsError: true} }

// failCalls answers every call with an error without running anything.
func (r *runner) failCalls(calls []llm.ToolCall, reason string) []llm.ToolResultMessage {
	outcomes := make([]outcome, len(calls))
	for i, c := range calls {
		r.emit(Event{Type: ToolExecutionStart, ToolCallID: c.ID, ToolName: c.Name, Args: c.Arguments})
		outcomes[i] = outcome{call: c, result: errorResult(reason), isError: true}
		r.endCall(outcomes[i])
	}
	return r.emitResults(outcomes)
}

// prepare finds and validates a call. It returns the tool and arguments, or
// an immediate error outcome.
func (r *runner) prepare(c llm.ToolCall) (*compiledTool, json.RawMessage, *outcome) {
	t := r.tools[c.Name]
	if t == nil {
		return nil, nil, &outcome{call: c, result: errorResult(fmt.Sprintf("Tool %q not found", c.Name)), isError: true}
	}
	args, err := t.validate(c.Arguments)
	if err != nil {
		return nil, nil, &outcome{call: c, result: errorResult(err.Error()), isError: true}
	}
	return t, args, nil
}

// run executes a prepared call, turning errors and panics into error results.
func (r *runner) run(ctx context.Context, t *compiledTool, c llm.ToolCall, args json.RawMessage) (o outcome) {
	// The tool's name is a registered tool's (prepare refused others); the
	// arguments and the result are never recorded.
	ctx, span := tracing.Start(ctx, "execute_tool "+c.Name, attribute.String("gen_ai.operation.name", "execute_tool"),
		attribute.String("gen_ai.tool.name", c.Name))
	defer func() {
		if o.isError {
			tracing.Fail(span, "tool_error")
		}
		span.End()
	}()
	o.call = c
	if ctx.Err() != nil {
		o.result, o.isError = errorResult("Operation aborted"), true
		return o
	}
	var mu sync.Mutex
	accepting := true
	onUpdate := func(partial ToolResult) {
		mu.Lock()
		ok := accepting
		mu.Unlock()
		if ok {
			p := partial
			r.emit(Event{Type: ToolExecutionUpdate, ToolCallID: c.ID, ToolName: c.Name, Args: c.Arguments, Result: &p})
		}
	}
	defer func() {
		mu.Lock()
		accepting = false
		mu.Unlock()
		if p := recover(); p != nil {
			o.result, o.isError = errorResult(fmt.Sprintf("Tool %q failed: %v", c.Name, p)), true
		}
	}()
	res, err := t.Execute(ctx, c.ID, args, onUpdate)
	if err != nil {
		return outcome{call: c, result: ToolResult{Content: err.Error(), Details: res.Details, IsError: true}, isError: true}
	}
	return outcome{call: c, result: res, isError: res.IsError}
}

// execute runs the calls of one assistant message. Results are returned in
// call order whatever the execution order.
func (r *runner) execute(ctx context.Context, calls []llm.ToolCall) []llm.ToolResultMessage {
	sequential := false
	for _, c := range calls {
		if t := r.tools[c.Name]; t != nil && t.Mode == Sequential {
			sequential = true
		}
	}
	outcomes := make([]outcome, len(calls))
	if sequential {
		for i, c := range calls {
			r.emit(Event{Type: ToolExecutionStart, ToolCallID: c.ID, ToolName: c.Name, Args: c.Arguments})
			if t, args, imm := r.prepare(c); imm != nil {
				outcomes[i] = *imm
			} else {
				outcomes[i] = r.run(ctx, t, c, args)
			}
			r.endCall(outcomes[i])
		}
		return r.emitResults(outcomes)
	}

	var wg sync.WaitGroup
	for i, c := range calls {
		r.emit(Event{Type: ToolExecutionStart, ToolCallID: c.ID, ToolName: c.Name, Args: c.Arguments})
		t, args, imm := r.prepare(c)
		if imm != nil {
			outcomes[i] = *imm
			r.endCall(outcomes[i])
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			outcomes[i] = r.run(ctx, t, c, args)
			r.endCall(outcomes[i])
		}()
	}
	wg.Wait()
	return r.emitResults(outcomes)
}
