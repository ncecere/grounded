# ADR-0017: AI runtime modelled on pi

- Status: Accepted
- Date: 2026-09-25

## Context

Agents (ADR-0009) stream answers, call tools (`search_knowledge` in v1, more later) and must record usage and analytics per turn. Doing this ad hoc tends to produce a tangle: provider quirks leak into handlers, tool errors crash streams, and the SSE stream, stored transcript and usage ledger disagree about what happened. [pi](https://github.com/earendil-works/pi) (`packages/ai` and `packages/agent`, reviewed at `49681e1`) has a mature, well-tested design for exactly these concerns.

## Decision

Model our Go AI runtime on pi's design. Port the ideas; don't take a dependency. DESIGN.md §7.7 has the details.

- **`internal/llm`:** one normalized message model (typed content blocks `text` / `thinking` / `toolCall`, `usage` with cost, `stopReason`) and a provider interface that streams typed events (`start`, `*_start/delta/end`, then one final `done` or `error`). Each event carries the partial message. v1 has a single OpenAI-compatible adapter for the gateway (ADR-0005), with per-endpoint compatibility flags in the style of pi's `OpenAICompletionsCompat`.
- **`internal/agentloop`:** agent, turn, message and tool-execution lifecycle events. These events are the one source for the SSE stream, transcripts, usage events and analytics.
- **Tools:** name, label, description, JSON Schema parameters, `execute(ctx, id, params, onUpdate)`, and an execution mode. Arguments are validated before execution. Failures become `isError` tool results.

## Consequences

- The chat UI, OpenAI-compatible endpoint, persistence and analytics all consume one event stream, so they can't drift apart.
- New tools and provider adapters plug in without touching the loop.
- **Costs and risks:**
  - More upfront structure than a single chat-completion call.
  - pi is TypeScript and evolves quickly. We copy shapes at a reviewed revision and don't track upstream automatically.
  - Most pi features (compaction, branching sessions, durable tool replay, many native providers) are out of scope for v1. We must resist porting more than we need.

## Alternatives considered

- **Direct `openai-go` calls in handlers.** Rejected. Provider details and streaming state would spread through the codebase.
- **A Go agent framework** (e.g. LangChainGo, Eino). Rejected. It brings a heavy abstraction layer and its own provider opinions, when we only need one gateway adapter and a small loop.
- **Running pi itself as a sidecar.** Rejected. It adds a Node runtime to the request path and splits the agent state across two services.
