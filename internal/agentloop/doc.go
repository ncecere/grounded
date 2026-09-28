// Package agentloop runs an agent: it streams assistant turns from an
// llm.Provider, executes the tools the model calls, and repeats until the
// model answers (DESIGN §7.7, ADR-0017, after pi's packages/agent at
// 49681e1). It is deliberately small: no sessions, steering, compaction or
// durable replay.
//
// # Turns
//
// A turn is one assistant response plus the results of its tool calls. The
// loop ends when:
//
//   - the assistant stops without tool calls (the normal end);
//   - MaxTurns turns have offered tools and the model still called tools: one
//     final turn then runs without tools and with an instruction to answer
//     from what it has (Event.FinalTurn). Tool calls made anyway in that turn
//     get error results and the loop ends;
//   - the provider fails (the assistant message has StopReason error and Run
//     returns the provider error);
//   - the context is cancelled (StopReason aborted; Run returns the context
//     error). A cancellation during tool execution makes the next turn record
//     an empty aborted message without calling the provider.
//
// Options.ToolChoice is only sent on the first turn.
//
// # Tools
//
// Arguments are validated against the tool's JSON Schema before Execute runs
// (optional top-level properties set to null are dropped first). An unknown
// tool, invalid arguments, an Execute error or panic, and calls in a response
// cut off by the length limit all become ToolResult{IsError: true} sent back
// to the model; they never end the loop. If any call in a message targets a
// Sequential tool, the message's calls run one at a time; otherwise they run
// concurrently. Either way results are returned, emitted and sent to the
// model in call order.
//
// # Events and invariants
//
// The emitted events are the single source for the SSE stream, persistence,
// usage and analytics. emit is never called concurrently.
//
//   - agent_start is first and agent_end last, exactly once each (unless the
//     Config is invalid, when Run returns an error and emits nothing).
//   - Turns do not overlap: turn_start … turn_end.
//   - Within a turn: the assistant's message_start, message_update*,
//     message_end; then for each tool call tool_execution_start,
//     tool_execution_update*, tool_execution_end (starts in call order; ends
//     in completion order when parallel); then one message_start/message_end
//     pair per tool result in call order; then turn_end. So message_end always
//     precedes turn_end, and every tool call gets exactly one result.
//   - message_update wraps a non-terminal llm.Event and carries the partial
//     message; the provider's done/error becomes message_end with the final
//     message.
//   - Persist on message_end (it carries every assistant and tool-result
//     message exactly once); agent_end carries them all again, in order.
package agentloop
