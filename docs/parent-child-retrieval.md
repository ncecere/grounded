# Parent/child retrieval (A5, [#20](https://github.com/ncecere/grounded/issues/20))

Search small passages, but give the model the larger section around each one. Opt-in per embedding profile, off by default, built to be tried with the index preview ([`operations/profile-migration.md`](operations/profile-migration.md)). Decision record: [ADR-0026](adr/0026-parent-child-retrieval.md).

**What this does not claim.** It has been tested with the fake models and the repository's own suites only. **It has not been measured on a real knowledge base with a real embedding or chat model, and nothing here says answers get better.** The owner's decision of 2026-10-30 is to ship it opt-in, validated for its mechanics; a measurement on real content is welcome and is not required.

## 1. The idea in one paragraph

A **child** is an ordinary passage (a chunk): it is embedded, searched and ranked exactly as before. A **parent** is a short run of consecutive children of the same document that share a heading path, no longer than the profile's **parent size** (`parentTokens`). When an agent answers, each ranked child that has a parent is replaced, in the text given to the model, by its whole parent. Ranking never looks at parents. Two children of one parent are one source, not two.

## 2. The setting

| | |
|---|---|
| Where | The **embedding profile**, like the chunk size, overlap and chunker: `parentTokens` in the API (`EmbeddingProfile`, `EmbeddingProfileCreate`, and `ProfileMigrationPreview.changes`), **Parent sections** in Admin → Embedding profiles → Add profile and in **Preview new settings…**. |
| Values | `0` (default): off, the profile is indexed and searched exactly as before. Otherwise at least twice the passage size and at most 8192 tokens (`400 invalid_parent_tokens`). |
| Fixed once created | Yes (ADR-0007): changing it is a new profile, and the index preview builds that profile beside the live index. |
| Independent of | The chunker version (1, 2, and 3 once it ships), the overlap, the boilerplate settings. Parents are made from the chunks the chunker produced, never from the chunker's own state. |
| Operator switch | `RETRIEVAL_PARENT_EXPANSION` (default `true`). `false` makes every search behave as if no profile had parents, at the next restart, without touching an index. See §9. |

A profile with parents and a profile without them can coexist on one install. A knowledge base uses one profile (ADR-0007), so a knowledge base either has parents or has not; an agent that spans knowledge bases of both kinds expands the hits of the first and leaves the others as they are.

## 3. Indexing: how parents are made

Parents are **ranges of ordinals, not stored text.** Each child row of a profile with `parentTokens > 0` gets two nullable columns, `chunks.parent_first` and `chunks.parent_last`: the ordinals (in the same document and profile) of the first and last child of its parent. Rows of a profile without parents keep both `NULL`. The text of a parent is read from its children when it is needed (§5), so nothing is stored twice and the parent can never disagree with its children about what the document says.

`chunk.Parents` (internal/chunk/parents.go) is a pure function of the document's chunks in order and the parent size. Starting at the first child, a parent takes the next child while all of these hold:

