# ADR-0019: Pluggable moderation and judgment providers

- Status: Accepted (provider choice per install is open)
- Date: 2026-09-26

## Context

Public agents must be moderated (ADR-0009), and other audiences may choose to be. The project is open source (ADR-0018), so installs will have very different options:
- **An OpenAI-compatible `/moderations` endpoint.** The model kind `moderation` already exists in the catalog.
- **Guardrail models served as chat models,** each with its own prompt and output format: Llama Guard ("safe" / "unsafe" plus category codes), Granite Guardian (yes/no with a risk definition) and ShieldGemma (a yes probability for a policy).
- **Any chat model used as a classifier,** with a prompt asking for structured output. This always works, but it's slower and less calibrated.
- **"System One" judgment models** such as TypeSafe's Jev (`POST /v1/systemone`). These return typed answers with probabilities rather than text: `noul` (probability of yes), `choice` (distribution over options) and `score` (a position on ordered levels).

The first install's AI gateway has no moderation or guardrail model today, and the owner is evaluating options. Separately, several planned features also need small yes/no or graded judgments about text:
- "Do these sources answer the question?" (strict grounding, beyond a similarity threshold)
- "Is this claim supported by source [n]?" (citation checks)
- reranking
- prompt-injection detection in retrieved content

## Decision

- **One normalised judgment interface.** A provider answers a batch of questions about some state, text or messages.
  - Each question is a yes/no (probability), a choice (a distribution over named options) or a score (a distribution over ordered levels).
  - Every answer carries probabilities, never just a label.
  - Moderation is a set of yes/no questions, one per policy category, such as violence, self-harm, sexual content, harassment or hate, illicit behaviour, personal data and prompt injection.
- **Provider kinds.** Each kind is a small adapter, configured by admins as catalog models:
  1. `moderations_endpoint`: OpenAI-compatible `/moderations`. Category scores map to our categories.
  2. `guardrail_chat`: Llama Guard, Granite Guardian or ShieldGemma over `/chat/completions`, each with its own template and parser. Probabilities come from log-probabilities when the server returns them; otherwise the adapter reports 0 or 1.
  3. `chat_classifier`: any chat model, with our prompt and JSON output, validated against a schema.
  4. `system_one`: TypeSafe-style `/v1/systemone`. It sends the state and a `questions` map, reads `noul`, `choice` and `score` answers, and treats `429`/`529` as backpressure.
- **Policy, not provider, decides.** A moderation policy lists categories, a threshold for each, and an action (block, flag or warn) for input and for output. It's set per audience, with agent overrides within platform limits. Swapping a provider never changes what the policy means, only how the answers are produced.
- **Moderation runs in the chat pipeline.**
  - Input is checked before retrieval.
  - Output is checked on the final text. A streamed answer that fails is replaced with a notice, and the SSE stream says so.
  - Decisions, the provider, categories and scores go into the content-free analytics and audit records (ADR-0010). The text itself is never stored.
- **Required and fail-closed for public agents.** If the provider is unavailable, public chat is refused. Other audiences can choose fail-open.
- **The same interface is reused later** for grounding checks, citation verification, reranking and injection detection, each behind its own setting and evaluation.

## Consequences

- Installs pick what they have. An install can start with a chat classifier and switch to a guardrail or System One model without code changes.
- Calibrated probabilities (System One, logprobs) let admins tune thresholds on their own data. Label-only providers show that they can't be tuned, and the policy UI says so.
- **Costs:**
  - four adapters to build and test, plus an evaluation set per category to compare them
  - added latency on every public turn (input check plus output check)
  - scoring the output of streamed answers needs care: stream first and retract, or buffer. Phase 4 decides, per audience.
- Classifier prompts and category definitions are policy text that needs review. They live in versioned configuration, not code.

## Alternatives considered

- **One hard-wired provider (for example Llama Guard).** Rejected: not every install can serve it, and it locks out better options.
- **Only the OpenAI `/moderations` shape.** Rejected: most self-hosted guardrail models don't serve that endpoint, and it doesn't cover judgments beyond moderation.
- **Letting the chat model self-police through its prompt.** Rejected as the only control: it can't be audited or tuned, and it fails under prompt injection. It remains a useful extra layer.
