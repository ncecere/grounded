# ADR-0033: Team configuration as code

- Status: Proposed
- Date: 2026-10-31

## Context

D4 requests YAML export, read-only dry run and explicit transactional apply from
Team Settings and a scoped team API key. Configuration is not a content backup,
secret transfer, publication request or model-spend consent. Existing evaluation
API-key restrictions need explicit reconciliation before pipeline access ships.

## Decision

Propose a bounded, versioned typed schema with deterministic ordering, exact
namespaced references, no arbitrary UUID binding, no secret values and no content.
Export and planning must be side-effect free. Apply must revalidate all grants,
objects, references and revisions before any mutation in one audited transaction.
A plan is bound to the exact source, actor, team and current dependencies; it does
not confer authority. Omissions never delete; conflicts never silently overwrite.
Imported drafts never publish or start crawls, eval runs, webhooks or contextual
model spending. Shared sources remain platform-owned references.

Use existing yaml.v3 syntax parsing with strict finite limits, no aliases, custom
tags, duplicate keys or multiple documents. Follow syntax validation with strict
per-kind field/type validation and existing domain validators. Never expose the
syntax boundary alone as a validated plan. The detailed design and outstanding
policy/atomicity work are in [configuration-as-code](../configuration-as-code.md).

## Consequences

The retained follow-up implements strict domain validation and a usable read-only
Settings/API download for supported configurations. Explicit whole-export refusals
cover unnamed webhook signing credentials, nonportable references and unsupported
meaningful settings; these are documented rather than silently omitted. API keys
need configuration:export, not manage; evaluation-question access remains denied
to keys. Migration 00061 expands only the existing scope constraint (00060 is
reserved for #34). Import/dry run/apply remain separate and #32 remains open.
The complete owner workflow and this proposed ADR still need parent review.

## Alternatives considered

- Generic execution/template engine, CLI or SDK: outside the owner's scope.
- Upsert via privileged HTTP calls: bypasses transactional/domain safeguards.
- Stored dry-run plans: create writes on a required read-only path.
- Silently omit unsupported settings or redact required settings: misleading and
  not a lossless configuration round trip; fail closed instead.
