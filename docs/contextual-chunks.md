# Contextual chunks (A4, #21)

Status: **design, written before the code** (2026-10-30); the "As built" section at the end is filled in as the work lands. Decision record: [ADR-0028](adr/0028-contextual-chunks.md). Roadmap: [`roadmap.md`](roadmap.md) A4. Builds on the [index preview](specs/index-preview/SPEC.md) and the profile migration ([`operations/profile-migration.md`](operations/profile-migration.md)).

> **Real-model acceptance is PENDING.** The owner requires a bounded run against a real model before #21 is closed ([`operations/contextual-chunks.md`](operations/contextual-chunks.md), "Real-model acceptance"). Everything in this change was exercised against fake models only. Nothing here claims that contextual chunks improve retrieval, answer quality or cost-effectiveness.

## 1. What it is, and what it is not

At ingest, for a source that opted in, a model writes a short description of where each section sits in its document ("This section of the Example University registrar's handbook explains the deadline for late course registration."). That text is put **in front of the passage in the text sent to the embedding model**, so the vector reflects the context as well as the passage.

It is **embedding context, not document text**:

| Stays exactly as it is | Why |
|---|---|
| `chunks.content`, heading path, pages, token count | citations, viewers, keyword (`content_tsv`), parent expansion and the answer prompt read these |
| `chunks.parent_first/last` and the parent-section hashes of ADR-0026 (when that change is merged) | a context prefix is not a passage; parents are built from original passage text |
| What retrieval returns, what a citation quotes, what a viewer shows | the generated text is never in any API response |
| Hybrid keyword search | the full-text vector is built from the original text; only the vector side sees the context |

The context lives in one table (`contextual_cache`) that no read API touches. It is never rendered as if the document said it.

## 2. Requirements and where each is met

| Requirement | Design | Section |
|---|---|---|
| Per-source opt-in, off by default; off = nothing changes | `source_contextual` row absent = off; golden test pins the embedded text, stored rows and gateway call count | 3, 12 |
| Estimate before activation, unknown price shown as unknown | `POST …/contextual/estimate`, `…/contextual-estimate` for a knowledge base | 5 |
| Explicit caps, no unlimited batch, no surprise crawl fan-out | per-build and per-day call caps per source, defaults 200, per-document unit limit | 5, 7 |
| No automatic live rewrite; preview beside live; explicit apply | activation is an index preview; saving a setting changes no vector | 4 |
| Shared sources, rollback | per-set snapshots; another KB's profile is never touched; switch back, discard, preview without context | 4 |
| Original text, headings, citations intact | context never stored on the passage | 1 |
| Model class, source grants, gateway policy | chat model whose ceiling covers the source, checked at save, at snapshot and before each document; connection limits and background priority apply | 6 |
| Untrusted text: no tools, no other sources, delimited, capped | prompt design, output cleaning, hostile fixture | 8 |
| No transcripts or text in logs or audit | counts and ids only | 9 |
| Cache keyed by content, model, prompt, settings; only affected work invalidated | SHA-256 of the bounded inputs | 7 |
| Deterministic artifact for a snapshot; generation need not be | cached text is reused for the same inputs; a regenerated section may differ | 7 |
| No half-built index; marked fallback only by explicit policy | a set with unembedded documents never becomes ready; `plain` is opt-in and marks | 10 |
| Cancellation and "off" stop calls at checkpoints | one checkpoint before every call | 11 |
| Actual usage honest, retries not silently double-billed | per-attempt ledger, success cached | 5, 7 |

## 3. Per-source settings

`source_contextual` (one row per source that ever had a setting; no row = off):

