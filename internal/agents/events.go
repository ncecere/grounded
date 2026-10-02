// Stream events of an answer (docs/phase3-agents.md §7) and the agent loop
// events that produce them.

package agents

import (
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agentloop"
	"github.com/ncecere/grounded/internal/llm"
)

// Event is one step of an answer, for the SSE stream (docs/phase3-agents.md
// §7): conversation, status (progress.go), retrieval, message_start, thinking_delta, text_delta,
// tool_call, tool_result, moderation (docs/phase4-publishing.md §4),
// message_end, citations_checked (docs/systemone.md §3), error.
type Event struct {
	Type string
	Data any
}

// Event payloads.
type (
	ConversationEvent struct {
		ConversationID *uuid.UUID `json:"conversationId"`
		UserMessageID  *uuid.UUID `json:"userMessageId"`
		AgentVersion   *int32     `json:"agentVersion"`
	}
	// StatusEvent says what the agent is doing before the answer's first
	// words: one of the Step constants.
	StatusEvent struct {
		Step string `json:"step"`
	}
	RetrievalHit struct {
		N       int    `json:"n"`
		Title   string `json:"title"`
		URL     string `json:"url,omitempty"`
		Snippet string `json:"snippet"`
		// Conflicting: SystemOne judging found it contradicts the
		// question's premise (docs/systemone.md §2).
		Conflicting bool `json:"conflicting,omitempty"`
		// Kind is tool for an MCP tool's result, with its server and tool
		// (docs/mcp-client.md); empty for passages.
		Kind   string `json:"kind,omitempty"`
		Server string `json:"server,omitempty"`
		Tool   string `json:"tool,omitempty"`
	}
	RetrievalEvent struct {
		Query string         `json:"query"`
		Hits  []RetrievalHit `json:"hits"`
		// Judging counts the search's judged candidates, when judged.
		Judging *RetrievalJudging `json:"judging,omitempty"`
	}
	// RetrievalJudging: candidates judged, passages given to the model
	// ("20 passages checked, 5 used") and passages dropped.
	RetrievalJudging struct {
		Judged  int `json:"judged"`
		Kept    int `json:"kept"`
		Dropped int `json:"dropped"`
	}
	MessageStartEvent struct {
		MessageID uuid.UUID `json:"messageId"`
		// Buffered: the answer's text arrives whole (no text or thinking
		// deltas before): sent only after the output moderation check, or
		// a saved answer's replay (cache.go).
		Buffered bool `json:"buffered,omitempty"`
		// Mode is the output moderation mode when answers are moderated
		// (stream_retract, stream_checked, buffer); stream_checked sends
		// checked paragraphs and no thinking (streamcheck.go).
		Mode string `json:"mode,omitempty"`
	}
	// ModerationEvent says a message was blocked: the question (stage
	// input: nothing was retrieved or generated) or the answer (stage
	// output: retracted after streaming, or withheld when buffered). The
	// notice replaces the message. Action unavailable: the provider failed
	// and the policy fails closed.
	ModerationEvent struct {
		Stage    string `json:"stage"`
		Action   string `json:"action"`
		Category string `json:"category,omitempty"`
		Notice   string `json:"notice"`
	}
	DeltaEvent struct {
		Delta string `json:"delta"`
	}
	ToolCallEvent struct {
		ID        string          `json:"id"`
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	// ToolResultEvent: Error says why a call failed or wasn't made;
	// Result is what an MCP tool returned, or a note (stepOutcome).
	ToolResultEvent struct {
		ID       string `json:"id"`
		IsError  bool   `json:"isError"`
		HitCount int    `json:"hitCount"`
		Error    string `json:"error,omitempty"`
		Result   string `json:"result,omitempty"`
	}
	MessageEndEvent struct {
		MessageID  uuid.UUID  `json:"messageId"`
		StopReason string     `json:"stopReason"`
		Text       string     `json:"text"`
		Citations  []Citation `json:"citations"`
		Usage      llm.Usage  `json:"usage"`
		Refused    bool       `json:"refused"`
		NoContext  bool       `json:"noContext"`
		// NoContextReason is judged_out when judging dropped every
		// candidate of a strict agent (no chat-model call), small_talk when
		// the scope check answered small talk without retrieval, and
		// out_of_scope when a strict agent refused a question outside its
		// subject (no retrieval, no chat-model call).
		NoContextReason string `json:"noContextReason,omitempty"`
		// Uncited and Claims: citations were checked before release
		// (buffer, JSON).
		Uncited []UncitedSentence `json:"uncited,omitempty"`
		Claims  []Claim           `json:"claims,omitempty"`
	}
	ErrorEvent struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
)

// streamer holds events back until the answer starts (the model responded
// or a refusal needs no model), so failures before that are plain HTTP
// errors. Events are sent one at a time: checked paragraphs are released
// by their checker's goroutine (streamcheck.go).
type streamer struct {
	mu      sync.Mutex
	emit    func(Event)
	started bool
	pending []Event
}

func (s *streamer) send(ev Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		s.pending = append(s.pending, ev)
		return
	}
	if s.emit != nil {
		s.emit(ev)
	}
}

