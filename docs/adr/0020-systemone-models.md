# ADR-0020: Optional SystemOne models

- Status: Accepted
- Date: 2026-09-26

## Context

ADR-0019 defined one interface for yes/no, choice and score judgments, with "System One" as one provider kind for moderation. Since then:
- An owner-hosted SystemOne service (OpenJev on a DGX Spark) has proven compatible with TypeSafe's `POST /v1/systemone` API.
- It answers a question about a passage in about 0.6 s, with calibrated probabilities.

TypeSafe's cookbooks show judgments improving exactly the parts of RAG where Grounded is weakest or least measurable:
- re-ranking a retrieved shortlist
- classifying passages (relevant, usable evidence, contradicts the question, prompt injection)
- checking citations against their sources
- guardrails
- verify-then-escalate cascades

Grounded is open source (ADR-0018). Many installs won't have a SystemOne model, so everything built on one must be optional.

## Decision

- **A new catalog model kind, `systemone`,** on any connection whose endpoint speaks the SystemOne API. Examples: TypeSafe's hosted `jev-latest`, or a self-hosted OpenJev. The UI calls it a **SystemOne model**. The `system_one` moderation provider now means "a SystemOne model". The earlier arrangement (a `moderation` model with provider `system_one`) is folded into it; nothing is in production.
- **Every feature is off by default and switched separately.** Each has a platform default and, where it makes sense, an agent override. With no SystemOne model configured, the switches are hidden and Grounded behaves exactly as before.
- **The features:**

  | Feature | What it does | Phase |
  |---|---|---|
  | **Moderation** | A SystemOne model as the provider for moderation policies (ADR-0019), plus a severity score and a "support" action (e.g. crisis resources for self-harm) | now |
  | **Passage judging** | One request per retrieved candidate: relevance (used to re-rank), usable evidence, contradicts the question's premise, prompt injection. Code routes each passage to *evidence*, *conflicting evidence* or *dropped*. A strictly grounded agent with no surviving evidence refuses without calling the chat model. | now |
  | **Citation checks** | After an answer: does source *n* support the claim that cites it? Verified / unsupported / contradicted, with confidence. Shown on citations and counted in analytics. | next |
  | **Scope check** | Before retrieval: small talk, or outside the agent's subject? Handled without retrieval. | next |
  | **Ingest checks** | Per chunk: navigation boilerplate, personal data, suggested classification. | later |
  | **Answer cascade** | Answer with a cheaper model, verify, and escalate to the stronger model only when checks fail. | later |

- **Thresholds and routing live in code and settings, never in prompts,** so policy changes are reviewable and don't change what a question means.
- **Judging is quality, not safety.** It fails open: on a timeout or error, the passage keeps its retrieval rank and the event records the skip. Moderation keeps its own fail-open/closed policy (Phase 4).
- **Privacy:** only scores and decisions are stored (ADR-0010), never text.
- **Measured before it's defaulted.** Each feature ships with an evaluation on the FiQA set and a registrar question set (`cmd/ragbench`), recording quality and latency. The choice between one request per passage and batched requests is measured, not assumed.

## Consequences

- Installs with a SystemOne model get re-ranking, injection defence and verifiable citations without writing prompts. Installs without one lose nothing.
- **Latency and capacity become visible concerns.** A single GPU serves requests largely in sequence; 10 concurrent single-passage requests took 3.5 s on the Spark. Candidate counts, concurrency caps and timeouts must be tunable per connection, and analytics show the cost.
- The interface is TypeSafe's public API, so Grounded depends on an API shape rather than a vendor. That shape could change; the adapter isolates it.

## Alternatives considered

- **Use the chat model for every judgment.** Rejected as the main path: it's slower, uncalibrated, and pays generation cost for a single number. It stays as a fallback for moderation only.
- **A dedicated cross-encoder reranker** (`/rerank` kind). Still possible and complementary. SystemOne covers re-ranking and classification in the same request.
- **Make SystemOne required.** Rejected: most installs won't have one (ADR-0018).