1. the child has **exactly the same heading path** (the chunker's "headings in effect at the start of the chunk"), so a parent is one section and never reaches into the next one;
2. the **tokens** of the children so far plus this one stay within `parentTokens` (the children's own token counts are summed, so overlap is counted twice and the bound is conservative);
3. the parent has fewer than **64** children.

Otherwise a new parent starts there. Consequences, all deterministic and pinned by tests:

- **A huge section** is cut greedily from its start into consecutive parents of at most `parentTokens`. A match late in a long section gets the window that contains it, not the whole section, and never more than the bound.
- **A section of one child** is its own parent: the model sees what it would have seen without the setting.
- **Sub-sections.** A deeper heading changes the heading path, so a sub-section is a parent of its own. The text of a section before its first sub-section is one parent; each sub-section another.
- **A document with no headings** has the empty heading path throughout, so it is cut into windows of at most `parentTokens` tokens.
- **Tables and code.** The chunker already cuts them into pieces that stand alone (version 1 repeats a table's header row and a code block's fence in every piece; version 3 also repeats the caption). A parent boundary falls **between children, never inside one**, so a boundary can fall between two pieces of one table; each parent then starts with the repeated header, and no row is lost, duplicated or cut.
- **Paginated documents** work like any other: a parent's pages are its first child's first page to its last child's last page.
- **Overlap.** Children may repeat the end of the child before them. Making a parent's text removes that repetition (§5), by the one function the source viewer also uses.

**Where it is written.** The ranges are set in the same transaction that writes the children, in every path that writes children: ingestion (`commit`), a boilerplate refresh that re-chunks a document (`commitRechunk`, which also keeps rows whose text did not change, so their ranges are rewritten), and a profile migration or index preview (`commitSet`, which copies children when the chunk settings match, so the ranges are computed for the target profile's own parent size, and cuts them again otherwise). A document that is updated or deleted loses its children, and so its ranges, in the transaction that replaces or deletes them: **a range can only point at rows that exist with it.**

## 4. Searching: ranking stays on children

The vector and lexical searches, the fusion weights, the minimum similarity, reranking and SystemOne judging all run on **child text**, unchanged. The only differences, for a profile with parents:

- **Siblings are collapsed before the cut.** After fusion (and before the result count is applied) hits that share a parent are merged into the best-ranked one, which keeps its place and its score; the others are dropped and counted (`matched`: the candidate passages, up to four times the result count, that fell in the parent). Within the oversampled candidate pool, siblings do not take each other's result slots: a search for `k` returns `k` distinct parents when that many are present. The pool is bounded at four times `k`, so a very large sibling group can still crowd other parents out of that pool. Reranking asks for the same candidate count as before and keeps the best `rerankTopN` distinct parents.
- **Nothing is ranked by its parent.** A parent has no score, no vector and no row of its own; its position is its best child's.

Collapse applies to the agent pipeline only (§7). `/retrieve`, the MCP `search` tool, Try it, evaluation retrieval checks, the gap report and the index preview's comparison return and score children as before.

## 5. Giving the model the parent

After judging and before sources are numbered, the agent pipeline loads the siblings of each surviving hit (`kbs.ExpandParents`, one query for all of them) and builds the parent's text: the children's contents in order, each stripped of the text it repeats from the one before it, joined by a blank line (`chunk.TrimOverlaps`, the function the source viewer uses).

A parent is used **only if every check passes**; otherwise the model gets the kept child. Siblings were already collapsed, so this is not a claim of equivalent context or answer quality (§11):

| Check | Why |
|---|---|
| every row from `parent_first` to `parent_last` exists, once, in the same document, the same source and the KB's profile, with no gap | a deleted, replaced or half-written parent is never stitched together from what is left |
| every sibling carries the same range as the hit | a range the siblings do not agree on is stale |
| the document is `ready` and its source is one of the sources the search was allowed to read (the KB's, narrowed by the agent's filters) | expansion never reads more than the search could |
| the children's tokens add up to at most `parentTokens` (and never more than 8192) | a hard bound that does not depend on what was written |
| the parent's estimated tokens (characters / 4, as for every source) fit the answer's **remaining context budget** | the budget stays a hard limit; a parent that would not fit is replaced by its child, never cut |

Context budget, numbering and deduplication in `retriever.number`: a parent costs what its text costs; a parent already numbered earlier in the answer (in tool mode, another search found another child of it) keeps its number and costs nothing; two hits in one search that share a parent are one source. A first hit that does not fit the budget at all is trimmed as before, from its child.

## 6. Citations and the source viewer

The citation records the section used for generation. This provenance does not grant more verbatim document access in the cited viewer:

- `Citation.chunkId` is the **matched child** (the ranked passage), as before. `Citation.snippet` is made from the text the model was given (the parent's start), as before.
- `Citation.parent` (new, optional) records `first`, `last` (ordinals), `passages`, `tokens` (estimated context tokens), `matched` (matching candidate passages) and `sha256` of the parent context **before the standard prompt escaping**. Prompt construction still neutralizes source delimiters and trims whitespace. It is absent when the model was given the child.
- All cited-viewer routes—signed-in conversations, anonymous/public/widget sessions, and signed-in or public share links—retain the existing **matched passage plus bounded nearby context**, not the full parent. Only that matched passage is marked cited. The viewer explains that generation used a larger section, without claiming the displayed window is all of it. Before returning that window, the server validates the entire parent's hash against the citation; if it differs, or the matched passage can no longer be identified, it returns `passage_changed` and no current source text. This includes a re-cut that replaces the matched passage ID even if the larger section's text is identical. Deleted documents remain `document_deleted`.
- Answers from before the setting, and answers whose model was given a child, have no `parent` and are shown as before.
- Try it and the widget preview read the section through the team's document endpoint (`GET …/documents/{documentId}/text` with `around`, `parentFirst`, `parentLast` and `parentSha256`), for editors, admins and owners only, with the same hash check. Sending only part of the three is `400 invalid_parent`; a hash that does not match is `404 passage_not_found`.

There is **no new direct-text grant** to members, anonymous users or share-link recipients. Their cited view remains about a page (at most three neighbours per side, with the existing character budget). Full parent sections and whole documents stay on the already-authorized editor/admin/owner document-text route. This preserves ADR-0009's snippet boundary rather than widening it implicitly.

## 7. Which surfaces use it

| Surface | Parents |
|---|---|
| Agent answers: native chat (stream and non-stream), public pages and widget, **the OpenAI-compatible endpoint**, MCP `ask`, evaluation full-answer checks, SystemOne judging and citation checks (which read the text given to the model) | yes, through one retriever |
| `POST …/retrieve`, MCP `search`, Try it, gap report, evaluation **retrieval** checks, the index preview's comparison | no: children, as before |

## 8. Permissions and provenance

Expansion cannot reach anything the search could not: every sibling is a row of **the same document, the same source and the same profile** as the hit, loaded by a query that is again scoped to the search's source IDs, with the document `ready`. The range stored on a row is only ever ordinals within its own document and profile, and is checked against the rows found. There is no fallback: when the check fails the model gets the child. Nothing in the path takes a user, a team or a classification as input, so none of them can widen. Tests: a range forged to point across documents and sources, a source that leaves the KB, a document deleted, replaced or re-cut between search and expansion, siblings missing, and a parent in a source outside the agent's filter.

Provenance is the set of fields in §6 plus the audit of the setting: a profile's creation, preview and switch are audited as before, and the profile snapshot in the audit log carries `parentTokens`.

## 9. Preview, apply and rollback

- **Preview.** *Preview new settings…* takes **Parent sections** like it takes the chunker. The candidate profile has the live profile's settings with the change; the held migration builds its children **beside** the live index (copied when the passage settings match, cut again otherwise) and writes their ranges. The live index, its rows and its vectors are not touched until **Switch to the new index**. A preview that only sets `parentTokens` leaves the children, the vectors and so the ranking exactly as they are: **the comparison will show no change in recall or rank, and cannot show whether the model answers better**, because it measures retrieval of children by document. To see a difference in what is *searched*, preview a smaller passage size together with a parent size. The preview page and the profile page show the setting; they do not estimate answer quality.
- **Equivalence.** The index a preview built and the index an ordinary ingestion of the same documents under the same profile would build have the same children and the same ranges (tested on real Postgres).
- **Rollback, in order of speed.** (1) Before switching: **Discard preview**. (2) After switching, within the grace period: **Switch back**, which restores the previous profile's children (kept). (3) At any time, without re-indexing: set `RETRIEVAL_PARENT_EXPANSION=false` and restart; searches then neither collapse nor expand, and the columns are ignored. Answers already cached keep their text until they expire. (4) An older release ignores the new columns, so a database upgraded to this release can be run by the previous release: it searches children only.
- **Migration 00057** is additive (a profile column with a default and two nullable chunk columns), as ADR-0013 requires. Its range check deliberately does not relate the range to `ordinal`: old workers temporarily use negative ordinals and can reorder chunks without clearing these new fields. Expansion validates the hit's membership and all sibling ranges on read, falling back for stale metadata. A regression executes the old writer's ordinal transition with populated parent ranges.

## 10. Compatibility with the chunker v3 and fuzzy boilerplate changes

Neither is on `main` when this is written ([#193](https://github.com/ncecere/grounded/pull/193), [#191](https://github.com/ncecere/grounded/pull/191)). This change reads only the public result of the chunker (`[]chunk.Chunk`), adds no state to the splitter and does not edit `internal/chunk/pack.go`, `split.go` or `v2.go`, so version 3 needs nothing from it. Fuzzy boilerplate decides which blocks a document drops, before chunking; parents are made after chunking, so a re-chunk it triggers goes through `commitRechunk`, which rewrites the ranges. Both change files this change also touches, in small places (the profile form, the preview dialog, `reembed.go`, `candidate.go`); the merge conflicts are mechanical. The migration is `00057` because `00056` belongs to #191: **#191 must merge first**, since the migration runner refuses a migration older than one already applied.

## 11. Limits and what is not measured

- **Siblings are merged before later filters and parent loading.** If the kept child fails the agent's minimum similarity or SystemOne judging, another sibling that could have passed is not restored. If the parent is missing, stale or over budget, the model gets only the kept child, where the off path might have supplied several. These are opt-in context tradeoffs, not equivalence or quality guarantees. `grounded.retrieval.parents_skipped` counts pre-numbering parent-load outcomes, including single-child parents; it does **not** count later budget fallbacks or filter/judge losses, and is not a complete count of reduced-context cases.

- No answer-quality claim, no latency claim, no cost claim. Parents give the model more text per source, so prompts are larger by up to the context budget; the budget is the bound.
- A parent is a section's window, not a semantic unit: a heading path that repeats, or a long section cut at `parentTokens`, can put a match at the edge of its parent.
- Parents are built from children, so a profile with tiny passages and a large parent size makes many children per parent (at most 64).
- Storage: two integers per child. No text is duplicated.
- Expansion adds one indexed query per search. Its time has not been measured on a large knowledge base.
- Reranking and judging still read children, which is the point of the design, and the reason the cross-encoder cannot say whether the parent is the better thing to give the model.
