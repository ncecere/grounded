// Stream events of an answer (docs/phase3-agents.md §7) and the agent loop
// events that produce them.

package agents

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ncecere/grounded/internal/agentloop"
	"github.com/ncecere/grounded/internal/llm"
)

// Event is one step of an answer, for the SSE stream (docs/phase3-agents.md
// §7): conversation, retrieval, message_start, thinking_delta, text_delta,
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
		// Buffered: the answer's text is sent only after the output
		// moderation check (no text or thinking deltas before).
		Buffered bool `json:"buffered,omitempty"`
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
	ToolResultEvent struct {
		ID       string `json:"id"`
		IsError  bool   `json:"isError"`
		HitCount int    `json:"hitCount"`
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
// errors.
type streamer struct {
	emit    func(Event)
	started bool
	pending []Event
}

func (s *streamer) send(ev Event) {
	if !s.started {
		s.pending = append(s.pending, ev)
		return
	}
	if s.emit != nil {
		s.emit(ev)
	}
}

func (s *streamer) start() {
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
		ru.out.send(Event{"message_start", MessageStartEvent{MessageID: ru.msgID, Buffered: ru.mod.Buffered()}})
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
		le := ev.LLMEvent
		if le == nil {
			return
		}
		switch le.Type {
		case llm.EventTextDelta:
			ru.markFirstToken()
			if st.newText && st.textSoFar.Len() > 0 && !strings.HasSuffix(st.textSoFar.String(), "\n") {
				st.textSoFar.WriteString("\n\n")
				ru.sendDelta("text_delta", "\n\n")
			}
			st.newText = false
			st.textSoFar.WriteString(le.Delta)
			ru.sendDelta("text_delta", le.Delta)
		case llm.EventThinkingDelta:
			ru.markFirstToken()
			if st.newThinking && st.thinkSoFar.Len() > 0 {
				st.thinkSoFar.WriteString("\n\n")
				ru.sendDelta("thinking_delta", "\n\n")
			}
			st.newThinking = false
			st.thinkSoFar.WriteString(le.Delta)
			ru.sendDelta("thinking_delta", le.Delta)
		}
	case agentloop.ToolExecutionStart:
		st.toolCalls++
		args := ev.Args
		if len(args) == 0 {
			args = json.RawMessage("null")
		}
		ru.out.send(Event{"tool_call", ToolCallEvent{ID: ev.ToolCallID, Name: ev.ToolName, Arguments: args}})
	case agentloop.ToolExecutionEnd:
		hitCount := 0
		if ev.Result != nil {
			if d, ok := ev.Result.Details.(toolDetails); ok {
				hitCount = len(d.Hits)
				ru.out.send(Event{"retrieval", RetrievalEvent{Query: d.Query, Hits: d.Hits, Judging: d.Judging}})
			}
		}
		ru.out.send(Event{"tool_result", ToolResultEvent{ID: ev.ToolCallID, IsError: ev.IsError, HitCount: hitCount}})
	}
}

func (ru *run) sendEnd(ans Answer) {
	ru.out.send(Event{"message_end", MessageEndEvent{MessageID: ans.MessageID, StopReason: ans.StopReason, Text: ans.Text,
		Citations: ans.Citations, Usage: ans.Usage, Refused: ans.Refused, NoContext: ans.NoContext,
		NoContextReason: ans.noContextReason, Uncited: ans.Uncited, Claims: ans.Claims}})
}
