// The stream assembler: turns OpenAI-compatible chat chunks into Events and
// the final AssistantMessage (text, thinking and tool-call blocks, usage,
// stop reason and errors).

package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/ncecere/grounded/internal/gateway"
)

// assembler turns chunks into events and the partial message. Text and
// thinking blocks are ended when a block of another kind starts (so a later
// return to text opens a new block); tool call blocks are ended when the
// response finishes, because their argument fragments may interleave by index.
type assembler struct {
	out           chan<- Event
	thinkingField string
	msg           AssistantMessage

	open     int // content index of the open text/thinking block, -1 if none
	openText *strings.Builder
	// pendingSpace holds whitespace-only text deltas that arrived while no
	// text block was open (appendContent).
	pendingSpace string

	calls     map[int]*callState // by stream index (synthetic negative keys when absent)
	lastCall  *callState
	nextSynth int

	finishReason string
	terminated   bool
}

type callState struct {
	contentIndex int
	id, name     string
	args         strings.Builder
	ended        bool
}

func newAssembler(out chan<- Event, modelID, thinkingField string) *assembler {
	return &assembler{
		out: out, thinkingField: thinkingField, open: -1, calls: map[int]*callState{},
		msg: AssistantMessage{Model: modelID, Content: []Block{}},
	}
}

func (a *assembler) emit(ev Event) {
	ev.Message = a.msg.Clone()
	a.out <- ev
}

func (a *assembler) start() {
	a.emit(Event{Type: EventStart, ContentIndex: -1})
}

func (a *assembler) closeOpen() {
	if a.open < 0 {
		return
	}
	idx := a.open
	a.open, a.openText = -1, nil
	if t, ok := a.msg.Content[idx].(Text); ok {
		a.emit(Event{Type: EventTextEnd, ContentIndex: idx, Content: t.Text})
		return
	}
	th := a.msg.Content[idx].(Thinking)
	a.emit(Event{Type: EventThinkingEnd, ContentIndex: idx, Content: th.Text})
}

func (a *assembler) appendText(thinking bool, delta string) {
	if a.open >= 0 {
		_, isThinking := a.msg.Content[a.open].(Thinking)
		if isThinking != thinking {
			a.closeOpen()
		}
	}
	if a.open < 0 {
		a.open, a.openText = len(a.msg.Content), &strings.Builder{}
		if thinking {
			a.msg.Content = append(a.msg.Content, Thinking{})
			a.emit(Event{Type: EventThinkingStart, ContentIndex: a.open})
		} else {
			a.msg.Content = append(a.msg.Content, Text{})
			a.emit(Event{Type: EventTextStart, ContentIndex: a.open})
		}
	}
	a.openText.WriteString(delta)
	if thinking {
		a.msg.Content[a.open] = Thinking{Text: a.openText.String()}
		a.emit(Event{Type: EventThinkingDelta, ContentIndex: a.open, Delta: delta})
	} else {
		a.msg.Content[a.open] = Text{Text: a.openText.String()}
		a.emit(Event{Type: EventTextDelta, ContentIndex: a.open, Delta: delta})
	}
}

// appendContent adds answer text. A whitespace-only delta never opens a
// text block: some models (Qwen3 on SGLang) stream "\n\n" before the answer
// and before a tool call, which would otherwise leave a blank text block.
// Held-back whitespace is dropped before the message's first text, where
// the first text also loses its leading whitespace, and is kept as the
// separator when text follows an earlier text block. Whitespace inside an
// open text block is content and is kept as is.
func (a *assembler) appendContent(delta string) {
	if a.open >= 0 {
		if _, isText := a.msg.Content[a.open].(Text); isText {
			a.appendText(false, delta)
			return
		}
	}
	if strings.TrimSpace(delta) == "" {
		a.pendingSpace += delta
		return
	}
	if a.hasText() {
		delta = a.pendingSpace + delta
	} else {
		delta = strings.TrimLeftFunc(delta, unicode.IsSpace)
	}
	a.pendingSpace = ""
	a.appendText(false, delta)
}

func (a *assembler) hasText() bool {
	for _, b := range a.msg.Content {
		if t, ok := b.(Text); ok && t.Text != "" {
			return true
		}
	}
	return false
}

func (a *assembler) callFor(d toolCallDelta) *callState {
	var cs *callState
	switch {
	case d.Index != nil:
		cs = a.calls[*d.Index]
	case d.ID != "":
		for _, c := range a.calls {
			if c.id == d.ID {
				cs = c
			}
		}
	default:
		cs = a.lastCall
	}
	if cs != nil {
		return cs
	}
	a.closeOpen()
	key := 0
	if d.Index != nil {
		key = *d.Index
	} else {
		a.nextSynth--
		key = a.nextSynth
	}
	cs = &callState{contentIndex: len(a.msg.Content), id: d.ID, name: d.Function.Name}
	a.calls[key] = cs
	a.msg.Content = append(a.msg.Content, ToolCall{ID: cs.id, Name: cs.name})
	a.emit(Event{Type: EventToolCallStart, ContentIndex: cs.contentIndex})
	return cs
}

func (a *assembler) appendToolCall(d toolCallDelta) {
	cs := a.callFor(d)
	a.lastCall = cs
	if cs.id == "" && d.ID != "" {
		cs.id = d.ID
	}
	if cs.name == "" && d.Function.Name != "" {
		cs.name = d.Function.Name
	}
	cs.args.WriteString(d.Function.Arguments)
	a.msg.Content[cs.contentIndex] = ToolCall{ID: cs.id, Name: cs.name}
	a.emit(Event{Type: EventToolCallDelta, ContentIndex: cs.contentIndex, Delta: d.Function.Arguments})
}

