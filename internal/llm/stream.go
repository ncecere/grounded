package llm

import (
	"context"
	"encoding/json"
)

// Provider streams one assistant response.
//
// Stream never blocks on the network: it returns a channel at once and does
// the work in a goroutine. See the package documentation for the event
// contract. Callers must drain the channel until it closes; cancelling ctx
// makes the stream finish quickly with an aborted error event.
type Provider interface {
	Stream(ctx context.Context, model Model, c Context, opts Options) <-chan Event
}

// Context is everything sent to the model.
type Context struct {
	SystemPrompt string
	Messages     []Message
	Tools        []Tool
}

// Tool declares a function the model may call.
type Tool struct {
	Name        string
	Description string
	Parameters  json.RawMessage // JSON Schema for the arguments object
}

// Tool choice values.
const (
	ToolChoiceAuto     = "auto"
	ToolChoiceNone     = "none"
	ToolChoiceRequired = "required"
)

// Options tune one request. Zero values are omitted from the request.
type Options struct {
	Temperature     *float64
	MaxTokens       int    // clamped to the model's MaxOutputTokens when known
	ReasoningEffort string // off | low | medium | high; sent only when compat allows (off: Compat.ThinkingOff)
	User            string // OpenAI "user" tag, see UserTag
	ToolChoice      string // auto | none | required; sent only when compat allows and tools are present
}

// EventType names a stream event.
type EventType string

const (
	EventStart         EventType = "start"
	EventTextStart     EventType = "text_start"
	EventTextDelta     EventType = "text_delta"
	EventTextEnd       EventType = "text_end"
	EventThinkingStart EventType = "thinking_start"
	EventThinkingDelta EventType = "thinking_delta"
	EventThinkingEnd   EventType = "thinking_end"
	EventToolCallStart EventType = "toolcall_start"
	EventToolCallDelta EventType = "toolcall_delta"
	EventToolCallEnd   EventType = "toolcall_end"
	EventDone          EventType = "done"
	EventError         EventType = "error"
)

// Terminal reports whether t ends a stream.
func (t EventType) Terminal() bool { return t == EventDone || t == EventError }

// Event is one step of a streamed response.
type Event struct {
	Type EventType
	// ContentIndex is the index in Message.Content of the block the event is
	// about (-1 for start, done and error).
	ContentIndex int
	// Delta is the new text for *_delta events (a raw JSON fragment for
	// toolcall_delta).
	Delta string
	// Content is the block's full text on text_end and thinking_end.
	Content string
	// ToolCall is the finished call on toolcall_end.
	ToolCall *ToolCall
	// Reason is the stop reason on done (stop, length, toolUse) and error
	// (error, aborted).
	Reason StopReason
	// Message is the assistant message so far: a snapshot the consumer owns,
	// never mutated afterwards. On done and error it is the final message.
	Message AssistantMessage
	// Err is the underlying failure on error events (a *gateway.Error for
	// proxy failures, the context error when aborted).
	Err error
}
