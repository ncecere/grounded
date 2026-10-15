# Spec: chunker v2: fewer, fuller passages, chosen per profile and measured before it is adopted

Status: **built** (2026-10-15; see "As built" below). The decisions D1 to D5 were my recommendations, applied unless overruled. Tracks [#19](https://github.com/ncecere/grounded/issues/19) (A9 and C15); the second item of v0.5.0 ("Better knowledge in", [`../../roadmap.md`](../../roadmap.md) § L). It builds on the [index preview](../index-preview/SPEC.md): a new chunker is only worth shipping if a platform admin can try it on a real knowledge base and see the numbers before switching.

## Objective

Passages are what retrieval finds, so how a page is cut decides what can be found. Today a heading of level 1 to 3 always starts a new passage, which keeps sections together but leaves many tiny passages. This spec adds a second chunker, **v2**, that merges short neighbouring sections and drops passages with no body, selected per embedding profile by the `chunker_version` field every profile already has. Version 1 stays the default and does not change: nobody's index moves unless an admin previews v2 on a knowledge base, likes the comparison, and switches.

## What the code does today (read, not assumed)

- `internal/chunk` parses Markdown into blocks and packs them greedily up to `MaxTokens`. A heading of level 1 to 3 is a chunk boundary (`brk`); oversized blocks are cut at sentence, item, row or line boundaries; a heading never ends a chunk alone. `DropImageOnly` removes chunks that hold only images, headings and rules, **unless every chunk of the document is like that**.
- `embedding_profiles.chunker_version` exists (default 1), is shown in the API and is part of `ingest.Chunking`, so two profiles that differ in it already **re-cut** a migration's passages instead of copying them (`reembed.go`). **Nothing reads it to choose a chunker:** `Processor.split` passes only the size and the overlap. Version 2 is therefore a new behaviour behind a field that is already plumbed.

## Evidence (production, 2026-10-15, read-only; passages of each source's live profile)

| Source | Passages | Under 60 tokens | Under 128 tokens | Adjacent pairs that could merge* | Heading and rule only |
|---|---|---|---|---|---|
| UFIT website | 5,259 | 19.3% | 35.9% | 738 (14.0%) | 130 (2.5%) |
| Go documentation | 2,442 | 11.5% | 26.5% | 280 (11.5%) | not measured |
| Grounded docs | 763 | 16.0% | 34.9% | 68 (8.9%) | not measured |

\* both under 128 tokens, the same top heading, and together at most 512 tokens.

Of the UFIT passages under 60 tokens, **97% begin with a heading** (they are whole short sections such as `## Conference Calling` and two sentences) and 0.4% come from a document with one passage. So the shortness is the rule working as designed, not a parsing fault; a few are noise (a title and `---`, a one-line agenda). **What I do not know** is whether merging them helps or hurts retrieval: a short passage is precise and poorly informed, a merged one is the reverse. That is what the index preview is for, so this spec does not claim a gain.

## Decisions (recommendations)

- **D1: v2 is chosen by the profile's `chunker_version`, opt-in.** Version 1 is unchanged and stays the default of new profiles in this release (a golden test pins its output). A profile with version 2 is cut by v2 for new and re-processed documents. Existing profiles never change on their own. An index preview can change the version (`chunkerVersion` joins the previewable settings, with the prefixes and sizes), so the comparison, the switch and the discard all work as for any setting.
- **D2: what v2 does.** (a) **Merge short neighbours:** at a level 2 or 3 heading, the passage being filled takes the next section when **both the passage and the whole next section are under the floor**, the two fit in `MaxTokens`, the new heading is under the parent heading the passage started in, and no page boundary lies between them; the heading lines stay inside the passage, so nothing loses its title; no merge crosses a level 1 heading. (b) **Drop passages with no body:** a passage that is only headings, rules and images is dropped (the document's other passages still carry its title and heading path through the embed header), unless it is all the document has. The floor is **MaxTokens / 4**, a judgment call and not a tuned value: the first real measurement should vary it.
- **D3: C15 (a section that mixes procedures) is not in this release.** It came from one crawled page in a review, and I found no general rule that splits mixed procedures without examples; v2's merge is the opposite pressure. #19 stays open for C15 with this note; it needs two or three real pages from the owner.
- **D4: no change to the heading path, ordinals or the embed text format.** A merged passage's path is the path at its start, as today; ordinals stay contiguous.
- **D5: measure after release, on real data.** The index preview needs a real embedding model, which the cluster's development environments do not have, so the comparison on the production Grounded-docs knowledge base (the 96-question set, [#25](https://github.com/ncecere/grounded/issues/25)) happens after v0.5.0 is deployed and is the owner's decision to run. The release notes say so.

## Interfaces

- `chunk.Options.Version` (1 or 2; 0 means 1); `chunk.Split` dispatches on it. `Processor.split` passes the profile's version.
- `POST /v1/admin/profile-migrations/preview` `changes` gains `chunkerVersion` (1 or 2); a profile can be created with it (`chunkerVersion` on the profile input, validated to the versions that exist). An unknown version is refused (400 `invalid_chunker_version`), never ignored.
- No migration: the column exists. The profile page shows the chunker version.

## Acceptance criteria

1. Version 1 output is **byte-identical** to today's on every fixture in `internal/chunk/testdata` and a corpus of real pages (a golden test), and the existing chunker tests and fuzz seeds pass unchanged.
2. On the same inputs v2 never exceeds `MaxTokens`, is deterministic and idempotent, keeps every non-dropped block's text exactly once and in order, and produces **no more passages than v1**, strictly fewer where short neighbours exist.
3. v2 does not merge across a level 1 heading or a page marker, and keeps a document's only passage even if it is a heading and a rule.
4. A migration between profiles that differ only in `chunker_version` re-cuts (does not copy), and one with the same version still copies.
5. An index preview with `chunkerVersion: 2` builds a candidate whose passage count is lower than the live index's on a fixture with short sections, and the comparison runs.
6. An unknown `chunkerVersion` is refused.

## Testing

Unit and property tests in `internal/chunk` (fixtures, the invariants above on generated documents, the existing fuzz target pointed at both versions); the golden test for v1; mutation checks for each rule (merge crossing a level 1 heading, no floor, exceeding the maximum, dropping the only passage, ignoring the version); one integration test through the preview.

## Boundaries

- **Always:** keep v1 byte-identical; refuse an unknown version; keep the text and its order.
- **Ask first:** making v2 the default for new profiles; any change to v1.
- **Never:** change an existing profile's index without an admin's switch; claim v2 retrieves better before it has been measured.

## Not in this spec

Parent/child retrieval (A5), contextual chunks (A4), tables kept structured (A10), the parser, and C15 (D3).

## As built (2026-10-15)

- **The rules** are in `internal/chunk/v2.go` and `pack.go` (`Options.Version`, `ValidVersion`, `sectionTokens`, `mergeable`, `bodyless`). The merge is decided at the heading, so it needs the size of the *whole* next section: a merge never leaves a section cut in the middle by the merge itself. Requiring the next section to be short as well (not only the passage) is stricter than the first draft of D2, to avoid attaching a small section to a large one and diluting it; a descendant section (a level 3 under the section the passage started in) may join, a section under another parent may not.
- **Version 1 is pinned** by `golden_test.go` (108 lines: the fixtures, a generated document and five real documentation pages, six option sets) and refactored only to share `dropWhere`; its output is byte-identical.
- **What v2 does on real text** (word counts as tokens, no overlap, nothing dropped): the joined text is identical to version 1's on every case, with fewer chunks: 181 to 48 on the generated short-section document at 512, 17 to 13 on the agents page, 8 to 7 on the costs page. A page whose sections are already near a passage's size does not change. I do not claim it retrieves better: that is the preview's job.
- **Surfaces:** `chunkerVersion` on profile creation (default 1; 400 `invalid_chunker_version` otherwise; fixed afterwards, and a request that tries to change it is refused as an unknown field), on a preview's `changes`, and kept by a candidate when the preview does not change it. The **Add profile** form has a Chunker choice, which the first draft left to the API.
- **Verification:** 13 mutants on the chunker rules and 7 on the plumbing, each killed by its own test (one, the parent rule, was first unpinned: a survivor found it; the fit guard, redundant while the floor is `MaxTokens/4`, is tested directly); 1.3 million fuzz inputs through both versions; integration through the preview and through ingestion; a cluster acceptance step (a preview that changes only the chunker, on a document of 40 short sections).
- **Still open:** C15 (D3); the measurement on a real knowledge base with a real embedding model (D5), which is the owner's to run after the release.