// finalizeCall sets the call's final ID and arguments in the message.
func (a *assembler) finalizeCall(cs *callState) ToolCall {
	if cs.id == "" {
		cs.id = "call_" + strconv.Itoa(cs.contentIndex)
	}
	tc := ToolCall{ID: cs.id, Name: cs.name, Arguments: parseArguments(cs.args.String())}
	a.msg.Content[cs.contentIndex] = tc
	return tc
}

// parseArguments returns compact JSON when raw parses, {} when it is empty,
// and otherwise raw as a JSON string so validation can report it.
func parseArguments(raw string) json.RawMessage {
	s := strings.TrimSpace(raw)
	if s == "" {
		return json.RawMessage("{}")
	}
	var buf bytes.Buffer
	if json.Compact(&buf, []byte(s)) == nil {
		return buf.Bytes()
	}
	q, _ := json.Marshal(raw)
	return q
}

// handle applies one chunk. It returns false if the stream has terminated.
func (a *assembler) handle(ch *chunk) bool {
	if ch.Error != nil {
		kind := gateway.KindUnavailable
		if fmt.Sprint(ch.Error.Code) == "429" {
			kind = gateway.KindRateLimited
		}
		msg := ch.Error.Message
		if msg == "" {
			msg = "the model stream reported an error"
		}
		a.fail(StopReasonError, kind, msg, &gateway.Error{Kind: kind, Message: msg})
		return false
	}
	if a.msg.ResponseID == "" {
		a.msg.ResponseID = ch.ID
	}
	if ch.Usage != nil {
		a.msg.Usage = ch.Usage.usage()
	}
	if len(ch.Choices) == 0 {
		return true
	}
	choice := ch.Choices[0]
	d := &choice.Delta
	if t := d.thinking(a.thinkingField); t != "" {
		a.appendText(true, t)
	}
	if d.Content != nil && *d.Content != "" {
		a.appendContent(*d.Content)
	}
	for _, tc := range d.ToolCalls {
		a.appendToolCall(tc)
	}
	if choice.FinishReason != nil && *choice.FinishReason != "" {
		a.finishReason = *choice.FinishReason
	}
	return true
}

func mapFinishReason(r string) StopReason {
	switch r {
	case "length":
		return StopReasonLength
	case "tool_calls", "function_call":
		return StopReasonToolUse
	}
	return StopReasonStop
}

// finish ends the stream normally. sawDone is true when the server sent
// [DONE] (or a complete JSON body), false on a bare EOF.
func (a *assembler) finish(sawDone bool) {
	if a.finishReason == "" {
		if sawDone {
			a.fail(StopReasonError, gateway.KindBadResponse, "the model stream ended without a finish reason", nil)
		} else {
			a.fail(StopReasonError, gateway.KindUnavailable, "the model stream ended before the response finished", nil)
		}
		return
	}
	a.closeOpen()
	hasCalls := false
	for i, b := range a.msg.Content {
		if _, ok := b.(ToolCall); !ok {
			continue
		}
		hasCalls = true
		cs := a.callAt(i)
		if cs == nil || cs.ended {
			continue
		}
		cs.ended = true
		tc := a.finalizeCall(cs)
		a.emit(Event{Type: EventToolCallEnd, ContentIndex: i, ToolCall: &tc})
	}
	reason := mapFinishReason(a.finishReason)
	if reason == StopReasonStop && hasCalls {
		reason = StopReasonToolUse
	}
	a.msg.StopReason = reason
	a.terminated = true
	a.emit(Event{Type: EventDone, ContentIndex: -1, Reason: reason})
}

func (a *assembler) callAt(contentIndex int) *callState {
	for _, cs := range a.calls {
		if cs.contentIndex == contentIndex {
			return cs
		}
	}
	return nil
}

// fail ends the stream with an error event. Open blocks get no end event;
// unfinished tool calls keep whatever arguments arrived.
func (a *assembler) fail(reason StopReason, kind, message string, err error) {
	if a.terminated {
		return
	}
	for _, cs := range a.calls {
		if !cs.ended {
			a.finalizeCall(cs)
		}
	}
	if err == nil {
		err = &gateway.Error{Kind: kind, Message: message}
	}
	a.msg.StopReason, a.msg.ErrorMessage, a.msg.ErrorKind = reason, message, kind
	a.terminated = true
	a.emit(Event{Type: EventError, ContentIndex: -1, Reason: reason, Err: err})
}

// failErr maps a request error: cancellation of the caller's context is an
// abort, anything else an error with the gateway kind.
func (a *assembler) failErr(ctx context.Context, err error) {
	if ctx.Err() != nil {
		a.fail(StopReasonAborted, "", "Request was aborted", ctx.Err())
		return
	}
	var ge *gateway.Error
	if errors.As(err, &ge) {
		a.fail(StopReasonError, ge.Kind, ge.Error(), err)
		return
	}
	a.fail(StopReasonError, gateway.KindUnavailable, err.Error(), err)
}

func (a *assembler) failRead(ctx, reqCtx context.Context, idle time.Duration, err error) {
	switch {
	case ctx.Err() != nil:
		a.fail(StopReasonAborted, "", "Request was aborted", ctx.Err())
	case errors.Is(context.Cause(reqCtx), errIdle):
		msg := fmt.Sprintf("the model sent no data for %s", idle)
		a.fail(StopReasonError, gateway.KindUnavailable, msg, &gateway.Error{Kind: gateway.KindUnavailable, Message: msg})
	case errors.Is(err, errLineTooLong):
		a.fail(StopReasonError, gateway.KindBadResponse, "the model stream sent an oversized line", err)
	default:
		a.fail(StopReasonError, gateway.KindUnavailable, "the model stream was interrupted", &gateway.Error{Kind: gateway.KindUnavailable, Message: "stream interrupted"})
	}
}
