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

The initial checkpoint is only an internal hostile-YAML ingress implementation
with tests. There is no export/import endpoint or UI and no claim of D4 completion.
The schema and authorization extension must be reviewed before they become public.
No migration is needed for this checkpoint; any later lane migration is 00061+.
Parent integration must extend/verify optional #34 card settings independently.

## Alternatives considered

- Generic execution/template engine, CLI or SDK: outside the owner's scope.
- Upsert via privileged HTTP calls: bypasses transactional/domain safeguards.
- Stored dry-run plans: create writes on a required read-only path.
- Silently omit unsupported settings or redact required settings: misleading and
  not a lossless configuration round trip; fail closed instead.
