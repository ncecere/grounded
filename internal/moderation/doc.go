// Package moderation implements pluggable moderation (ADR-0019,
// docs/phase4-publishing.md §2 and §4).
//
// # Providers
//
// A provider is a catalog model of kind moderation. Its moderation
// provider (catalog.ModerationProviderOf) selects the adapter; every adapter
// answers the same question, "how likely is this text to belong to each
// category", as a Result with a probability and a supported flag per
// category:
//
//   - moderations_endpoint: OpenAI-compatible POST /moderations; its
//     category scores map to ours (calibrated).
//   - guardrail_chat: Llama Guard ("safe" / "unsafe\nS1,S10"), Granite
//     Guardian (yes/no per criterion) or ShieldGemma (Yes/No per policy)
//     over /chat/completions. Probabilities come from the label token's
//     log-probabilities when the server returns them (calibrated);
//     otherwise the label gives 0 or 1.
//   - chat_classifier: any chat model with our versioned prompt
//     (definitions.v1.json), strict JSON validated against the categories
//     and retried once (not calibrated).
//   - system_one: TypeSafe-style POST {base}/v1/systemone with one noul
//     question per category (calibrated); 429 and 529 are backpressure.
//
// # Policies
//
// Each audience (team, all_authenticated, public) has one platform Policy:
// per category, a threshold and an action (off, flag, block) for input and
// for output, the output mode (stream_retract, stream_checked or buffer),
// fail-closed, and the notice shown instead of blocked content. Unsaved
// policies use DefaultPolicy: public blocks everything at 0.5, streams
// checked paragraphs and fails closed; the others moderate nothing. An agent's Override can only make
// the policy stricter (Policy.Merge).
//
// # Chat pipeline
//
// internal/agents asks for a Plan (Service.Plan) per chat and calls
// Plan.Check on the question before retrieval (concurrently with query
// rewriting) and on the final answer. A Decision is pass, flag, block or
// error; errors block when the policy fails closed. Decision.Record is the
// content-free record stored in message_events (ADR-0010).
//
// # Readiness (for publishing to an audience)
//
// Service.Ready(ctx, audience) returns nil when moderation is configured
// and working for the audience: a provider is set, the policy moderates
// both input and output, the model and its connection are enabled, and
// the provider answered a benign test request. The configuration and the
// model's state are read on every call; only a successful call to the
// provider (a probe, a chat check or a test) is cached, for ten minutes per
// model and model revision, so callers such as publish validation can call
// it freely and one slow probe doesn't fail a publish that follows recent
// traffic. Failures are never cached.
//
// # Timeouts and retries
//
// One attempt of a check is bounded by the model's moderation timeout
// (models.moderation_timeout_seconds), else MODERATION_TIMEOUT, at least
// ClassifierTimeout for chat classifiers. A timeout or transient failure
// (network, 5xx) is retried once; backpressure is not. A check that still
// fails is a Decision with outcome error, blocked when the policy fails
// closed; the chat reports it as "unavailable" with UnavailableNotice.
// Otherwise the error is 409 moderation_not_ready with a message saying
// what is missing. Publishing to the public audience requires Ready(ctx,
// "public") to succeed (docs/phase4-publishing.md §3).
package moderation
