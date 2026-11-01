# ADR-0029: Opt-in structural passage boundaries

- Status: Proposed
- Date: 2026-10-31

## Context

Issue #19's remaining C15 case mixes distinct procedures in one passage.
Versions 2–3 intentionally merge short sibling sections; levels 4–6 do not
force boundaries. HTML preserves headings and bold paragraphs but generic
section/div wrappers carry no semantic procedure identity into Markdown.
We cannot infer procedure changes in arbitrary prose without evidence.

## Decision

Add opt-in chunker version 4; keep versions 1–3 byte-for-byte unchanged.
V4 retains v3 table and sentence/oversize rules and bodyless filtering, but
never merges across an explicit heading (levels 1–6). Also treat a standalone,
unindented, entirely bold paragraph immediately followed by a top-level list
as a structural label. Accept ** or __ delimiters, with an optional trailing
colon, and no internal emphasis delimiters. No language or procedure keywords.
The label remains original text; it augments the heading path until the next
label or explicit heading. An ordinary paragraph, inline bold, nested label,
code, or table cell is not a label. Formatting is evidence of structure, not
proof of semantic difference: ambiguous labels can cause extra passages.

Boundaries are established before boilerplate dropping. No overlap crosses
them. Parent ranges also respect their identity, including repeated identical
labels/headings; no extra stored text or public metadata is needed.
No HTML normalization, source/full-text or viewer disclosure change.

## Consequences and acceptance

Synthetic example.edu tests must expose v3 mixing short/deep headings and
bold-labelled lists, while adjacent ordinary prose remains joined. Test nested
lists, misleading labels, Unicode, pages, dropped labels, tables, oversized
units, determinism and bounded tokens; retain all original golden tests.
Preview, migration and ingestion must use the same Split options; immutable
profiles require explicit creation/preview and switch. No live switch or model
work in read-only estimates. Rollback selects the retained old profile/index;
older binaries cannot build v4 profiles and should not be used for v4 writes.
No database migration: the existing integer version column has no enum bound.
More small passages may worsen ranking/cost. Fake embeddings can prove only
mechanics, not quality; no representative corpus is available. Real acceptance
and #25 measurement remain open; synthetic success does not close #19.

## Alternatives considered

Keyword lists or semantic guesses would be language/corpus-specific. Changing
v3 would invalidate immutable profiles and golden outputs. Splitting every list
item or paragraph would fragment normal steps/prose. Inferring unlabeled HTML
wrappers would change persisted parser output and require reparsing old data.

Read-only migration figures retain the existing token-based approximation,
not an exact structural passage count. Many short labelled sections can exceed
that estimate. V4 marks re-cutting even when sizes/version match, since stored
rows do not carry transient structural identities. Estimates do not parse,
generate context or call a model. Review actual preview counts before switching.
