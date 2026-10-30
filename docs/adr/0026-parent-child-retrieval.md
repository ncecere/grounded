# ADR-0026: Parent/child retrieval

- Status: Accepted
- Date: 2026-10-30

Accepted after review with the conservative disclosure boundary: parent context
is for generation only; cited viewers retain their existing bounded window,
including anonymous sessions and public shared links. No wider public-text grant
is authorized by this decision.

## Context

A passage small enough to embed and rank well is often too small to answer from: the sentence that matches a question sits in a section whose neighbours say what it means. Roadmap item A5 (issue #20) asks to search small passages and give the model their larger section. The change must not alter what existing installs index or retrieve, must not widen what a search may read (ADR-0006, ADR-0009), and must be judged before it is used, with the index preview (ADR-0007). The owner's decision (2026-10-30) is to ship it opt-in and validated for its mechanics, without claiming a gain in answer quality.

## Decision

- **A profile setting, `parentTokens`** (0 = off, the default), immutable like the chunk size and chunker (ADR-0007). A change is a new profile, built beside the live index by the index preview and switched explicitly.
- **A parent is a range of children, not stored text.** Each child row of such a profile records the ordinals of the first and last child of its parent (`chunks.parent_first`, `chunks.parent_last`). A parent is consecutive children of one document with the same heading path, at most `parentTokens` tokens and 64 children. The ranges are written in the transaction that writes the children, in every path that writes them.
- **Ranking is unchanged and runs on children.** Siblings in one parent are collapsed into the best-ranked one before the result count is applied, so they do not crowd out other matches.
- **Expansion happens for the model only,** in the agent pipeline, after ranking, reranking and judging. The parent's text is built from its children's current rows; if any check fails (a missing, stale or inconsistent range, a document that is not ready, a source outside the search's scope, a bound exceeded, or a context budget that cannot hold it) the model is given the child, as it would be without the setting. No check takes a user, team or classification as input, and no row outside the hit's own document, source and profile is read.
- **A citation records generation provenance, not a wider text grant.** `Citation.chunkId` stays the matched child; optional `Citation.parent` records the range, passage count, estimated tokens, matching hits and SHA-256 of section context before standard prompt escaping. Every cited-viewer route (signed-in, anonymous/widget and shared links) validates that snapshot but returns only the existing matched-passage context window. The full section is available only through the already-authorized editor document-text endpoint. A changed hash or missing matched passage yields no current text.
- **An operator switch**, `RETRIEVAL_PARENT_EXPANSION` (default on), turns off collapsing and expansion for every profile without touching an index.

## Consequences

- With the setting off (every existing profile), nothing in indexing, search, prompts or citations changes; a golden test pins the rows and the prompt.
- An index preview that changes only `parentTokens` cannot show a difference: it measures retrieval of children, which is unchanged. Whether a model answers better from parents is not measured by anything in this repository, and the documents say so.
- Storage grows by two integers per child; no text is duplicated. A child whose parent is missing or stale degrades to ordinary retrieval instead of failing.
- Cited viewers retain the prior about-a-page disclosure boundary, including anonymous sessions and public shared links. Parent provenance does not supersede ADR-0009's snippet policy. Only editors, admins and owners who already have document-text access may open the full parent section or document.
- Rolling back needs no data change: switch back, switch the operator flag off, or run the previous release, which ignores the columns. The range constraint must not inspect `ordinal`, since old rechunk workers temporarily make it negative; readers validate membership and agreement before expanding stale metadata.

## Alternatives considered

- **Store the parent's text** in its own table. Rejected: it duplicates the document, can disagree with the children, and needs its own deletion and staleness handling. A range cannot outlive its rows.
- **Parents from the chunker** (a second pass at the larger size). Rejected: children could straddle two parents, and it would put this feature inside the splitter that chunker versions 2 and 3 change.
- **Expanding in `/retrieve` and MCP `search` too.** Deferred: those return what ranked, and callers build their own prompts. A later change can add the parent as an extra field.
- **Fixed neighbour windows** (the passages around a hit). Rejected: they cross section boundaries, differ per query, and cannot be shared by siblings.
- **A per-agent switch.** Deferred: the unit that decides what is indexed is the profile (ADR-0007), and the agent already has a context budget that bounds the text.