| Field | Meaning | Bounds |
|---|---|---|
| `enabled` | the source takes part in contextual previews and builds | default **false** |
| `model_id` | the chat model that writes the context | `kind = chat`, enabled, on an enabled connection, **max classification ≥ the source's** (ADR-0006 rule 4), context window (when declared) large enough for the bounded prompt; required when enabled |
| `failure_policy` | `fail` (default) or `plain` | section 10 |
| `max_calls` | the most model calls (attempts) one build of a set may make | 1 to 100,000, default 200 |
| `max_calls_per_day` | the most calls per UTC day for documents processed after the build (new and changed pages) | 1 to 100,000, default 200 |
| `revision` | `If-Match` token | |

- **Who:** `PUT /v1/admin/sources/{sourceId}/contextual` needs a platform admin **session** (an API key never can). Auditors read. Every member of the source's team reads its state read-only (`GET /v1/teams/{team}/sources/{sourceId}/contextual`; model name and counts, no spend). The reason for admin-only: the setting sends a source's text to a model and spends platform money, and sources can be shared across teams. A team that wants it asks a platform admin (see section 14, decision D1).
- **Model choice** is per source, so a restricted source can use a self-hosted model and a public one a hosted model. The embedding model is unrelated and is the profile's.
- **Classification:** the model is checked against the source's classification when the setting is saved, when a set is snapshotted and again before each document is processed; raising the source's classification above the model's ceiling stops further calls (`context_model_forbidden`) instead of sending data. A platform kill switch, `CONTEXTUAL_CHUNKS=false`, stops every call and refuses to enable.
- Saving **changes no vector, starts no job and makes no model call.** Audited as `source.contextual_update` (ids, flags and numbers only).

## 4. Snapshot, preview, apply, rollback

The existing machinery decides what is indexed: an embedding profile is immutable, a candidate profile is built beside the live one, and the KB switches in one transaction (ADR-0007, index preview). Contextual chunks use it unchanged, adding one flag and one snapshot:

1. **Candidate.** `POST /v1/admin/profile-migrations/preview` with `changes.contextualChunks: true` copies the KB's profile as a hidden candidate with `embedding_profiles.contextual = true`. (`false` copies a contextual profile into a plain one: the rollback after the grace period.)
2. **Snapshot.** In the transaction that starts the held migration, each of the KB's sources that is opted in, has a usable model and is not already embedded for the profile gets a `set_contextual` row: model, failure policy and prompt version as of that moment. Caps are not snapshotted (raising or lowering one takes effect at once). A source that is not opted in gets no row and is embedded as it is, so one KB can mix.
3. **Build.** The existing `embedding_set.sync` job embeds each document for the candidate. Where a set has a snapshot, the document's embedding texts come from the contextual path (section 7); everything else about the job (resumability, throttling, per-document failures, retries, the batcher, background priority) is unchanged. The live profile keeps answering and keeps its vectors; documents that change meanwhile are embedded for both.
4. **Hold.** When every source of the KB has vectors the migration becomes `ready`. The admin compares (evaluation comparison and the counts in section 10), then **switches or discards**. Nothing before the switch changes a query result.
5. **After the switch** the profile is an ordinary profile with `contextual = true`. A source whose own profile moves keeps its snapshot, so new and changed documents are processed with context as long as the source is still opted in. Turning the source off stops generation (section 11); passages already embedded with context keep their vectors until a new preview replaces them.
6. **Rollback.** Switch back within the grace period (immediate: the plain vectors were kept current), or later start a preview with `contextualChunks: false`.
7. **Shared sources.** A snapshot is per **source and profile**. A source in two KBs keeps its own profile until both have moved; KB A's candidate adds an extra set for it and KB B's queries, profile and vectors are untouched. Changing the source's opt-in later affects only sets that are still generating; it never edits a vector of the plain profile.
8. **Direct migration.** A normal (non-preview) migration into a profile with `contextual = true` snapshots the opted-in sources the same way.

The migration's stored estimate and the preview response gain a `contextual` block (sources with and without context, calls made, calls capped, documents embedded with context, plain by policy, too large). An existing preview or migration without it is read as "no contextual".

## 5. Estimate, caps and cost

