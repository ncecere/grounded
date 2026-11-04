# ADR-0033: Team configuration as code

- Status: Accepted (owner, 2026-11-04)
- Date: 2026-10-31, revised 2026-11-04

## Context

D4 asks for a team's configuration as YAML: export, a dry-run diff, and an explicit apply, in the app and from a
pipeline with an API key ([`v0.8.0.md`](../v0.8.0.md)). Configuration is not a content backup, a secret transfer, a
publication request or consent to spend on models. The first increment (export) left five decisions open; the owner
took them on 2026-11-04 ([design](../specs/config-as-code-import/DESIGN.md)).

## Decision

- **A bounded, versioned, typed file** (`grounded.team/v1`): hostile-YAML ingress (no aliases, tags, duplicate keys or
  extra documents; 1 MiB, 500 resources), then a strict per-kind schema. Names and portable references only: never
  uploaded files, passages, conversations, secrets or install-specific IDs. Webhooks carry no signing material.
- **Match by identity, never delete.** Sources, knowledge bases and evaluation sets by name (case-insensitive), agents by
  slug, webhooks by URL. A match is an update, no match a create; objects not in the file stay. Changes the domain
  forbids in place (a source's type or profile, a knowledge base's profile, a set's target) block the row.
- **Imports start nothing.** New web sources are paused, new agents are drafts (nothing is published), new webhooks
  are off with a fresh secret made in the target and shown once; status and on/off are never applied. No crawl,
  re-index, evaluation run, delivery or model spend comes from a file.
- **The plan digest detects drift; it never authorizes.** Planning reads a read-only snapshot and stores nothing.
  Apply sends the same file with the digest in If-Match; under the team's lock it recomputes the plan with the caller's
  own grants and refuses on any difference (412, with the fresh plan) or any blocker (409), then applies in one
  transaction. Replay is a no-op.
- **Every write goes through the domain services** in that transaction (transaction-scoped variants of their
  operations), so validation, limits, revisions, live-profile rules and audit entries are the app's own.
- **Keys:** `configuration:export` reads; `configuration:apply` applies, only together with `manage`, on an unrestricted
  key of the team. Evaluation questions stay out of reach of every API key.

## Consequences

Teams can keep their configuration in version control and promote it between installs. A file can also be small (one
agent) because references resolve against the team. Objects a file cannot carry yet (MCP tools, contextual chunks,
saved-answer settings, short names, picked evaluation documents) refuse export and block only the plan rows that touch
them. Migration 00061 widens the API-key scope constraint (expand-only); downgrading needs keys with configuration
scopes removed first. Deleting objects missing from a file, renames and a CLI are not part of this decision.

## Alternatives considered

- Matching by stored IDs: not portable between installs.
- Upsert through privileged HTTP calls: bypasses transactional and domain safeguards.
- Stored, signed plans: writes on a read-only path, and a reusable bearer capability.
- Refusing same-name objects unless confirmed one by one: makes keeping a team in step with a file impossible.
- Starting crawls or publishing on import: a file would spend money and change what people see.