func (s *streamer) start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return
	}
	s.started = true
	for _, ev := range s.pending {
		if s.emit != nil {
			s.emit(ev)
		}
	}
	s.pending = nil
}

type loopState struct {
	msgStarted   bool
	textSoFar    strings.Builder
	thinkSoFar   strings.Builder
	newText      bool // the current assistant message has not produced text yet
	newThinking  bool
	toolCalls    int
	answerStarts bool // the model responded (streaming started)
}

func (ru *run) markFirstToken() {
	if ru.firstToken == 0 {
		ru.firstToken = time.Since(ru.started)
	}
}

func (ru *run) startAnswer(st *loopState) {
	ru.out.start()
	if !st.msgStarted {
		st.msgStarted = true
		ru.out.send(Event{"message_start", MessageStartEvent{MessageID: ru.msgID, Buffered: ru.mod.Buffered(), Mode: ru.mod.OutputMode()}})
	}
}

func (ru *run) onEvent(ev agentloop.Event, st *loopState) {
	switch ev.Type {
	case agentloop.MessageStart:
		if m, ok := ev.Message.(llm.AssistantMessage); ok {
			st.newText, st.newThinking = true, true
			if m.StopReason == "" {
				st.answerStarts = true
				ru.startAnswer(st)
			}
		}
	case agentloop.MessageUpdate:
		if ev.LLMEvent != nil {
			ru.onDelta(ev.LLMEvent, st)
		}
	case agentloop.ToolExecutionStart:
		st.toolCalls++
		args := ev.Args
		if len(args) == 0 {
			args = json.RawMessage("null")
		}
		ru.out.send(Event{"tool_call", ToolCallEvent{ID: ev.ToolCallID, Name: ev.ToolName, Arguments: args}})
	case agentloop.ToolExecutionEnd:
		res := ToolResultEvent{ID: ev.ToolCallID, IsError: ev.IsError}
		if ev.Result != nil {
			if d, ok := ev.Result.Details.(toolDetails); ok {
				res.HitCount = len(d.Hits)
				res.Error, res.Result = stepOutcome(ev.IsError, d)
				ru.out.send(Event{"retrieval", RetrievalEvent{Query: d.Query, Hits: d.Hits, Judging: d.Judging}})
			}
		}
		ru.out.send(Event{"tool_result", res})
	}
}

// onDelta handles the model's text and thinking as they stream.
func (ru *run) onDelta(le *llm.Event, st *loopState) {
	switch le.Type {
	case llm.EventTextDelta:
		ru.markFirstToken()
		if st.newText && st.textSoFar.Len() > 0 && !strings.HasSuffix(st.textSoFar.String(), "\n") {
			st.textSoFar.WriteString("\n\n")
			ru.sendDelta("text_delta", "\n\n")
		}
		st.newText = false
		st.textSoFar.WriteString(le.Delta)
		if ru.step == StepThinking {
			ru.status(StepAnswering) // writing now (the text is held until checked)
		}
		ru.sendDelta("text_delta", le.Delta)
	case llm.EventThinkingDelta:
		ru.markFirstToken()
		if ru.mod.Buffered() || ru.mod.Checked() {
			ru.status(StepThinking) // thinking isn't shown in these modes: say it's happening
		}
		if st.newThinking && st.thinkSoFar.Len() > 0 {
			st.thinkSoFar.WriteString("\n\n")
			ru.sendDelta("thinking_delta", "\n\n")
		}
		st.newThinking = false
		st.thinkSoFar.WriteString(le.Delta)
		ru.sendDelta("thinking_delta", le.Delta)
	}
}

// stepOutcome is a tool call's step in words: why it failed or wasn't made
// (errText), and what an MCP tool returned (its source's snippet) or a note
// such as "The tool returned nothing." (result). A search's result is its
// hit count, so it has neither unless it failed.
func stepOutcome(isError bool, d toolDetails) (errText, result string) {
	if isError {
		switch {
		case d.Reason != "":
			errText = d.Reason
		case d.Error == "retrieval_failed":
			errText = "The search failed."
		default: // stored without a reason
			errText = "The call failed."
		}
		return errText, d.Note
	}
	for _, h := range d.Hits {
		if h.Kind == SourceTool {
			return "", h.Snippet
		}
	}
	return "", d.Note
}

func (ru *run) sendEnd(ans Answer) {
	ru.out.send(Event{"message_end", MessageEndEvent{MessageID: ans.MessageID, StopReason: ans.StopReason, Text: ans.Text,
		Citations: ans.Citations, Usage: ans.Usage, Refused: ans.Refused, NoContext: ans.NoContext,
		NoContextReason: ans.noContextReason, Uncited: ans.Uncited, Claims: ans.Claims}})
}
