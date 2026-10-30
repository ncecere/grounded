# ADR-0028: Contextual chunks

- Status: Proposed
- Date: 2026-10-30

## Context

A passage cut from a page can lose what it is about: "The deadline is 15 March" says nothing about which deadline. Roadmap item A4 (issue #21) asks for a short, model-written description of the document and section to be put in front of each passage **before it is embedded**, opt-in per source and with a cost estimate. It is the first feature that makes a model call for every document at ingest, so it is a spend, a data-handling and a failure-mode decision as much as a retrieval one. The owner's decision (2026-10-30) is that it ships with a real-model acceptance run before the issue is closed; until that run, nothing here claims that retrieval improves.

## Decision

- **The context is embedding input, never document text.** It is added to the text sent to the embedding model and nowhere else. `chunks.content`, heading paths, pages, citations, viewers, parent expansion (ADR-0026) and prompts are unchanged; the generated text is stored only in its own cache table, is never returned by a retrieval, chat or viewer API, and is never shown as if quoted from the source.
- **Per source, off by default, set by platform admins.** A row in `source_contextual` (absent = off) holds the opt-in, the chat model, the failure policy and explicit per-build and UTC-day call, token and configured-price spend admission caps. Only a platform admin session may change it; auditors read it; team members see its state. Saving it changes **no vector**.
- **Activation is an index preview** (ADR-0007, the index preview spec). A preview with `contextualChunks` copies the knowledge base's profile as a hidden candidate, snapshots the opted-in sources' settings into `set_contextual` (per source and profile) and builds the candidate beside the live index. The knowledge base switches only when an admin switches; switching back, discarding, and a preview with `contextualChunks: false` are the rollbacks. Another knowledge base that shares a source keeps its own profile and vectors.
- **One model call per section, not per passage.** Consecutive passages with the same heading path form a unit of at most 1,600 locally counted tokens and 8 passages. Each unit gets one call whose input is bounded (title, heading path, the document's first 400 tokens, the unit text) and whose output is bounded (384 requested tokens, then at most 100 tokens and 500 characters kept). A document that needs more than 40 units is embedded without context and marked. The plan bounds calls; token and configured-price figures use local counting with an allowance for tokenizer differences, not an external billing guarantee.
- **Cached by content.** The artifact is keyed by a SHA-256 of the exact bounded inputs, the model, the prompt version and the limits. A retry, a second profile and a preview-then-apply reuse a successful call; a changed section regenerates only itself. The cache row belongs to the document and goes with it; turning the source off or discarding the last set that used it removes it.
- **Untrusted text is data.** The prompt delimits it, escapes the delimiters, offers no tools and no other source's text, and the output is cleaned (one paragraph, no markup or URLs, no refusals) and capped before it is embedded. Nothing from a prompt or a reply is written to logs or the audit trail.
- **Explicit failure policy.** `fail` (the default) leaves a document unindexed for that set with a stated code and retries it; `plain` (an explicit choice) embeds that document's original text and marks it. A set with unembedded documents never becomes ready, so no preview or switch can publish a half-built index.
- **Cost is shown before it is spent and atomically admitted.** The estimate gives calls and local token/configured-price estimates; with no price it says the price is unknown. Enabling requires explicit token and positive configured-price amount limits as well as call caps. One short transaction reserves all three kinds of headroom, checking the build's limits and the source's UTC admission day together. The day includes build and live attempts across all profiles; platform-owned sources and cost-tracking mode off are not exceptions. Prices/currency are snapshotted, exact amounts are rounded up, missing prices or incompatible currencies fail closed, and deleting an index must not erase daily admission history. Unknown usage conservatively retains reservations. The team's existing budget/quota checks remain additional gates, not atomic spend admission.
- **Persistence is one bounded settlement.** Only the first terminal transition may commit usage and its successful cache artifact in one transaction; retries cannot duplicate usage or rewrite a terminal outcome. Persistence has bounded grace after caller cancellation. A remote 429 does not prove that no processing or billing occurred; only a proven unsent request can release admission. Local configured-price accounting is not a provider invoice guarantee.

These admission controls are the required design, **not an implementation-complete claim**. Main-thread review status and pending acceptance are recorded in [`../contextual-chunks.md`](../contextual-chunks.md). This ADR remains Proposed until the controls and architectural review are complete.

## Consequences

- With the setting off (every existing source) no code path changes: the embedded text, the stored rows and the number of gateway calls are what they were, pinned by a golden test.
- The extra model work requires explicit source/build and source/day call, token and configured-price admission limits, the per-document unit bound and any applicable team budget/quota. A crawl of a large site cannot authorize new spend on its own.
- A timed-out request may still be billed by the provider. Grounded records it as an attempt of unknown cost and counts it against the caps; it cannot know more.
- The generated context is derived from document text, so it follows the document's retention and deletion and the source's classification (the model must be cleared for it, ADR-0006 rule 4).
- Whether it helps retrieval is measured by the index preview's comparison and by the real-model acceptance run, not assumed. A hostile document can skew its own passages' embeddings, as its own text already can; it cannot reach another source.

## Alternatives considered

- **A profile setting only** (as ADR-0026). Rejected for opt-in: the unit of consent and cost is the source, and a profile spans many sources. The profile carries only the flag that a candidate is built with context.
- **One call per passage** with the whole document in the prompt. Rejected: cost and input size grow with passages times document length and cannot be bounded per document.
- **Storing the context on the passage row.** Rejected: it would be one step from being shown, searched by keyword, or cited as text.
- **New ledger units.** Deferred: usage is recorded as chat tokens of the chosen model so existing prices, budgets and reports apply without a schema change.
