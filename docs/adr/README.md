# Architecture Decision Records

This directory records the significant architecture decisions for Grounded. Each ADR explains one decision: the situation that prompted it, what we chose, what it costs us, and what else we looked at.

[`docs/DESIGN.md`](../DESIGN.md) is the overview of the system. The ADRs hold the reasoning behind it. The two must agree. If they disagree, treat it as a bug and fix whichever one is wrong.

## Format

Every ADR is a Markdown file named `NNNN-short-title.md` and uses this structure:

```
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-NNNN | Deprecated
- Date: YYYY-MM-DD

## Context
## Decision
## Consequences
## Alternatives considered
```

- **Context:** the problem and the constraints behind it.
- **Decision:** what we will do, stated plainly.
- **Consequences:** what follows, including costs and risks.
- **Alternatives considered:** the options we rejected, and why.

Keep each ADR short, roughly 30–70 lines. If a decision depends on something still open (see DESIGN.md §18), say so in the ADR.

## Adding or changing an ADR

1. Copy the format above into a new file using the next free number.
2. Set the status to `Proposed` and open a pull request. Change it to `Accepted` once the decision is agreed.
3. Add a row to the index below.
4. Update `DESIGN.md` if the decision changes the design.

Once an ADR is accepted, leave its substance alone. To reverse or replace a decision, write a new ADR and set the old one's status to `Superseded by ADR-NNNN`. Fixing typos and adding links is fine.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-go-modular-monolith.md) | Go modular monolith | Accepted | 2026-09-24 |
| [0002](0002-tenancy-teams-and-consumers.md) | Tenancy: teams and consumers | Accepted | 2026-09-24 |
| [0003](0003-postgres-system-of-record.md) | PostgreSQL as the system of record | Accepted | 2026-09-24 |
| [0004](0004-vector-store-interface-pgvector-first.md) | Vector store interface, pgvector first | Accepted (pgvector subject to the benchmark gate) | 2026-09-24 |
| [0005](0005-openai-compatible-model-gateway.md) | OpenAI-compatible model gateway | Accepted | 2026-09-24 |
| [0006](0006-data-classification.md) | Data classification | Accepted | 2026-09-24 |
| [0007](0007-embedding-profiles.md) | Embedding profiles | Accepted | 2026-09-24 |
| [0008](0008-data-source-plugins-and-native-web-crawler.md) | Data source plugins and a native web crawler | Accepted | 2026-09-24 |
| [0009](0009-agents-and-audience-grants.md) | Agents and audience grants | Accepted | 2026-09-24 |
| [0010](0010-conversation-privacy-and-retention.md) | Conversation privacy and retention | Accepted (amended by ADR-0024) | 2026-09-24 |
| [0011](0011-admin-content-access-and-break-glass.md) | Admin content access and break-glass | Accepted (amended by ADR-0024) | 2026-09-24 |
| [0012](0012-api-keys.md) | API keys | Accepted | 2026-09-24 |
| [0013](0013-availability-and-zero-downtime-migrations.md) | Availability and zero-downtime migrations | Accepted | 2026-09-24 |
| [0014](0014-delivery-and-deployment.md) | Delivery and deployment | Accepted | 2026-09-24 |
| [0015](0015-valkey-shared-fast-state.md) | Valkey for shared fast state | Accepted | 2026-09-24 |
| [0016](0016-frontend-and-api-contract.md) | Frontend and API contract | Accepted | 2026-09-24 |
| [0017](0017-ai-runtime-modelled-on-pi.md) | AI runtime modelled on pi | Accepted | 2026-09-25 |
| [0018](0018-open-source-institution-neutral.md) | Open source and institution-neutral | Accepted (amended by ADR-0023) | 2026-09-26 |
| [0019](0019-pluggable-moderation-and-judgments.md) | Pluggable moderation and judgment providers | Accepted (provider choice per install is open) | 2026-09-26 |
| [0020](0020-systemone-models.md) | Optional SystemOne models | Accepted | 2026-09-26 |
| [0021](0021-boilerplate-suppression.md) | Repeated-boilerplate suppression at ingest | Accepted | 2026-09-26 |
| [0022](0022-name-grounded.md) | The product is named Grounded | Accepted | 2026-09-27 |
| [0023](0023-no-institution-data-in-the-repository.md) | No institution-specific data in the repository | Accepted | 2026-09-27 |
| [0024](0024-break-glass-scope-and-approval.md) | Break-glass as built: transcripts in scope, approval as a setting | Accepted | 2026-09-27 |
| [0025](0025-community-and-enterprise-editions.md) | Community and Enterprise editions | Rejected: one MIT project named Grounded (2026-10-02) | 2026-09-30 |