`POST /v1/admin/sources/{sourceId}/contextual/estimate` (platform admins and auditors; no model call, no write) and `POST /v1/admin/profile-migrations/contextual-estimate` (a KB's opted-in sources) return, from the stored passages of the source's own profile (token counts and heading paths only, bounded work):

- documents, passages and **units** (each unit is one call), **documents over the per-document limit** (they would be embedded without context);
- `calls` (an upper bound: the cache is not subtracted), `inputTokensMax` and `outputTokensMax` (per-call bounds times calls, with a 25% margin on the counted input for tokenizer differences), `embeddingTokensAdded` (passages times the context bound);
- `cachedContexts` (rows already cached for the source under this model and prompt, informational);
- **price:** from the model's current chat prices (`input` and `output` per million tokens). If either is missing the estimate says `priceKnown: false` and `costMax: null`; it never shows an invented amount. The currency is the install's display code;
- **budget:** the team's budget state and whether the cost ceiling could cross it (when costs are tracked), otherwise `unknown`;
- **blockers:** no model, model not allowed for the source's classification, `calls` above `max_calls` (the admin raises the cap explicitly, or the preview is refused with `contextual_cap_exceeded`), kill switch off.

**During a build and afterwards,** before every call a checkpoint (section 11) checks, in order: the source is still opted in and the set still wanted; the kill switch; the **cap** (attempts in this build, or today's attempts for later documents); the team's **monthly budget** (the existing check; an exhausted enforced budget makes the document wait, as ingestion does) and daily chat-token quota; the model's classification ceiling. A reached cap or limit **waits** (a documented code, the document stays unindexed for that set or pending, nothing fails); raising the cap or the budget lets it continue.

**Counting.** Every attempt writes one `contextual_calls` row before it is sent (`started`) and settles it as `ok` (with the provider's reported input and output tokens), `refused`, `invalid` (an unusable reply), `error` or `timeout` (tokens unknown). A row left `started` by a crash counts as an attempt of unknown cost. Successful calls also write `chat_tokens_in/out` usage events (model, source, document, metadata `contextual_chunks`) in the same transaction, so the existing prices, budgets and reports apply and the team's daily chat-token usage includes it. Attempts without usage are shown as "unknown": the response gives `unknownCalls` and a per-call token ceiling, not a cost.

**Irreducible unknown.** A call that times out, is cancelled mid-flight or whose response is lost may have been processed and billed by the provider. Grounded records it as an attempt of unknown usage and counts it against the caps, and nothing more can be known on its side: reconcile against the gateway's own report (the `user` tag on each call is `grounded-contextual-<team>`).

**Concurrency and priority.** `CONTEXTUAL_CONCURRENCY` calls at once per process (default 2, 1 to 16), in addition to the connection's request limit (`requestsPerMinute` pacing and the proxy's Retry-After, which are backpressure, not failure) and background priority (`gateway.Background`). A 429 snoozes the job as embeddings do and does not count as a failure; it is still an attempt in the ledger only if the request was accepted (a refused request is `rate_limited` and not counted against the cap).

## 6. Model-call protection

- The context model is `kind = chat` only (not vision, systemone or moderation) and must be enabled on an enabled connection (`ChatTarget`). Its connection's timeout, rate limit, `extraBody` and compatibility flags apply because the call goes through the same `llm` provider as agent chat.
- **No tools, no history, no retrieval:** a system message and one user message. Nothing from another source, document, team, user or conversation, and no Grounded system context beyond the fixed instructions, is ever in the prompt. The `user` tag carries the team and not the document.
- Authorization is the source's (the text was already stored and is processed under the source's team); the call adds no new reader. Platform-owned (shared) sources have no team: no team budget applies and usage is recorded without one.

## 7. Bounds, unit planning, cache and versioning

**Bounds** (constants of prompt version 1; changing one is a new version and a new key):

| What | Bound |
|---|---|
| Title / heading path in the prompt | 200 / 300 characters |
| Document opening (the first passages of the document) | 400 tokens |
| One unit's text | 1,200 tokens and 12 passages (a passage over the bound is cut with a visible "[…]") |
| Units per document | 40; more and the document is embedded without context and marked `too_large` |
| Prompt overhead (instructions) | counted once, a few hundred tokens |
| Requested output | 384 tokens (`max_tokens`, clamped to the model's); kept: 100 tokens and 500 characters |
| Context added to an embedding input | only as much as fits in the embedding model's input limit without cutting any original text; below 16 tokens of room it is left out for that passage and counted |

**Units.** The document's passages in order; consecutive passages with the same heading path form a unit until adding one would pass the unit bounds. Every passage in a unit gets the same context; a document with no headings is cut by size.

**Embedded text.** `<document prefix>` + title and heading path + `Context: <context>` + the passage. With no context the string is the existing `chunk.EmbedText` output byte for byte.

**Cache.** Row key = SHA-256 over (format tag, prompt version, model id and upstream name, limits, title, heading path, document opening, unit text). Same inputs, same key: reuse. Any change to the document text of that section, the document opening, the model, the prompt or the limits is a different key; other sections keep theirs. Rows are per document (`ON DELETE CASCADE`), replaced by the pruning after each document's contexts are resolved, and deleted when the source opts out and when the last contextual set of the source is deleted.

**Determinism.** For a given snapshot (stored passages, model, prompt version, limits) the **plan** (units, keys, estimate, texts for cached units) is deterministic. A model's reply is not promised to be; once a reply is cached it is what every retry and every profile uses.

**Single flight.** Within a process one call per key at a time (concurrent documents and retries wait for it), and the cache is read again immediately before every call. Two processes working on the same document for two profiles at the same moment could each make one call for a key; that is the only way a key is generated twice, and both attempts are in the ledger.

## 8. Prompt injection

The prompt tells the model that the text between `<untrusted_document>` and `</untrusted_document>` is data to be described, that it may contain instructions that must be ignored, and that it has no tools. The delimiter text inside the document is neutralised. The model's reply is **never executed, never shown and never given to another model call**: it goes only into the embedding input. Output cleaning enforces one plain paragraph (markup, control, bidi and invisible characters removed; URLs removed; at most 500 characters and 100 tokens) and drops refusals and empties as `invalid` (counted, not cached, never embedded). A document that makes the model say something else can change the vector of **its own passages** (as its own text already does) and nothing else: there is no other source's text in the prompt, no tool, no URL fetch, no write. The test fixture holds a document that tries each of these and a canary string from another source, and checks the request that was sent and the text that was embedded.

## 9. Logs, audit, retention

- Logs, traces and audit entries carry ids, counts, codes and token numbers. **Never** a prompt, a reply, a document excerpt or a title. Error messages stored on documents and sets are fixed strings or gateway status text (`clip`ped), never the reply.
- `source.contextual_update`, `kb.profile_migration_start` (adds `contextual` counts) and the switch and discard events record settings and counts only.
- The cache, the call log and the marks are deleted with the document (the source), when the source is deleted, and the call log keeps no text. The cache is removed when the source turns contextual off and when the last set that used it is cleaned up. Generated text is therefore kept no longer than the document is.

## 10. Failure behaviour

| Situation | `fail` (default) | `plain` (explicit) |
|---|---|---|
| Model unavailable, 5xx, network error | the document is not embedded for this set; retried (sets: three transient attempts then it waits for an admin's retry, as for embedding; live: River retries, then the document fails `context_unavailable`) | same, until retries are used up; then the document is embedded without context and marked `fallback` |
| 429 or Retry-After | the job waits (backpressure; not a failure, not an attempt) | same |
| Reply refused, empty or unusable | the document is not embedded for this set (`context_invalid`); permanent until retried | embedded without context and marked `fallback` |
| Model not allowed (classification changed, disabled) | stops calling; the document waits or fails `context_model_forbidden` | the document is embedded without context and marked |
| Cap, budget or daily quota reached | **waits** (never a fallback: a cap is a stop, not a policy) | waits |
| Document over the unit limit | embedded without context, marked `too_large` (a size rule, not a failure) | same |
| Source turned off, kill switch off | calls stop; new documents are embedded without context, marked `off` | same |

A set whose documents are not all embedded never becomes `ready`, so a preview cannot be switched with a missing prefix; the migration page shows the failed documents and codes already. A `plain` fallback does complete, and the comparison shows how many documents have **no context** (`fallback`, `too_large`, `off`), so an admin sees a mixed index before choosing to switch. All writes of one document (chunks, vectors, mark) are one transaction.

## 11. Cancellation and the off transition

A **checkpoint** runs before every model call and between a document's units: it fails fast (the document is left as it was, no write) when the context is cancelled, the job is shutting down, the set is `deleting` or gone (a discard or cancel), the source is no longer opted in, the kill switch is off, or a cap or budget stops it. In-flight calls are bounded by the concurrency limit and are cancelled with their context; their attempts stay in the ledger. Cleanup of a discarded set deletes its `set_contextual` and mark rows with its chunks, and the cache when nothing else uses it. **At most `CONTEXTUAL_CONCURRENCY` calls per process can start after a stop is recorded** (the ones past their checkpoint).

## 12. Existing behaviour is pinned

With no `source_contextual` row, or with `contextual = false` on the profile, `Processor` never calls the contextual code: the embedding texts, chunk rows, usage events and the number of gateway chat requests are those of main, checked by a golden test of the texts embedded for a fixture document through the live path, the set path and the re-chunk path. Migration 00059 only adds tables and one defaulted column.

## 13. Compatibility with the held changes

Read from their branches without merging: #191 fuzzy boilerplate (`dbbc08d`) changes which blocks are dropped before chunking: the contextual path sees the resulting passages, so a different drop set is a different unit text and a different key. #193 tables (`8b724e6`) change what a passage's text is; large tables are cut at the unit bound. #197 parents (`72b07c0`) add `chunks.parent_first/last` and snapshots hashed over original passage text: the contextual path writes neither, adds no column to `chunks`, and does not change the copy, insert or re-chunk code beyond the text handed to the embedding call. Migration 00059 is the next free number; 00056 to 00058 belong to those branches and are not edited. #199 (content health) touches its own package, routes and model settings page; this change uses the shared declarations only.

## 14. Decisions for the owner or parent (conservative default applied)

- **D1, who may opt in:** platform admins only. The conservative alternative to "team editors or admins may enable for their own sources" (which would let a team spend platform money and send its data to a model the platform chose). Revisit after the acceptance run.
- **D2, ledger:** usage is recorded as chat tokens of the model. It is priced and budgeted with no schema change, **and counts in the team's daily chat-token quota**, which a large build can use up. The per-source caps and the budget bound it; a separate unit is the alternative and needs a pricing and reporting change.
- **D3, who may start a preview that makes calls:** platform admins, as for any preview (D3 of the index preview spec).
- **D4, fallback:** `fail` by default; `plain` is per source and explicit.

## 15. Testing

Unit: unit planning and bounds, key invalidation (each input), prompt construction and delimiter escaping, output cleaning and refusals, embed-text fitting, estimate against actual, price unknown. Integration (Postgres, fake models only): the off path golden test, the request the embedding model received against the stored text, model classification denial, injection fixture with a cross-source canary, cache reuse on retry, only the changed section regenerated, concurrent retries, cancellation and off, cap and budget errors, timeouts counted as unknown, preview/apply equivalence (the candidate's vectors equal a direct build) with the live index untouched, shared source and rollback, deletion. HTTP: the authorization matrix for every new operation. Web: vitest with axe for the controls, and a narrow browser check of the preview flow.

## 16. As built

*(Filled in when the change is complete.)*
