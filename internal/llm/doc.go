// Package llm is the provider layer of the AI runtime (DESIGN §7.7,
// ADR-0017), modelled on pi's packages/ai at 49681e1: one normalized message
// model and a provider interface that streams typed events. Provider quirks
// stay inside adapters; v1 has one adapter, OpenAI, for OpenAI-compatible
// chat completions through internal/gateway.
//
// # Messages
//
// A Message is a UserMessage, AssistantMessage or ToolResultMessage.
// Assistant content is a list of blocks: Text, Thinking and ToolCall. Usage
// counts tokens (Reasoning is a subset of Output); StopReason is stop,
// length, toolUse, error or aborted, and error/aborted messages carry
// ErrorMessage. Messages marshal to JSON with a "role" discriminator and read
// back with UnmarshalMessage, so transcripts can be stored as-is.
//
// # Stream contract
//
// Provider.Stream returns a channel of Events:
//
//   - Successful streams emit start, then block events, then exactly one done
//     whose Reason is stop, length or toolUse.
//   - Failures emit exactly one error whose Reason is error or aborted. A
//     failure before the response starts (HTTP 4xx/5xx, connection refused)
//     emits error without start.
//   - Block events come in start, delta*, end order per content index, and
//     every block started in a successful stream is ended before done. Text
//     and thinking blocks end when a block of another kind starts; tool calls
//     end when the response finishes. After an error, open blocks are not
//     ended.
//   - Reasoning written in content between <think> and </think> becomes
//     thinking; a bare </think> turns the message's text so far into
//     thinking, announced by text_to_thinking (thinktags.go).
//   - Every event carries ContentIndex (-1 for start, done and error) and a
//     snapshot of the partial AssistantMessage; the terminal event carries the
//     final message. Snapshots are never mutated, so consumers may keep them.
//   - The channel always closes after the terminal event. Consumers must
//     drain it. Cancelling the context ends the stream promptly with
//     error{aborted}.
//
// # OpenAI-compatible adapter
//
// OpenAI parses chat.completion.chunk SSE leniently (data: with or without a
// space, comments, missing blank lines, [DONE], or a plain JSON completion if
// the proxy ignores "stream"). Reasoning arrives as thinking from
// reasoning_content or reasoning (Compat.ThinkingField). Tool calls are
// assembled by index: the id and name come first, then argument fragments;
// arguments are parsed as JSON when the call ends (invalid JSON is kept as a
// JSON string so tool validation can report it). Usage is read from whichever
// chunk carries it, normally the last. finish_reason maps stop→stop,
// length→length, tool_calls→toolUse and anything else to stop (toolUse if the
// message holds tool calls).
//
// Requests honour the Compat flags (developer vs system role,
// stream_options.include_usage, max_tokens vs max_completion_tokens,
// reasoning_effort, tool_choice) and the Options.User tag. Thinking is never
// sent back to the model.
//
// Timeouts: the connection's request timeout bounds only the wait for the
// response headers; after that, an idle timeout (default 60 s) bounds the gap
// between chunks, so long answers are never cut off. Errors keep the
// gateway's error kinds (AssistantMessage.ErrorKind and a *gateway.Error in
// Event.Err).
package llm
