# ADR-0006: Data classification

- Status: Accepted
- Date: 2026-09-24

> **Note (2026-09-26):** The level meanings here (Restricted = FERPA, institution-hosted models only, PHI prohibited) are now an example deployment policy; the product ships neutral descriptions and keeps the mechanisms. See [ADR-0018](0018-open-source-institution-neutral.md) and [ADR-0023](0023-no-institution-data-in-the-repository.md).

## Context

Teams will load data of different sensitivity: public web pages, internal documents, and FERPA and similar institutional data. Classification has to decide which models may process data, who may use an agent built on it, and how long conversations are kept. Data flows from sources to KBs to agent versions, and a change at one level can break a rule further down. PHI needs controls we aren't building in v1.

## Decision

**Levels.** Platform admins configure an ordered list of levels. The defaults:

| Level | Rank | Default max agent audience | Default models |
|---|:-:|---|---|
| Open | 0 | `public` | Any enabled model |
| Sensitive | 1 | `all_authenticated` | Models tagged Sensitive or higher |
| Restricted | 2 | `team` | Institution-hosted models only |

Each level also sets conversation retention, anonymous conversation retention, allowed source types, and whether team API keys may call `/retrieve` directly.

**PHI is prohibited in v1.** The terms of use say so, and Restricted means FERPA and similar institutional data. A separate PHI level can be added later without schema changes.

**Rules, enforced at write time and again at query time:**
1. **Team ceiling.** A source's rank must be ≤ its team's approved maximum.
2. **Attaching sources.** A KB may attach a source, including a platform-shared one, only if the source's rank ≤ the KB team's maximum.
3. **Computed ranks.** `KB.effective_rank = max(source ranks)`. `Agent.effective_rank = max(ranks of the KBs in the published version)`. Neither can be set by hand.
4. **Model ceilings.** The embedding model of a source's profile and the agent's chat model must each be tagged with a max rank ≥ the data they process.
5. **Audience ceiling.** Every audience grant on an agent must be allowed for its effective rank (ADR-0009).
6. **Downstream check on raises.** A change that would raise an effective rank is rejected if it breaks a rule for any dependent KB or agent. The error names the affected objects. Nothing is silently unpublished. Changes to platform-shared sources show admins an impact preview across all teams.
7. **Lowering** a source's classification requires a team admin or owner and a written reason. Team owners are notified (this notification can't be turned off) and the change is audited. Editors may raise a classification.
8. **Every query rechecks** the published version's rank, models and audience against current policy before retrieval. If the check fails, the query is refused rather than degraded.

## Consequences

- One ordered rank drives model choice, audience, retention and key permissions, so every rule is a comparison.
- Re-checking at query time catches policy changes made after publishing (for example, a model's tag being lowered).
- **Costs and risks:**
  - Rule 6 needs dependency traversal across teams for shared sources. It adds latency to writes and complexity to error messages.
  - Checking on every query adds a policy lookup to the hot path. It must be cheap.
  - A policy change can make many agents start refusing queries at once. That is intended, but teams will notice it immediately.
  - Classification is set by people. A mislabeled Open source can leak through a `public` agent. We don't detect that in v1. The PII scan hook (ADR-0008) is the future mitigation.
  - The PHI prohibition is enforced by policy and terms of use, not by technical detection.

## Alternatives considered

- **Per-document classification.** Rejected for v1. The source is the unit that teams manage and admins approve.
- **Setting KB or agent classification by hand.** Rejected. Computed ranks can't fall below their inputs.
- **Silently unpublishing or degrading agents when a rule breaks.** Rejected in favour of explicit rejection at write time and refusal at query time.
- **Supporting PHI in v1.** Rejected. It needs controls and review beyond v1 scope.
