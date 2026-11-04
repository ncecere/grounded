# ADR-0030: Published assistant disclosures

- Status: Accepted (2026-11-04, v0.8.0)
- Date: 2026-10-31

## Context

E8 needs settings-derived disclosures without turning the agent access grant into
source discovery, or publishing private draft text through the live profile.

## Decision

The detailed proposal is [About and accessibility](../about-accessibility.md).
Expose a separate, optional About value on existing authorized profile responses,
not on directory listings. Preserve existing profile authorization and disabled
profile behavior, but withhold About for disabled, archived or policy-invalid
agents. Resolve the immutable published version on every request; no About cache.
Only an ownership note is authored, inside versioned configuration, never the
unversioned live profile. Existing revisions, publish and revert govern it.
Use anonymous-safe aggregates rather than source names, IDs or locations.
Never serialize a catalog model or connection into these disclosures.

## Consequences

Disclosure reads do not make chat, crawl, network, body or job calls. Old versions
have no ownership note. The note is serialized only when set (`omitempty`), so a
configuration without one is byte for byte what it was before. Releases before
this one decode saves with unknown fields rejected: during a rolling upgrade a
save that carries a note and reaches an older API fails with `400` (the editor
keeps the edit; retry once the rollout finishes), and every other save works.
Older binaries read a stored note without error and never show it; after a
downgrade, re-saving a draft drops its unpublished note, while published versions
keep theirs. Never a silent publication. `tools/acceptance/about-upgrade.sh`
checks this against v0.7.0. No schema migration is needed for the versioned note.
Statement links use a dedicated revisioned singleton (expand-only migration
00060), admin-only audited writes and an explicit public safe projection.
The statement must distinguish an accessibility target from tested conformance.

## Alternatives considered

- An authored free-form model card: rejected because it drifts from settings.
- A live-profile note: rejected because saving a private draft must not publish it.
- Listing source names: rejected because agent access is not source-list access.
