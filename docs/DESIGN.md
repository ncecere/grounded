# Grounded: Design

Status: **Living design. Phases 0–3 are implemented** (§19). Last updated 2026-09-26.

This document is the overview of the general system. The reasons behind each major decision are recorded as ADRs in [`docs/adr/`](adr/README.md). Facts that belong to one install (its gateway, data rules, retention sign-off, hosting and branding) live in [deployment profiles](deployments/README.md), not here (ADR-0018). §17 is the historical record of the first design review.

## 1. What we are building

An open-source (MIT), institution-neutral retrieval-augmented generation (RAG) platform. One install serves many teams inside one organisation (a university, a company, a public body) and runs on infrastructure the operator controls, typically Kubernetes. Its first test deployment is at a university; nothing specific to that install lives in this repository ([ADR-0023](adr/0023-no-institution-data-in-the-repository.md)).

- **Teams** create **data sources** (scraped websites and uploaded files at first, more types later). They group sources into **knowledge bases (KBs)** and create **agents** that answer questions using those KBs.
- **Agents** can be kept within the team, shared with every signed-in user of the install, or made public with no login. Public agents may use Open data only.
- **Sensitive data is supported.** Data classification controls which models may process data, who may use an agent, and how long logs are kept. What each level covers, and which data is prohibited outright, is the install's policy (§4).
- **Web UI and API are both first-class.** Any OpenAI-compatible client can talk to an agent.
- **Usage is tracked** per team, user, agent and API key. There is no billing.
- **Design target: 99.9% availability,** with the HA topology in §15 and an operating team on call.
- **Each install supplies its identity** (names, theme, logo, support links, first-run seed data) through configuration (§15, "Configuration and instance identity").

### Sizing (estimate per install; revisit after a pilot)

The design is built for more than 1M documents and tens of millions of chunks per install. Estimate these dimensions before production, and load-test at 2× them:

| Dimension | What drives it |
|---|---|
| Documents and initial backfill | Size of the sites and file shares teams will load, and how fast they must be ready |
| Chunks | About 1–50 per document. At 768 dims `halfvec`, each chunk's vector is 1.5 KB, so 10M chunks is about 15 GB before indexes (§9). |
| Embedding rate during backfill | Bounded by the gateway's requests per minute per key and inputs per request (§5.5) |
| Daily active users, concurrent chats, queries per day | Drive `api` replicas, chat-model capacity and the limits in §11.1 |

For example, the first test deployment planned for more than 1M documents (10–50M chunks, a backfill of about 1M documents over two weeks at 10–40 chunks/s), 5,000 daily active users, 50 concurrent chats and 20,000 queries per day, with a load-test target of twice that. Each install records its own estimates in its [deployment profile](deployments/README.md).

## 2. Concepts

| Concept | Owned by | Summary |
|---|---|---|
| **User** | Platform | An OIDC identity. Anyone the install's OIDC settings permit can sign in. |
| **Consumer** | — | A signed-in user who is not on any team. They can only use published agents. |
| **Team** | Platform | The tenant. Only platform admins create teams. There are no personal spaces. |
| **Data source** | A team, or the platform (shared) | Has exactly one type (e.g. `web`, `upload`), one embedding profile and one classification. It produces documents. |
| **Document** | Data source | A parsed page or file, split into chunks. |
| **Knowledge base (KB)** | Team | A named set of data sources. Can include platform-shared sources. |
| **Agent** | Team | Instructions, a chat model and one or more KBs. Versioned and publishable. |
| **Embedding profile** | Platform | Embedding model, dimensions, prefixes and chunker settings. |
| **Classification level** | Platform | Open, Sensitive or Restricted (admins can configure the list). |
| **Model connection** | Platform | An OpenAI-compatible API proxy (LiteLLM, open-model-gateway, vLLM, …) that admins connect and add models from. |

```
Platform
├── Users (platform_admin | platform_auditor | none; active | suspended; stored OIDC claims)
├── Model connections ──< Models (chat / embedding / …; each tagged with the highest classification it may process)
├── Embedding profiles
├── Source type registry (enabled types, per-type limits, crawl domain allowlist)
├── Policy (limit defaults and ceilings, classification rules, retention, legal holds)
├── Platform-shared data sources
└── Teams (each approved up to a maximum classification)
    ├── Members (owner | admin | editor | member), pending email invites
    ├── API keys (personal and team service keys)
    ├── Data sources ──< Documents ──< Chunks ── vectors
    ├── Knowledge bases >──< Data sources (team-owned or platform-shared)
    └── Agents ──< Agent versions (each version references KBs)
          └── Conversations (only the user who had a conversation can read its transcript)
```

## 3. Identity, roles and access

### 3.1 Authentication
- **Sign-in:** generic OIDC authorization-code flow with PKCE, state and nonce (`coreos/go-oidc`). Configurable per deployment: issuer, client, scopes and allowed email domains.
- **Stored claims:** all OIDC claims are saved at each login (e.g. affiliation, groups). No v1 feature uses them, but they let us restrict audiences later without redesign (ADR-0009).
- **Browser sessions:** stored server-side, with secure cookies, CSRF tokens and Origin checks.
- **Bootstrap:** the first platform admin is set by exact `(issuer, sub)`, once only. This is the yoink pattern.
- **Provisioning:** any permitted identity is created automatically as a consumer. To build anything, a user must be added to a team.
- **Dev login:** available only when `DEV_AUTH=true` and `APP_URL` is a loopback address.

### 3.2 Team membership (ADR-0002)
- Team admins add members **by email**. If the person has never signed in, this creates a pending invite. The invite links to their account when someone with that verified email first signs in. Invites expire after 30 days.
- **Requesting a team.** In v1, the app links to `TEAM_REQUEST_URL` (for example a service-desk request form), and a platform admin creates the team by hand. Later: an in-app request form (purpose, owner, requested maximum classification, justification) with an approval queue.

### 3.3 API keys (ADR-0012)
- **Personal keys.** Tied to a user and a team. Revoked automatically when the user leaves the team. Allowed scopes depend on role: members get `query` only, editors get `query` and `ingest`, admins and owners get all scopes.
- **Team service keys.** Only team admins and owners can create them. They belong to the team, survive staff changes, and have a named responsible contact (a team member, chosen at creation and reassigned with `PATCH /v1/teams/{team}/api-keys/{keyId}`), shown in the key list.
- **All keys:**
  - Scopes: `query`, `ingest`, `manage`.
  - Can be restricted to specific KBs or agents.
  - Have an expiry date.
  - Format `rag_<12-char id>_<40-char secret>`. The id is stored in clear for lookup; only HMAC-SHA256(`API_KEY_PEPPER`, key) is stored. The secret is shown once.
  - Can never administer the platform.
- **Agent publishable keys** can call only one published agent. They are for the embeddable widget and are restricted by allowed origins. Team admins and owners create them, as part of publishing an agent for embedding.

### 3.4 Platform roles
| Role | Can do | Cannot do |
|---|---|---|
| `platform_admin` | Policy; gateway and models; embedding profiles; source types; crawl allowlist; classification rules; create, archive and delete teams; team limits and approved classification; platform-shared sources; agent short names; disable any agent; global public-agent switch; break-glass; legal holds | Read team content or conversation transcripts without break-glass (§3.6). Write team content, even under break-glass. |
| `platform_auditor` | Read metadata, usage, audit and the access log across the platform | Change anything. Read content. |

Admins get no access to content by default (ADR-0011). The last active platform admin cannot be demoted or suspended.

### 3.5 Team roles
| Action | Owner | Admin | Editor | Member |
|---|:-:|:-:|:-:|:-:|
| Use team agents, query team KBs | ✅ | ✅ | ✅ | ✅ |
| Create and edit data sources, KBs and agents | ✅ | ✅ | ✅ | |
| Raise a source's classification | ✅ | ✅ | ✅ | |
| Lower a source's classification (needs a reason; owners are notified) | ✅ | ✅ | | |
| Publish agents to `team` | ✅ | ✅ | ✅ | |
| Publish agents to `authenticated` / `public` | ✅ | ✅ | | |
| Manage members | ✅ | ✅ (not owners) | | |
| Create team service keys | ✅ | ✅ | | |
| Create personal API keys (scopes by role, §3.3) | ✅ | ✅ | ✅ | `query` only |
| Request crawl domains outside the allowlist | ✅ | ✅ | ✅ | |
| View team usage, analytics and audit | ✅ | ✅ | read | |
| Change team limits or approved classification | platform admin only | | | |

### 3.6 Break-glass (ADR-0011, ADR-0024)
As built in Phase 5 (runbook: [`operations/break-glass.md`](operations/break-glass.md)):
- **What it grants:** one platform admin, one team, read-only, for a limited time. The scope is `documents` (data sources, documents, passages, tags, crawl history, repeated blocks), `conversations` (the list of conversations with the team's agents, without who had them, and their transcripts), or both. Nothing else: no writes, no export, no KB or agent settings, no API keys.
- **How it's enforced:** not a role. `internal/authz` holds the grant rules (`BreakGlassSession.Allows`: same admin with a browser session and the platform_admin role, same team, the scope, within the time window); the source and conversation services check the grant from the database on every content read by a non-member, so ending, revoking, expiry and demotion take effect on the next request.
- **Required:** a reason of at least 20 characters, shown to the team's owners. Default 1 hour; the maximum is a platform setting (8 hours by default).
- **Approval:** a platform setting (`break_glass_settings`, Admin → Break-glass → Settings). By default one admin with a written reason starts a session alone; an install can require a second platform admin's approval (self-approval is refused), with a request timeout (1 hour by default). A denial needs a reason.
- **Safeguards:** every read is audited with the session ID (`breakglass.read`: kind and target, never content), and so are the start, approval, denial, withdrawal, end, revocation and expiry (§13). Team owners are notified in the app and by email when a session starts and, when it ends, with a summary of what kinds of things were read and how many; neither can be turned off (§12). The reading admin sees a banner with the time left and End now; owners see a notice on the team's pages. Any platform admin can revoke a session.

## 4. Data classification (ADR-0006)

Platform admins configure the levels, which are ordered by rank:

| Level | Rank | Default maximum agent audience | Default models |
|---|:-:|---|---|
| Open | 0 | `public` | Any enabled model |
| Sensitive | 1 | `authenticated` | Models tagged ≥ Sensitive |
| Restricted | 2 | `team` | Only models an admin tags for Restricted (typically self-hosted or covered by a data agreement). Admins tag each model as it is added. |

**What each level means is the install's policy.** The product enforces the mechanisms: model ceilings, audience ceilings and retention per level. It doesn't encode any law. The default level descriptions are neutral; each install writes its own, and states in its terms of use any data that is prohibited outright. For example, a US university might define Restricted as FERPA-protected student records and similar institutional data, and prohibit PHI. A separate level for especially regulated data, such as health data, can be added later without schema changes.

Each level also sets:
- conversation retention
- anonymous conversation retention
- allowed source types
- whether team API keys may call `/retrieve` directly

### Rules, enforced at write time and again at query time
1. **Team ceiling.** A team is approved up to a maximum rank. A data source's rank must be ≤ its team's maximum.
2. **Attaching sources.** A KB may attach a source (including a platform-shared one) only if the source's rank ≤ the KB team's maximum.
3. **Computed ranks.** `KB.effective_rank = max(source ranks)`. `Agent.effective_rank = max(ranks of the KBs in the published version)`.
4. **Model ceilings.** The embedding model of a source's profile, and the agent's chat model, must each be tagged with a maximum rank ≥ the rank of the data they process.
5. **Audience ceiling.** Every audience grant on an agent must be allowed for the agent's effective rank.
6. **Raising a rank is checked downstream.** A change that would raise an effective rank is rejected if it would break a rule for any dependent KB or agent. The error names the affected objects. We never unpublish silently. Changes to platform-shared sources show admins an impact preview across all teams.
7. **Lowering a source's classification** requires a team admin and a written reason. Team owners are notified and the change is audited. Editors may raise a classification.
8. **Every query rechecks** the published version's rank, models and audience against current policy before retrieval. If the check fails, the query is refused rather than degraded.

## 5. Data sources (ADR-0008)

### 5.1 Types and plugins
Each type is a Go plugin registered at startup. Platform admins enable or disable types and set per-type limits.

```go
type SourceType interface {
    Key() string                                   // "upload", "web", later "sharepoint", ...
    ConfigSchema() json.RawMessage                 // JSON Schema for UI + API validation
    Capabilities() Capabilities                    // scheduled sync, incremental, deletes, push uploads
    ValidateConfig(ctx context.Context, raw json.RawMessage, lim TypeLimits) (Config, error)
    Sync(ctx context.Context, src Source, cur Cursor, sink DocumentSink) (Cursor, error)
}

type DocumentSink interface {
    Upsert(ctx context.Context, ref DocumentRef) error // external ID, title, URL, MIME, metadata, ACL, body opener
    Delete(ctx context.Context, externalID string) error
}
```

- A source's type is fixed when it is created. Its config is type-specific JSON, validated by the plugin.
- **Document ACLs are planned for, not implemented.** Documents have a nullable `acl` column, and retrieval has an ACL filter hook. v1 leaves both empty. Later connectors with per-file permissions, such as SharePoint, can fill them in without a migration.

### 5.2 `upload`
- Files arrive through the API or UI. The API streams them to object storage and deduplicates by SHA-256.
- **v1 file types:** PDF (text-based), DOCX, PPTX, HTML, Markdown and TXT. Other types are added later as parser plugins.
- **File size limit:** each source type has a maximum file size that admins can change. The default is 100 MB.
- Replacing a file creates a new document version.

### 5.3 `web`: a native crawler ported from yoink
yoink is **not a runtime dependency**. We port its crawl, scrape, batch and map code (including URL policy, robots.txt, sitemaps, per-origin throttling, SSRF controls and HTML→Markdown extraction) into this application. **There is no JS rendering.** yoink's `render*` packages and chromedp are not ported.

**Modes.** Each web source uses exactly one of these:

| Mode | Behavior |
|---|---|
| `scrape` | Fetch one URL |
| `batch` | Fetch a list of URLs that you supply |
| `crawl` | Start from seed URLs and follow links within a scope (depth, include/exclude patterns, page limit) |
| `map` | Discover URLs from links and sitemaps without fetching content. Used to preview a crawl, and for "map a site → choose URLs → create a batch source". Also exposed through the API. |

**Controls:**
- **Domain allowlist.** Platform admins manage wildcard patterns (`*.example.edu`, `example.org`, or `*` to allow everything). Teams can request other domains, and platform admins approve them for that team.
  - **A fresh install's allowlist is empty,** so nothing can be crawled until an admin adds patterns. `CRAWL_ALLOWLIST_SEED` adds patterns once, on first start ("Configuration and instance identity", §15). Migrations seed nothing.
- **SSRF protection is always on**, even when the allowlist is `*`. Private, loopback and link-local addresses are always blocked, both at DNS resolution and when connecting.
- robots.txt and per-origin rate limits are always respected.
- **Public sites only in v1.** The config schema leaves room for an authenticated-crawl option later.
- Crawl state (frontier, page status) is stored in our Postgres, and crawl steps run as River jobs.
- **Deletions.** Pages missing from a completed full crawl are marked deleted (tombstoned). Non-HTML files found by the crawler (PDF, DOCX) go through our parser.
- Per-team limits cover pages per day and concurrent crawls.

### 5.4 Platform-shared sources
Any source type can be owned by the platform instead of a team. Only platform admins manage them. Teams attach them to KBs, subject to the classification rules.

### 5.5 Ingestion pipeline
Every step is an idempotent River job.

```
source.sync ─► document.fetch ─► document.parse ─► [scan hook] ─► document.chunk ─► document.embed ─► document.index ─► ready
                 (blob → S3)       (parser)         (no-op in v1)   (profile chunker)   (gateway, batched)   (vectors + lexical)
```

- **Unchanged content is skipped.** If the content hash hasn't changed, nothing runs after fetch.
- **Parsing:**
  - TXT, Markdown and HTML (converted to Markdown) are parsed natively in Go.
  - **Built-in parsers handle every v1 format in-process; no external service is required.**
    - **PDF:** PDFium (Chrome's PDF engine) compiled to WebAssembly and run inside the Go process, with no CGO. Hostile files are contained by the WebAssembly sandbox. Headings are inferred from font size, repeating headers, footers and page numbers are removed, line-break hyphens are joined, and indented first lines start new paragraphs.
    - **DOCX and PPTX:** our own Office XML readers, with zip-bomb limits. DOCX gives headings (from styles and outline levels), lists and tables. PPTX gives one page per slide, in presentation order, with title, bullets, tables and speaker notes.
    - **HTML:** the yoink extractor, ported as `internal/htmlmd`.
    - **Markdown and text:** decoded from UTF-8, UTF-16 or Windows-1252.
  - **Apache Tika is optional** (`TIKA_URL`). It is used as a fallback when a built-in parser fails, or first for the kinds listed in `TIKA_PREFER_KINDS`. With Tika's OCR image, it can also read scanned PDFs.
  - Paginated formats mark page starts with `<!-- grounded:page N -->` lines, so chunks can cite page numbers. Parsed text stored before the rename (ADR-0022) has `<!-- ragd:page N -->` markers, which are still read.
  - `grounded parse FILE` prints what a file will turn into.
  - **There is no OCR in v1.** Scanned PDFs are marked `skipped(needs_ocr)`. OCR will later be an optional parser stage.
- **Scan hook.** A slot for PII scanning after parsing. It does nothing in v1. Planned next: pattern scanning (national ID numbers such as SSNs, institutional ID numbers, card numbers) that quarantines matching documents in Open or Sensitive sources until a team admin reviews them. After that, model-based detection.
- **Chunking** follows the document's heading structure and is measured in tokens, using the size and overlap from the embedding profile. Each chunk stores metadata for citations and filtering: heading path, URL or filename, page or section, tags and dates. A chunk whose only text is images (alt text), headings and rules is not emitted, unless the whole document is like that.
- **Repeated-boilerplate suppression (ADR-0021).** Sites repeat blocks inside the main content ("QUICKLINKS" lists, calls to action, "related content" cards, sign-offs). Those blocks get retrieved and cited instead of real content.
  - **What counts.** Each document's blocks (the chunker's headings, paragraphs, lists, tables and code) are normalised and hashed: link targets removed, lower case, whitespace collapsed, and digit runs folded (not in headings). The hashes are recorded per document (`document_blocks`).
  - **Threshold.** A block is boilerplate when at least `max(minDocs, ceil(ratio × documents))` of the source's documents contain it. The defaults are 5 and 0.2 ([`boilerplate.md`](benchmarks/boilerplate.md)).
  - **What is dropped.** Boilerplate blocks are left out before chunking, except in one canonical document (the shortest URL), so their information is indexed once. A document's only content is never dropped. Dropped headings stay in the heading paths of the blocks under them.
  - **Order independence.** Early pages are indexed before the counts are known. After every crawl run, upload batch, deletion or settings change, the River job `boilerplate.refresh` waits for the source's documents to settle and recounts. It then re-chunks the documents whose dropped blocks changed, from their stored parsed Markdown, with no fetching or parsing. Unchanged chunks keep their rows and vectors, and only new chunks are embedded. The job is idempotent and works in bounded batches.
  - **Settings.** Per source, `boilerplate: {enabled, minDocs, ratio}`. It is on by default for web sources and off for uploads, and the platform defaults come from `BOILERPLATE_WEB`, `BOILERPLATE_UPLOAD`, `BOILERPLATE_MIN_DOCS` and `BOILERPLATE_RATIO`. Changes are audited (`source.boilerplate_update`) and schedule the refresh.
  - **Visibility.** The source's Overview (and API object) shows "N repeated blocks removed from M pages", with the most repeated blocks listed (`GET …/sources/{id}/boilerplate`).
- **Document states:** `pending → fetching → parsing → chunking → embedding → ready`, or one of `failed`, `skipped`, `quarantined` or `deleted`. Failed documents keep their error and can be retried.
- **Backpressure:**
  - A dispatcher moves `pending` documents to `queued` **round-robin across teams**: every team's oldest document goes before any team's second, each team is capped by its `concurrent_ingest_jobs` limit (§11.1; built-in default `INGEST_MAX_INFLIGHT_PER_TEAM`), and the platform at `INGEST_MAX_INFLIGHT`. It runs every 5 s and whenever an upload lands or a document finishes.
  - One River job processes a document end to end (fetch, parse, chunk, embed, index); `INGEST_CONCURRENCY` bounds jobs per worker process.
  - **Embedding requests are shared across documents.** Gateways typically limit requests per key, not inputs (the gateway used in the benchmarks allows 120 requests per minute per key; [`scale-10k.md`](benchmarks/scale-10k.md)), so each worker process has a batcher per embedding profile: document jobs hand over their chunks and wait, and a request carries up to `EMBED_BATCH_SIZE` inputs (and `EMBED_BATCH_TOKENS` counted tokens) from whichever documents are waiting. A partial request waits up to `EMBED_BATCH_WAIT` for more. Each document keeps its own status and retries; a request the proxy rejects as invalid (4xx) is retried per document, so one bad document cannot fail the others. Batches can only hold documents in flight at the same time, so `INGEST_CONCURRENCY` and the per-team in-flight cap bound them.
  - **Per-connection request limit.** A model connection may set `requestsPerMinute` (null = unlimited). It is enforced across every Grounded process in Valkey (a GCRA pacer: one request per 60/N seconds, no bursts). Set it just below the proxy key's limit, e.g. 110 for a key allowed 120 requests per minute.
  - **Ingestion embedding runs at lower priority than live queries.** Queries and chat reserve the next free slot and wait at most 10 s for it (then 503 `model_unavailable` with Retry-After). Ingestion only takes a slot that is free now, so it never pushes a reserved interactive slot back, and waits in process for up to a minute.
  - **Rate limiting is backpressure, not failure.** A 429, a 503 with Retry-After, or a wait longer than ingestion's patience snoozes the document's job for the Retry-After (bounded to 1 s–10 min, plus jitter): the document goes back to `queued` (`rate_limited`), and neither River's attempts nor the document's `attempts` count it. A proxy's Retry-After also blocks the connection's pacer, so every process backs off. Other 5xx and network errors still retry with backoff (5 attempts) and then fail.

## 6. Knowledge bases

- A KB is a set of data sources. It can mix the team's own sources with platform-shared sources the team is allowed to use.
- **All sources in a KB share one embedding profile** (ADR-0007).
- Each KB holds default retrieval settings: top-k and **hybrid fusion weights** (a minimum score may follow).
  - Weights are a vector weight and a keyword weight, each 0–1 (not both 0). They resolve in order: **the KB's own weights → its embedding profile's default (`defaultFusionWeights`, §10) → the platform default**, `RETRIEVAL_VECTOR_WEIGHT` = 1 and `RETRIEVAL_KEYWORD_WEIGHT` = 0.1. The API shows the KB's override (`fusionWeights`, null when unset), the weights in effect (`effectiveFusionWeights`) and where they come from (`fusionWeightsSource`: `knowledge_base`, `profile` or `platform`); `useDefaultFusionWeights` removes an override. The KB settings page says when the weights come from the profile.
  - The platform default suits a mid-strength embedder. A strong one can lose quality to keyword fusion: on FiQA, `qwen3-embedding-4b` scored nDCG@10 0.770 vector-only, 0.760 at keyword weight 0.02 and 0.727 at 0.1, while nomic stayed flat ([`spark-models.md`](benchmarks/spark-models.md) §2.2). That is why a profile can carry its own default.
  - Agents search through their KBs, so they inherit each KB's weights.
  - The defaults come from BEIR FiQA and a 30-question evaluation set over a public university registrar website ([`scale-10k.md`](benchmarks/scale-10k.md), "Fusion tuning"). Equal weights scored nDCG@10 0.364 against 0.526 for vector search alone on FiQA; the defaults score 0.526 on FiQA and 0.948 on the registrar set (vector alone 0.943, equal weights before tuning 0.903). A KB of codes, names and policy numbers may want a higher keyword weight.
- A KB's effective classification is always computed, never set by hand.
- **Metadata and tags** are stored from the start. Filters (on source, type, tags, dates, URL prefix) come to `/retrieve` and agent settings in Phase 3. Letting the model choose filters itself in `tool` mode comes later.

### Retrieval
1. If there is chat history, optionally rewrite the question as a standalone query using a small model.
2. Embed the query with the KB's profile, including the query prefix (e.g. nomic's `search_query:`).
3. Run a vector search and a lexical search (Postgres full-text) in parallel. Both are filtered to the KB's source IDs, plus any metadata filters and (later) ACL filters. Each returns 4 × top-k candidates (at least 20). The lexical query ORs the question's stemmed lexemes and ranks with `ts_rank` normalised by document length; it is skipped when the keyword weight is 0.
4. Merge the results with **weighted** reciprocal rank fusion: score = w<sub>v</sub>/(60 + vector rank) + w<sub>k</sub>/(60 + keyword rank). Ties break on the vector rank, then the keyword rank. Remove duplicates, and trim to the token budget.
5. A reranker stage is optional and not in v1. The model kind `rerank` is reserved for it; not every gateway offers one.

## 7. Agents (ADR-0009)

### 7.1 Definition
```
Agent (team-owned)
  id, team slug + agent slug, optional platform-assigned short name
  name, description, avatar, accent colour (contrast-checked), welcome message, starter questions
  status: active | disabled_by_team | disabled_by_platform
  draft config (editable)
  published_version → AgentVersion (immutable)
      instructions
      chat model + parameters
      KB references (1..n; may use different embedding profiles)
      retrieval mode: always | tool; per-KB top-k; token budget; pinned metadata filters (Phase 3)
      strictly_grounded (default true) + custom refusal message
      citation mode: none | snippet | snippet+link
      moderation: on | off (required on for public)
  audience grants (see 7.2)
  effective_rank (computed from the published version)
```

- **Drafts and versions.** Edits change the draft. **Publish** creates a new, immutable version, and users always talk to the latest published version.
- **Multiple KBs.** An agent can use several KBs. Each KB is searched with its own embedding profile, and the results are merged with RRF.
- **Retrieval modes.** `always` (the default) retrieves before every answer. `tool` exposes a `search_knowledge` tool and lets the model decide when to search. The tool layer is also where future agent tools will plug in.
- **Strict grounding.** When it is on, the agent answers only from the sources, never from general knowledge. If the sources answer part of a question, it answers that part with citations and says what isn't covered. It gives the team's custom refusal message only when the sources contain nothing relevant, or without calling the model when retrieval finds nothing at all. Greetings and small talk get a brief reply and an offer to help, not the refusal. When it is off, the agent may answer from general knowledge but must label that part as not from sources.
- **Retrieved text is treated as untrusted data.** It is clearly delimited in the prompt, and the model is told not to follow instructions inside it.
- **Moderation hook.** Input and output checks are built into the pipeline. They are required for `public` agents and optional for other audiences. Enabled in Phase 4 through pluggable providers ("Moderation", §7.5; ADR-0019), so each install uses what its gateway offers.

### 7.2 Audience
Audiences are stored as grants: `agent_audience_grants(agent_id, principal_type, principal_id)`. v1 allows **exactly one** grant per agent:

| Grant type | Who can use the agent | Allowed when (default policy) |
|---|---|---|
| `team` | Members of the owning team | Always |
| `all_authenticated` | Anyone who can sign in to the install (as its OIDC settings permit, e.g. `OIDC_ALLOWED_EMAIL_DOMAINS`), which may include students, affiliates and guests | Effective rank ≤ Sensitive |
| `public` | Anyone, no login | Effective rank = Open |

In the UI and elsewhere in this document, `authenticated` means the `all_authenticated` grant.

- **Publishing.** Editors can publish to `team`. Team admins and owners can publish to `authenticated` or `public`, without platform approval.
- **Platform controls.** A global switch that turns off all public agents, and a kill switch per agent.
- **Future grant types** can be added without redesign, using the stored OIDC claims: specific users, OIDC groups, affiliation (e.g. employees only), and other teams. The same rule applies to them: every grant must be allowed for the agent's effective rank.

### 7.3 The agent is the access grant
Consumers never get direct KB access. The query path checks one thing: **may this principal use this agent version?** It then retrieves from that version's KBs on the principal's behalf.

Consumers cannot list KBs or documents, and cannot download original files. Citations show a snippet plus, for web sources, the original public URL. Uploaded files are cited by title only.

### 7.4 URLs
- **Team-scoped:** `/a/{team-slug}/{agent-slug}`. For a public agent, signed-out visitors get the public page here too; other agents show the sign-in page.
- **Optional short name:** `/a/{short-name}`, assigned only by platform admins.
- **Stable ID URL:** `/a/id/{uuid}`. Used by widgets so renames never break them.
- **OpenAI-compatible model name:** `agent:{team-slug}/{agent-slug}`.

### 7.5 Guardrails for public agents
- **Rate limits** per IP address and per anonymous session. Each agent has a daily limit on queries and tokens, plus a concurrency limit.
- **Widget protection:** publishable agent key, allowed-origins (CORS) list, optional CAPTCHA.
- **Anonymous conversations** have short, configurable retention (default 24h) and no history across sessions.
- **Moderation** is required, and fails closed: if the provider is unavailable, public chat is refused. The `public` audience can't be selected until a moderation provider is configured. Public publishing and moderation both arrive in Phase 4.

**Moderation (ADR-0019).** One judgment interface answers yes/no, choice and score questions with probabilities. Moderation is a set of yes/no questions, one per policy category. Providers are catalog models of one of four kinds: an OpenAI-compatible `/moderations` endpoint, a guardrail model served as chat (Llama Guard, Granite Guardian, ShieldGemma), any chat model used as a classifier, or a System One judgment model. A moderation policy (categories, thresholds, and block, flag or warn for input and output) is set per audience, with agent overrides within platform limits; swapping the provider never changes what the policy means. Decisions and scores go to the content-free analytics and audit records, never the text. Each attempt of a check is bounded by the connection timeout and the model's own moderation timeout, else `MODERATION_TIMEOUT` (default 10 s; at least 30 s for chat classifiers); a timeout or transient failure is retried once, and a check that still fails reports "The safety check is unavailable right now. Please try again." (code `moderation_unavailable`). Scores from uncalibrated providers (chat classifiers, guardrails without log-probabilities) block only at or above the policy's uncalibrated block threshold (default 0.95) and flag below it. Admins see each decision's category and score in the moderation drill-down (`GET /v1/admin/analytics/moderation-events`). The same interface is planned for grounding checks, citation verification, reranking and prompt-injection detection.

**SystemOne models (ADR-0020, [`systemone.md`](systemone.md)).** An optional catalog kind, `systemone`, for services that answer typed questions over `POST /v1/systemone`. A SystemOne model can be a moderation policy's provider (with a severity threshold and a `support` action for self-harm) and can judge retrieved passages before the prompt is built: re-rank by relevance, keep conflicting passages in their own block, drop prompt injections and passages that don't help, and refuse without a model call when a strict agent has nothing left. After an answer it can check each citation against its source (annotate: verified / unsupported / contradicted marks; enforce: remove confidently unsupported citations, and refuse when a strict agent has none supported), and before retrieval it can spot small talk (answered without retrieval) and questions outside the agent's subject (a strict agent refuses without a model call). Every feature is off by default; with no SystemOne model, nothing changes.

### 7.6 Access paths
- **UI:** an agent directory for signed-in users, a chat page for each agent, and an embeddable widget. The widget is a small loader script that injects an **iframe** of the hosted chat page, which isolates host-site styles and scripts.
- **API:** `POST /v1/agents/{team}/{agent}/chat` (streams over SSE), and **OpenAI-compatible** `POST /v1/chat/completions`.
- **Branding:** the install's theme and identity settings across the platform ("Configuration and instance identity", §15). Per-agent customization is limited to name, avatar, contrast-checked accent colour, welcome message and starter questions. **There is no custom CSS**, to protect accessibility.

### 7.7 AI runtime: modelled on pi (ADR-0017)
The provider client, streaming protocol, agent loop and tools copy their shapes from [pi](https://github.com/earendil-works/pi): `packages/ai` (`pi-ai`) and `packages/agent` (`pi-agent-core`), reviewed at `49681e1`. We port the ideas to Go; we don't depend on pi.

- **One normalized message model** (`internal/llm`):
  - Messages are user, assistant and tool-result. Assistant content is a list of typed blocks: `text`, `thinking` and `toolCall` (id, name, JSON arguments).
  - Each assistant message carries `usage` (input, output, cache read/write, reasoning, total, cost) and a `stopReason`: `stop | length | toolUse | error | aborted`.
  - Provider quirks stay inside adapters and never reach callers.
- **Provider interface with streaming events.**
  - `Stream(ctx, model, context, opts)` returns a channel of events: `start`, `text_start/delta/end`, `thinking_start/delta/end`, `toolcall_start/delta/end`, then exactly one final `done` (with the reason) or `error`.
  - Every event carries the partial assistant message built so far, so consumers never have to reassemble state.
  - v1 has a single adapter for OpenAI-compatible chat completions (the gateway, §10). Its compatibility flags (developer vs system role, `reasoning_effort` support, and so on) follow pi's `OpenAICompletionsCompat`. Native adapters can be added behind the same interface later.
  - Cancellation uses `context.Context`, which becomes an `aborted` stop reason.
- **Agent loop** (`internal/agentloop`):
  - Lifecycle events: `agent_start/end`, `turn_start/end` (a turn is one assistant response plus its tool results), `message_start/update/end`, and `tool_execution_start/update/end`.
  - These events are the single source for the SSE chat stream, conversation persistence, usage events and analytics metadata.
  - The loop runs until the model stops calling tools or hits a per-agent turn limit.
- **Tools.**
  - A tool has a name, a label, a description, JSON Schema parameters, an `execute(ctx, callID, params, onUpdate)` function and an execution mode (`parallel` or `sequential`).
  - Arguments are validated against the schema before `execute` runs. An error from `execute` becomes an `isError` tool result sent back to the model. It never crashes the loop.
  - In v1, `search_knowledge` is the only tool (retrieval mode `tool`, §7.1). Retrieval mode `always` is the same loop with retrieval injected before the first turn.
  - A per-tool replay policy (`never | safe`, from pi's tool durability) is reserved for tools with side effects.

### 7.8 Web portals
The React app has two portals.

- **User portal** (`/`), for everyone:
  - agent directory and chat
  - the user's teams, and for builders: data sources, KBs, agents, members, invites, keys, usage and audit
- **Admin portal** (`/admin`), for platform admins and auditors:
  - users, teams, classification levels, limits
  - model connections, models, embedding profiles
  - crawl allowlist and domain requests, platform-shared sources
  - agents (metadata and kill switch), the access log, audit
  - later: break-glass, legal holds, moderation policy
  - Auditors see it read-only.
- **Switching.** Platform admins and auditors get a Workspace / Admin switch at the top of the sidebar. Workspace is the ordinary user experience (team switcher and team pages, no admin links); Admin shows only the platform pages. Each side remembers the last page visited in the browser tab. Switching doesn't change what they're allowed to do: the admin portal still gives no team content access (ADR-0011).
- **Command palette (⌘K / Ctrl+K).** Pages, "New …" actions, the user's teams and (for staff) admin pages are listed locally and filter instantly. What the user types (2 characters or more) is also searched on the server, `GET /v1/search?q=&limit=` (debounced about 180 ms; a newer query cancels the older request), and the matches are added in groups by type:
  - everyone: agents of their teams (the team's agent page) and agents they may chat with (the directory's rules: published and active, of an active team, and either their team's, open to signed-in users, or public while public access is on), the knowledge bases and data sources of **all** their teams, and **their own** conversations by title (never anyone else's; deleted ones are gone);
  - platform admins and auditors, in addition: teams, users, models, connections, embedding profiles and shared sources, which open their admin pages (`/admin/teams/{slug}`, `/admin/users/{id}`, `/admin/models?record=`, `/admin/connections?record=`, `/admin/embedding-profiles?record=`, `/admin/shared-sources/{id}`). Being staff adds no team content: another team's knowledge bases, sources and conversations are never returned (break-glass doesn't apply to search).
  - Matching is case-insensitive on the name (users: display name or email; models and profiles: name or key), ranked prefix, then the start of a word, then anywhere; then by type. `limit` defaults to 20 (at most 50). Results carry a secondary line (team name, email, key, agent name), the state when unusual (archived, suspended, disabled, retired, paused) and what the app needs to link. Search is session-only: API keys get 401 (a key belongs to one team and has its lists). Trigram indexes (migration `search_indexes`) serve the name matches. The authorization matrix searches for another team's marker as every caller.

## 8. Conversations and analytics (ADR-0010)

### Transcripts
- **Only the user who had the conversation can read its transcript.** This applies to team members too. Team admins and platform admins cannot read transcripts; the one exception is a platform admin under an active, audited break-glass session with the conversations scope on the agent's team (§3.6, ADR-0024).
- **Delete.** Users can delete their own conversations. The transcript disappears from their view immediately and is removed for good according to retention, unless a legal hold applies.
- **Export.** Users can export a conversation as Markdown or JSON, including citations.

### What teams see: aggregates and metadata only
Each message event records the following, **without message content**:
- agent and version, timestamp, latency, model, token counts
- retrieval hit count and top score, and a flag when no context was found
- IDs of cited documents
- feedback: thumbs up/down and a fixed reason category (no free text in v1)
- audience type

Teams never see who a user is. Unique-user counts use pseudonymous IDs.

**Dashboards:** conversations over time, satisfaction, how often no context was found, most-cited documents, and latency and tokens by model.

### Retention and legal hold
- **Every retention period is configurable. Nothing is hard-coded to delete.** This covers transcripts (per classification level), anonymous transcripts, metadata events, audit logs, the access log and deleted-content grace periods.
- **Legal hold.** Platform admins can place a hold on a user, team, agent or conversation. A hold pauses all deletion, including deletions requested by users and team purges.
- **Each install confirms its default periods with its records management and legal counsel before production.** Public institutions may be subject to public records law, under which transcripts can be records.
- **As built (Phase 5 P3; [`docs/operations/retention.md`](operations/retention.md)):**
  - **Periods.** Conversations follow their classification level (§4): signed-in conversations are kept until the user deletes them unless the level sets days; anonymous ones go after the level's hours (24 by default). Every other kind (conversations users deleted, the access log, analytics events, the usage ledger, the audit log, deleted documents' files, expired invites) has an environment default (`RETENTION_*_DAYS`) that a platform admin can override in Administration → Retention. All are empty by default, which keeps the data. Anonymous and browser sessions end at expiry.
  - **Jobs.** One River job every 10 minutes (and "Run now") applies a rule per kind in bounded batches, one transaction each, under a cross-worker lock. Each rule is one SQL query that selects what is due and whether a hold covers it; the same query serves the **dry-run report** (per team, level, audience and reason, in a read-only transaction) and the purge, so the report shows what the next run deletes. Runs are recorded with counts per kind, audited as the system (`retention.purge`, counts only) and exported as metrics.
  - **User deletes** hide a conversation from its user at once; the stored copy goes after the deleted-conversations grace period (or its level's period), unless a hold covers it.
  - **Usage** is rolled up per UTC day (`usage_daily`) in the same statement that deletes it, so analytics totals survive. **Deleted documents** leave search at once (rows, passages and vectors); their stored files wait in `deleted_files` for their own period.
  - **Legal holds** (Administration → Legal holds; platform admins place and release them, auditors read them, nobody else sees them) cover a user, team, agent or conversation, optionally for a date range of the data. Every rule skips what an active hold covers, including conversations their users deleted and deleted documents' files. Holds never expire; placing and releasing are audited without a team (`legal_hold.create`, `legal_hold.release`), and those entries are never purged.

### Access log
Every use of a Sensitive or Restricted agent is logged: who, which agent, and when. Platform auditors can see this log.

## 9. Storage (ADR-0003, ADR-0004)

| Store | Holds |
|---|---|
| **PostgreSQL 17** (system of record) | Users, teams, policy, sources, crawl state, documents, chunk text + metadata + `tsvector` (per embedding profile; a document has a second set during a profile migration, §10), KBs, agents, conversations, usage, audit, sessions, notifications, and the River job queue |
| **Vector store** (behind the `VectorStore` interface) | One collection/table per embedding profile. Maps chunk ID → vector, with payload: source ID, document ID, filterable metadata |
| **Object storage** (S3-compatible) | Original uploads, fetched web content, parsed Markdown |
| **Valkey** (HA, shared fast state) | Rate-limit token buckets, per-site crawl pacing, short-lived caches. **Never the source of truth for anything durable.** Budgets, usage and job state stay in Postgres (ADR-0015). |

```go
type VectorStore interface {
    EnsureProfile(ctx context.Context, p EmbeddingProfile) error
    Upsert(ctx context.Context, p EmbeddingProfile, recs []VectorRecord) error
    DeleteDocuments(ctx context.Context, p EmbeddingProfile, docIDs []uuid.UUID) error
    Search(ctx context.Context, p EmbeddingProfile, q []float32, f Filter, k int) ([]Hit, error) // Filter.SourceIDs required
}
```

- **v1 implementation: pgvector** (`halfvec`, HNSW index).
  - There is one table per embedding profile, because pgvector requires a fixed dimension per column.
  - Filtered queries rely on the iterative index scans added in pgvector 0.8.
  - HNSW indexes support at most 2,000 dims for `vector` and 4,000 for `halfvec`, so admins can only create profiles within those limits.
- **Search strategy.** The application picks the strategy, not the planner. KBs with up to `VECTOR_EXACT_THRESHOLD` vectors (default 100k) are searched **exactly**: perfect recall, about 0.3 ms per 1,000 real vectors (16 ms for 57.6k, so about 30 ms at the threshold, well under the ~200 ms query embedding call). Larger KBs use HNSW with iterative scanning and `ef_search` 400 (`VECTOR_EF_SEARCH`).
- **Benchmark gate: passed on real embeddings** (2026-09-26; [`docs/benchmarks/vector-gate.md`](benchmarks/vector-gate.md)). With 57.6k real `nomic-embed-text-v1.5` vectors in one KB, Grounded's filtered HNSW path reaches recall@10 0.997–0.998 at `ef_search` 400: alone in its table, among 500k rows of other sources, and among 500k near-duplicate rows. Qdrant is not needed on current evidence.
- **Plan for very large or heavily duplicated tables.** One stress case fails: a 1.56M-row table where the KB is 3.7% and every KB vector has ~26 near-duplicates in other sources (many teams crawling the same pages) reaches only 0.845 with m=16/ef_construction=64. Hash-partitioning the table by `source_id` fixes it (0.998, and the HNSW build fell from 18 min to 2.5 min); m=24/128 also fixes it but builds 2.8× slower. Before `emb_<profile>` tables reach millions of rows (Phase 2 crawling at scale):
  - move them to `PARTITION BY HASH (source_id)` (16 partitions to start) with an HNSW index per partition and no `source_id` btree, and query with a plain `source_id = ANY(...)` so the planner prunes partitions;
  - migrate per profile by building the partitioned table beside the old one and swapping (expand/contract, ADR-0013), sized so each partition's graph fits in `maintenance_work_mem`;
  - keep platform-shared sources as the answer to duplication (one shared copy instead of one per team);
  - re-measure on a real institutional corpus of ≥1M chunks on production-sized hardware.

## 10. Models and gateway (ADR-0005, ADR-0007)

- **Model connections.** Platform admins connect the platform to one or more **OpenAI-compatible API proxies**, such as LiteLLM, open-model-gateway, vLLM, or any service that speaks the OpenAI API. Gateways tested so far, and how they behave, are recorded in deployment profiles ([`deployments/`](deployments/README.md)).
  - A connection is a name, a base URL, an API key, a request timeout, an optional `requestsPerMinute` limit (§5.5) and `maxConcurrentRequests` (default 8; applied to SystemOne calls, per process).
  - The key is entered in the admin portal and **stored encrypted** (AES-256-GCM, with the key from `ENCRYPTION_KEY`; a previous key can be kept for rotation). The API never returns the key; the portal shows only that one is set.
  - The platform has no LiteLLM- or vendor-specific code. It uses only the OpenAI API surface: `/models`, `/embeddings` and `/chat/completions`, with `/rerank` and `/moderations` later.
  - **Test connection** calls `GET /models`. The response lists the proxy's model IDs to help the admin fill in forms. Nothing is added automatically.
- **Models are added by admins.** A model belongs to a connection and has:
  - the upstream model ID sent to the proxy, and a display name
  - a **kind**: `chat`, `embedding`, `rerank`, `moderation` or `systemone` (ADR-0020).
  - the **maximum classification** it may process. Which models may take Restricted data is the install's policy (commonly self-hosted models, or services under a data agreement); admins tag each model as it is added.
  - kind-specific capabilities:
    - chat: context window, maximum output tokens, tool calling, vision
    - embedding: dimensions, maximum input tokens
  - OpenAI-compatibility flags for proxy quirks (in the style of pi's `OpenAICompletionsCompat`, ADR-0017; the `compat` object of a model). Omitted flags use the default; a PATCH that sends `compat` replaces all of them.

    | Flag | Kind | Default | Effect |
    |---|---|---|---|
    | `supportsDeveloperRole` | chat | false | Send the system prompt with role `developer` instead of `system`. SGLang rejects `developer` (`400 Unexpected message role`): leave it false there. |
    | `supportsReasoningEffort` | chat | false | Send the agent's `reasoning_effort`. Unknown fields break some proxies. |
    | `supportsStreamUsage` | chat | true | Send `stream_options.include_usage` so the last chunk carries usage. |
    | `maxTokensField` | chat | `max_tokens` | The output-limit field: `max_tokens` or `max_completion_tokens`. |
    | `supportsToolChoice` | chat | false | Send `tool_choice` (e.g. `required`). Only for servers that honour it: SGLang with Qwen3 does (a `required` turn always calls a tool); vLLM serving gpt-oss accepts it but ignores it. |
    | `thinkingField` | chat | either | The streamed reasoning field, `reasoning_content` or `reasoning`; empty reads whichever is present. |
    | `extraBody` | chat, moderation | none | A JSON object (at most 4096 bytes) merged into every chat completion request for server extensions, e.g. `{"chat_template_kwargs": {"enable_thinking": false}}` to turn off Qwen3 thinking on SGLang or vLLM. It can't set the fields Grounded controls (`model`, `messages`, `stream`, `stream_options`, `tools`, `tool_choice`, `parallel_tool_calls`, `functions`, `function_call`, `n`, `user`, `max_tokens`, `max_completion_tokens`, `temperature`, `reasoning_effort`): they are rejected on save and skipped when sending. Used by agent chat, query rewriting, model tests and chat-based moderation. |
    | `supportsDimensionsParam` | embedding | false | For profiles with `outputDimensions`: send the OpenAI `dimensions` parameter. When false, Grounded truncates and L2-renormalises the vectors itself. |
  - **Stream handling that needs no flag.** Reasoning tokens are read from `usage.completion_tokens_details.reasoning_tokens` or, as SGLang reports them, the top-level `usage.reasoning_tokens`. A whitespace-only text delta never opens a text block (Qwen3 streams `"\n\n"` before its answer and before tool calls), and the first text of a message loses its leading whitespace; whitespace inside the answer is kept.
  - an enabled/disabled switch
- **Test model** sends a tiny real request: an embedding of a short string (and reports the actual number of dimensions), or a one-word chat completion.
- **Our own small client** (`internal/gateway`) talks to connections. It grows into the pi-style streaming layer in Phase 3.
- **Usage tagging.** Every gateway call is tagged with team, agent and user, so the gateway's spend reports match our usage ledger. Gateways don't all count embedding tokens the same way, so the ledger stores the gateway's figure with Grounded's own count beside it (§18 item 9).
- **Embedding profiles** define: an embedding model, dimensions, storage type, document and query prefixes, chunk size and overlap, chunker version, optional **output dimensions** and optional **default fusion weights**. Everything except name, description, status, the default flag and the default fusion weights is **immutable** after creation; a change means a new profile plus a migration.
  - **Output dimensions** (`outputDimensions`) store fewer dimensions than the model's native size, for Matryoshka models such as Qwen3-Embedding: at most the model's dimensions and within the storage type's index limit (halfvec ≤ 4000, vector ≤ 2000), so a model whose native size is above the limit becomes usable. The profile's vector column (`dimensions`) uses them. The model's `supportsDimensionsParam` decides whether the server shortens the vectors (`dimensions` parameter) or Grounded keeps the first dimensions and L2-renormalises them; both give the same vectors. `qwen3-embedding-4b` at 768 of 2560 dimensions lost no measurable quality (FiQA nDCG@10 0.767 against 0.770) and keeps nomic's storage and exact-search cost; from about 1000 dimensions every halfvec moves to TOAST ([`spark-models.md`](benchmarks/spark-models.md) §2.4).
  - **Default fusion weights** (`defaultFusionWeights`) apply to the profile's KBs that don't set their own (§6). They don't affect stored vectors, so they can change at any time.
  - Instruction-tuned embedders take their instruction as the query prefix, which may contain a newline (e.g. `Instruct: <task>\nQuery: `); see the recipe in [`deployments/`](deployments/README.md#self-hosted-models). One profile is the platform default. **Tested default:** `nomic-embed-text-v1.5`, 768 dims, `halfvec`, prefixes `search_document: ` / `search_query: ` (used in the benchmarks). A profile inherits its model's classification ceiling.
- **Changing embedding profiles.** A source can't switch profile in place. A platform admin creates a new profile and starts a migration (Admin → Profile migrations; runbook [`operations/profile-migration.md`](operations/profile-migration.md)):
  - The migration works **per KB**. A preflight shows the sources, documents, passages, tokens, embedding requests and the time at the target connection's request limit, and blocks a retired or disabled target, one whose model's classification ceiling is below the KB's, a dimension mismatch, or a second migration of the same KB.
  - Each source is re-embedded into the new profile in the background and **keeps its old vectors** while this happens. Chunks belong to a profile (`chunks.profile_id`): with the same passage settings the passages are copied, otherwise they're cut again from the stored parsed text; nothing is fetched or parsed again. The `embedding_set.sync` job goes through the shared batcher at background priority, works in bounded steps and resumes after a restart; failures are recorded per document and retried.
  - While migrating, the KB keeps querying the old profile (vector and keyword search), so it never mixes profiles. New documents are embedded for every profile their source has.
  - Once every source in the KB has new vectors, the KB switches to the new profile in one transaction. The old vectors are kept for a grace period (`PROFILE_MIGRATION_GRACE_DAYS`, default 7), during which the KB can switch back; a cleanup job deletes them afterwards.
  - A source's old vectors are deleted only after every KB that uses it has switched (and its grace period has ended). A source's own profile (`data_sources.embedding_profile_id`) moves once every KB using it has; until then its other profiles are extra *embedding sets*, and a KB may attach a source that has a ready set for its profile.
  - Maintenance mode is optional: it pauses new ingestion, not migrations.
- **When the gateway is unavailable,** chat and retrieval return a clear `model_unavailable` error. Admin screens, document management and queued ingestion keep working.

## 11. Limits and usage

### 11.1 Limits
This follows yoink's inheritance model:
- Each limit has a platform default and a ceiling, and a team may have an override.
- `null` means "inherit". `0` means "blocked".
- Admin writes use revision checks, so two admins can't overwrite each other.
- Team admins can see their limits but cannot change them.

Initial limits:
- **Team resources:** storage bytes, document count, data source count, KB count, agent count.
- **Ingestion:** crawl pages per day, concurrent crawls, concurrent ingestion jobs.
- **Queries:** per minute and per day, set separately for the team, each user, each API key and each agent.
- **Public agents:** tokens per day, requests per IP.

**Implemented (Phases 1–2).** Keys are defined once in `internal/limits` (registry.go); values live in `platform_limits` (one row: `{key: {default, ceiling}}`) and `team_limits` (per-team overrides), each with a revision for If-Match. A key the platform admin never set uses its built-in default. Effective = override ?? default, capped by the ceiling (lowering a ceiling also caps existing overrides; a *new* override above the ceiling is rejected with 400 `above_ceiling`).

| Key | Built-in default | Enforced |
|---|---|---|
| `storage_bytes` (sum of original document sizes) | 10 GiB | upload and crawled page → 409 `limit_reached`; a crawl stops, truncated (`storage_limit`) |
| `documents` | 50,000 | same (`documents_limit`) |
| `data_sources` | 100 | source creation → 409 |
| `knowledge_bases` | 50 | KB creation → 409 |
| `crawl_pages_per_day` (UTC day, `page_crawled` ledger events) | 5,000 | the crawl waits until the next UTC day (`waitingReason: daily_page_limit`); not failed |
| `concurrent_crawls` | 2 | further runs stay queued (`waitingReason: concurrent_crawls`) until a slot frees; manual, created and scheduled runs alike |
| `concurrent_ingest_jobs` | `INGEST_MAX_INFLIGHT_PER_TEAM` (8) | the ingestion dispatcher's per-team in-flight cap |
| `queries_per_minute` (team) | 600 | `/retrieve`, Valkey → 429 `rate_limited` + Retry-After |
| `queries_per_day` (team, `query` ledger events) | 50,000 | `/retrieve`, Postgres → 429 until midnight UTC |
| `api_key_queries_per_minute` (each key) | 300 | `/retrieve` with an API key |
| `user_queries_per_minute` (each person) | 120 | `/retrieve` in a browser session |
| `agents` (live agents) | 25 | agent creation → 409 `limit_reached` |
| `chat_tokens_per_day` (team, `chat_tokens_in` + `chat_tokens_out` ledger events) | 2,000,000 | chat → 429 `quota_exceeded` until midnight UTC |
| `concurrent_chats_per_user` (each person, or service key) | 3 | chat → 429 `rate_limited`; Valkey counter with a TTL, fails open |

Chat answers also count towards the four query limits above (one `query` event per answer; Phase 3).

Resource caps are checked inside the creating transaction under a per-team advisory lock. 409 and 429 responses carry `details: {limit, max, current}`. A value of 0 blocks: creation is refused, crawls cannot start. Every retrieve (including one on an empty KB) writes one `query` usage event. Platform-shared sources belong to no team and count against nothing. API: `GET/PUT /v1/admin/limits` (defaults and ceilings), `GET/PUT /v1/admin/teams/{team}/limits` (overrides), `GET /v1/teams/{team}/limits` (effective limits and usage, for members); changes are audited as `limits.platform_update` and `limits.team_update`.

**Where limits are enforced:**
- Per-minute rate limits are Valkey counters. When Valkey is down, authenticated traffic fails open and anonymous or public traffic fails closed.
- Daily and total caps (tokens per day, pages per day, storage) are checked against **Postgres**. The source of truth is the usage ledger, so a Valkey outage can never reset or bypass them.
- **Per source type:** maximum file size (default 100 MB) and allowed MIME types.

### 11.2 Usage ledger
`usage_events` is append-only. Each event records its kind (`embed_tokens`, `chat_tokens_in/out`, `query`, `page_crawled`, `document_parsed`, `storage_bytes`), the quantity, model, team, user, agent, KB, source, API key and timestamp. Events are rolled up daily. Prometheus metrics feed Grafana/Mimir.

## 12. Notifications

- **Channels:** in-app notifications (a bell and inbox) plus email through an SMTP relay that the operator provides.
- **Always delivered, cannot be turned off:**
  - invites (the email is how someone joins)
  - source classification lowered
  - agent disabled by the platform
  - break-glass started, and ended with a summary of what was read (to the team's owners, §3.6)
- **Can be turned off, per event and channel:**
  - invites about to expire
  - added to a team or role changed
  - domain-request decisions
  - web sync failures
  - agent published to authenticated or public
  - team daily limit reached
- Events are recorded in the same transaction as the change. Email goes out after commit through a retried job. Details are in [`phase4-publishing.md`](phase4-publishing.md) §8.
- **Later:** webhooks, for example to post to a Teams or Slack channel.

## 13. Audit

`audit_log` is append-only. It records:
- actions by platform admins and team admins
- membership and role changes, and invites
- API key creation and revocation
- classification changes, including reasons
- audience changes, publishes and kill switches
- domain allowlist changes and domain approvals
- limit changes (platform defaults and ceilings, team overrides)
- document uploads (one entry per request: the document, or the source with counts) and deletions, in team and shared sources
- break-glass start, approval or denial, every read under it (session ID, kind, target; never content), and its end, revocation or expiry, in the platform log and the team's log
- legal holds and purges (retention runs are recorded as the system with counts only)

Configuration changes store before and after values. Platform auditors can see everything. Team admins see their own team's entries.

The audit log has its own retention period (§8), unset by default. Its append-only trigger allows deletes only inside the retention job's transaction, and entries about legal holds are always kept.

Reading the log resolves who acted (person, email, API key name) and the target's current name; a deleted target shows the last name the log recorded for it. Both logs filter by action (exact, or a group prefix such as `agent.`), person, target type and time window.

## 14. API surface (sketch)

The same `/v1` routes serve browser sessions and API keys; the credential determines what is allowed. `/healthz`, `/readyz` and `/metrics` sit outside `/v1`.

Conventions, following yoink:
- Success responses look like `{ "data": ... }`. Errors look like `{ "error": { "code", "message" } }`.
- Admin writes need a revision precondition. A missing revision returns 428, and a stale one returns 412.

```
Auth / me      GET /v1/me   GET /v1/auth/config (sign-in methods and instance identity, no login needed)
               /auth/login  /auth/callback  /auth/logout
Admin          /v1/admin/{users,teams,policy,classifications,connections,models,embedding-profiles,
                          source-types,crawl-allowlist,domain-requests,shared-sources,agents,
                          short-names,break-glass,legal-holds,audit,access-log,usage,jobs}
Team           /v1/teams/{team}/{members,invites,api-keys,usage,audit,analytics,domain-requests}
Data sources   /v1/teams/{team}/sources            (CRUD; later POST /{id}/sync for web sources)
               /v1/teams/{team}/sources/{id}/documents   (GET list, POST multipart upload; API key with ingest scope)
               /v1/teams/{team}/sources/{id}/documents/{docId}   (GET, DELETE, POST /retry)
               POST /v1/teams/{team}/web/map        (URL discovery preview)
KBs            /v1/teams/{team}/kbs                (CRUD, PUT/DELETE /{id}/sources/{sourceId})
               POST /v1/teams/{team}/kbs/{id}/retrieve   (session, or API key with query scope)
Agents         /v1/teams/{team}/agents             (draft CRUD, POST /{id}/publish, /versions, /audience)
               GET  /v1/agents                      (directory of agents visible to the caller)
               POST /v1/agents/{team}/{agent}/chat  (SSE)
               GET/DELETE /v1/conversations[/{id}]  (caller's own only), GET /{id}/export
               POST /v1/messages/{id}/feedback
Search         GET  /v1/search?q=&limit=            (⌘K: objects the caller may see, by name; session only)
Notifications  GET /v1/notifications, PATCH /v1/notifications/{id}, PUT /v1/me/notification-settings
OpenAI compat  POST /v1/chat/completions  (model = "agent:{team}/{agent}")   GET /v1/models
```

## 15. Architecture, deployment and operations (ADR-0001, ADR-0013, ADR-0014)

```
                    Browser (React SPA, embedded)      API clients      Public widget
                                   │                        │                 │
                               ┌───▼────────────────────────▼─────────────────▼───┐
 OIDC IdP ◄──────────────────► │  api ×3+  (auth, admin, CRUD, retrieval, chat)   │
                               └───┬───────────────┬─────────────────┬────────────┘
                    ┌──────────────▼──┐   ┌────────▼───────┐   ┌─────▼─────────────┐
                    │ PostgreSQL (HA) │   │ Vector store   │   │ Model gateway     │
                    │ + River queue   │   │ (pgvector →    │   │ (LiteLLM / OMG)   │
                    └──────────────▲──┘   │  Qdrant?)      │   └─────▲─────────────┘
                                   │      └────────▲───────┘         │
                               ┌───┴───────────────┴─────────────────┴──┐
       public web ◄── crawler ─┤ worker ×2+ (sync, crawl, fetch, parse,  │──► Apache Tika (optional)
                               │   chunk, embed, index, retention, usage)│──► SMTP relay
                               └───────────────────┬────────────────────┘
                                                   ▼
                          S3-compatible object storage      Valkey (HA): rate limits, crawl pacing
```

### Application
- **One Go binary, `grounded`**, with subcommands: `serve` (API and worker together), `api`, `worker`, `migrate`, `parse`, `doctor` and `version`. `grounded doctor` checks the configuration and every dependency (Postgres, Valkey, object storage, the OIDC issuer, each model connection) with timings, and exits non-zero on a failure ([`deployments/kubernetes.md`](deployments/kubernetes.md#grounded-doctor)).
- **The web UI** (React 19, Vite, TypeScript, TanStack Router + Query, and the bitop-ui component registry installed into `web/src/components/ui`: Base UI primitives styled with CSS Modules and CSS-variable design tokens, with a modern SaaS look; ADR-0016, [`web/README.md`](../web/README.md)) is embedded in the binary, as in yoink. An OpenAPI spec (3.0.3 until oapi-codegen and kin-openapi fully support 3.1) is written first; `oapi-codegen` generates the Go server interfaces and `openapi-typescript` generates the client types (ADR-0016).
- **Accessibility:** WCAG 2.1 AA throughout, checked automatically in CI with axe (vitest-axe and @axe-core/playwright).
- **Libraries:** `net/http` (Go 1.22+ routing), `pgx` + `sqlc` + `goose`, River, `pgvector-go`, `redis/go-redis/v9` (Valkey), our own OpenAI-compatible client (`internal/gateway`, ADR-0017), `go-oidc`, `aws-sdk-go-v2/s3`, `goquery`, `temoto/robotstxt`, `prometheus/client_golang`.

### Configuration and instance identity (ADR-0018)
Settings come from environment variables, optionally layered over a flat YAML file named by `GROUNDED_CONFIG_FILE` (see [`.env.example`](../.env.example) and `internal/config`). Nothing in code, migrations or default configuration names an institution, gateway vendor or jurisdiction. Each install supplies its identity:

| Setting | Purpose | Default |
|---|---|---|
| `INSTANCE_NAME` | Product name shown in the UI | `Grounded` |
| `ORG_NAME` | Organisation name, used in the UI and the agent preamble | empty (no organisation named) |
| `UI_THEME` | bitop-ui theme. `neutral` is the only theme; the setting is kept for future generic themes | `neutral` |
| `UI_LOGO_URL` | Logo shown in the UI: an https URL or a same-origin path such as `/logo.svg` | none |
| `SUPPORT_URL` | Where users get help: an http(s) URL or a `mailto:` address | none |
| `TEAM_REQUEST_URL` | Where people request a team (§3.2) | none |
| `CRAWL_ALLOWLIST_SEED` | Comma-separated host patterns added to the crawl allowlist **once**, on the first start that has a seed; later starts do nothing, even if the patterns were deleted (audited as system actions; §5.3). Later changes are made in the admin portal. | empty: nothing can be crawled until an admin adds patterns |

- `GET /v1/auth/config` returns the identity as `instance`, so the UI can show it before sign-in.
- The default classification descriptions are neutral; admins edit them to state their own policy (§4).
- Sign-in uses the generic `OIDC_*` settings (§3.1), for example `OIDC_ALLOWED_EMAIL_DOMAINS` to limit who can sign in.
- **Migrations create structure, not deployment data.** Starting data belongs to first-run configuration.
- A [deployment profile](deployments/README.md) records an install's recommended values and policies; each install keeps its own outside this repository (ADR-0023). [`deploy/examples/example.env`](../deploy/examples/example.env) is a neutral example environment file.

### Availability target: 99.9%
- **Replicas:**
  - `api`: at least 3, spread across nodes (anti-affinity), with PodDisruptionBudgets.
  - `worker`: at least 2. It can be split by queue later.
  - Valkey: HA, either a primary with replicas and Sentinel, or an operator.
- **Scheduling (as built):** the Kubernetes base spreads API replicas over nodes with a hard topology spread constraint (`DoNotSchedule`, `maxSkew: 1`), workers with a soft one, and both PodDisruptionBudgets allow one pod down at a time. `grounded-config` is generated with a content hash, so a configuration change rolls the pods.
- **Postgres:** CloudNativePG (unless the operator has a managed service) with 1 primary and 2 replicas and tested automatic failover.
- **Zero-downtime upgrades:**
  - **Migrations follow expand/contract.** Each release's schema works with both the previous and the new code, and destructive steps ship one release later. This deliberately differs from yoink, which stops all processes to migrate.
  - Migrations are embedded in the binary and run under an advisory lock.
  - On shutdown, a pod stops accepting work and lets in-flight SSE chats finish. Jobs are safe to interrupt and resume.
- **Maintenance mode** pauses new ingestion while queries keep working. Used for profile migrations and risky changes.
- **Our SLO is limited by our dependencies:** the gateway, OIDC provider and SMTP relay.

### Backups and disaster recovery
- **What's backed up:** Postgres (which, with pgvector, also holds the vectors), object storage, and the vector store if it becomes separate.
- **Targets:** Postgres RPO 15 min (continuous WAL archiving); object storage RPO 24h; RTO 4h.
- **Where:** a separate S3-compatible target, not the primary storage.
- **Restores are rehearsed on a schedule.** The runbook is [`operations/restore.md`](operations/restore.md); `make k8s-restore-rehearsal` runs it on a throwaway cluster (46 s for a small install). `components/backup-objects` copies the bucket off-site daily.

### Delivery
Following yoink's pipeline:
- **CI (GitHub Actions):** `gofmt`, `go vet`, `go test -race` against real Postgres, frontend tests and accessibility checks, then the build.
- **Images** are published to GHCR and **deployed by digest, never by `latest`**.
- **Manifests:** Kustomize, with a `base` plus `staging` and `prod` overlays.
- **Environments:** local compose for development; staging and prod on the operator's Kubernetes.
- **Secrets:** ExternalSecrets, using the backend the cluster provides, or Vault/OpenBao if none. The app reads only env vars and mounted files. Secrets never appear in the UI or logs, and rotation is documented.
- **Cluster hardening:** namespace NetworkPolicies and the restricted Pod Security profile.

### Observability and on-call
- **Logs:** JSON `slog` output to Loki.
- **Metrics:** Prometheus to Mimir.
- **Tracing:** OpenTelemetry, optional.
- **SLOs and error budgets** cover: availability and p95 latency of chat and retrieve, ingestion freshness, and error rate by dependency.
- **Dashboards shipped with the app:** ingestion backlog, gateway latency and errors, retrieval latency, usage.
- **On-call:** the operating team, 24/7 for a 99.9% target, alerted through Grafana alerting (the destination is per install).

## 16. Security and compliance

- **Security review.** Installs holding Sensitive or Restricted data should expect an institutional security review, recorded in the install's deployment profile. To support it, [`docs/security/`](security/README.md) holds a data-flow diagram, the list of controls with their tests (including the route × role × foreign-team authorization matrix), the dependency inventory and scan results, and a threat model. How to report vulnerabilities: [`SECURITY.md`](../SECURITY.md).
- **Data handling:**
  - Data the install prohibits (for example PHI) is excluded by its terms of use; the product doesn't detect it (§4).
  - Classification rules are enforced at write time and again at query time (§4).
  - Admins have no content access by default. Break-glass (§3.6) is time-limited, read-only, optionally approved by a second admin, audited per read, and announced to the team's owners.
  - Only the conversation's owner can read a transcript, except under break-glass with the conversations scope.
  - Every retention period is configurable, nothing is deleted until one is set, and legal holds stop every retention deletion of what they cover ([`docs/operations/retention.md`](operations/retention.md)).
- **Specific threats and controls:**
  - SSRF-safe crawler that always blocks private address ranges.
  - Retrieved text treated as untrusted to resist prompt injection.
  - Public agents have rate limits, publishable keys, origin checks and moderation.
  - API key secrets are stored only as peppered hashes.
  - `ENCRYPTION_KEY` and `API_KEY_PEPPER` can be rotated without downtime: `grounded rotate-keys` re-encrypts stored secrets, and API keys are re-hashed on their next use ([`docs/operations/rotate-keys.md`](operations/rotate-keys.md)).
  - Browser sessions use CSRF tokens and Origin checks.
- **Production safety checks (as built, Phase 5 E7):** unless `APP_URL` is a loopback address, every process refuses to start with the example `ENCRYPTION_KEY` or `API_KEY_PEPPER` from `.env.example` (only SHA-256 hashes of them are compiled in; they stay allowed as the `*_PREVIOUS` keys, so an install can rotate off them), with `DEV_AUTH` on, or with a plain-http `APP_URL`. Settings that are allowed but risky (an empty crawl allowlist, public agents without moderation, no SMTP, OIDC without a domain restriction) are logged at startup, shown to platform admins on the Overview and printed by `grounded doctor`.
- **Diagnosable connections (E12):** failed calls to model gateways name the cause (untrusted or wrong-host certificate, TLS handshake, proxy, refused or reset connection, DNS, or a timeout with the phase it happened in), and connection and model tests report DNS, connect, TLS and first-byte timings.
- **Accessibility:** WCAG 2.1 AA, the bar many public institutions must meet (in the US, ADA Title II).

## 17. Decisions from the design review (2026-09-24)

**Historical record.** This is the outcome of the first design review, held for the first (university) deployment before the project became institution-neutral (ADR-0018). The table is kept as it was agreed, with the institution's name removed (ADR-0023); later decisions are ADRs. Rows that state that institution's policy rather than product behaviour are now settings of its install, recorded in its own deployment profile: 1 (service-desk form), 5 and 15 (models for Restricted data, PHI), 13 (who counts as `authenticated`), 16 (retention sign-off), 17 (security review), 30 (branding), 35 (secrets backend) and 38 (operating team). The product's equivalents are in §3.2, §4, §7.2, §8, §15 and §16.

| # | Topic | Decision |
|---|---|---|
| 1 | Team creation | Platform admins only. v1 links to a service-desk request form; an in-app request form comes later |
| 2 | Personal spaces | None |
| 3 | Shared sources | Platform admins can publish sources that any team can use |
| 4 | Break-glass | Yes. Time-limited, requires a reason, audited, owners notified. Transcripts excluded |
| 5 | Model classification | Restricted data uses institution-hosted models only. Admins tag each new model |
| 6 | Gateway | Admins connect any OpenAI-compatible proxy and add models (chat, embedding, …) by hand; keys stored encrypted |
| 7 | OCR | Not in v1 |
| 8 | Agents | Team-owned, versioned, with audience `team` / `authenticated` / `public` (public requires Open data) |
| 9 | Sensitive data + `authenticated` | Allowed (default maximum audience per level: Open→public, Sensitive→authenticated, Restricted→team) |
| 10 | Consumer transcripts | Teams see aggregates and metadata only |
| 11 | Publishing public agents | The team decides; no platform approval |
| 12 | Audience scope | Team or all authenticated users for now, designed to extend later |
| 13 | Who counts as `authenticated` | Any sign-in through the institution's identity provider. Claims are stored so restrictions can be added later |
| 14 | Document ACLs | Not in v1, but schema and retrieval hook reserved |
| 15 | PHI | Prohibited in v1 |
| 16 | Retention | Everything configurable, legal hold, defaults confirmed with Records Management and General Counsel |
| 17 | Security review | Plan for the institution's security risk assessment; keep `docs/security/` current |
| 18 | Lowering a classification | Team admin with a written reason; owners notified; audited |
| 19 | API keys | Personal keys plus team service keys |
| 20 | Adding members | By email, as pending invites that expire after 30 days |
| 21 | Crawling authenticated sites | Public sites only in v1; config leaves room for more |
| 22 | yoink | Port its code (crawl, scrape, batch, map) into this app, with no JS rendering |
| 23 | Crawl scope | Admin wildcard allowlist (`*` allowed) plus per-team domain requests; SSRF protection always on |
| 24 | File types | PDF, DOCX, PPTX, HTML, MD, TXT. Size limit per type, default 100 MB |
| 25 | Metadata filters | Stored now, filters in Phase 3, model-chosen filters later |
| 26 | PII scanning | Pipeline hook in v1, then pattern scanning, then model-based detection |
| 27 | No context found | Per-agent "strictly grounded" setting, on by default, with a custom refusal message |
| 28 | Agent URLs | Team-scoped, optional admin-assigned short names, stable ID URL |
| 29 | Moderation | Hook built now; required for public agents from Phase 4 |
| 30 | Accessibility and branding | WCAG 2.1 AA; institution branding with limited per-agent customization |
| 31 | Conversation delete/export | Users can do both; deletion respects legal hold |
| 32 | Load | Planning estimates (§1); load-test at 2× |
| 33 | Environments and CI | Compose, staging and prod; GitHub Actions; GHCR by digest; Kustomize |
| 34 | Backups and DR | Everything backed up; RPO 15 min / 24h; RTO 4h; restores rehearsed |
| 35 | Secrets | ExternalSecrets with the institution's backend, or Vault/OpenBao |
| 36 | Notifications | In-app plus SMTP email; webhooks later |
| 37 | Availability | 99.9%, expand/contract migrations, HA everywhere |
| 38 | Operations | My team, 24/7 on-call |
| 39 | Shared fast state | Valkey (HA) from v1; Postgres stays the source of truth |
| 40 | Parser | Built-in Go parsers (PDFium via WebAssembly for PDF); Apache Tika optional as a fallback |
| 41 | Frontend | React 19 + Vite + TS, TanStack Router and Query, OpenAPI-first types; own component library (Base UI + CSS Modules + CSS variables, modern SaaS look, not stock shadcn) |
| 43 | Portals | A user portal and an admin portal, with a switcher for platform admins and auditors |
| 44 | Deployment timing | Kubernetes and deployment work waits until the application works end to end |
| 42 | AI runtime | Provider client, streaming events, agent loop and tools modelled on pi (`pi-ai`, `pi-agent-core`) |

## 18. Open items

Item numbers are stable because ADRs refer to them. Questions that only one install can answer (its hosting, its gateway, its legal sign-off) live in its own deployment profile, outside this repository.

1. **Parser throughput.** Measure the built-in parsers against a backfill of about 1 document per second, and size `PDF_WORKERS` (each PDFium instance uses tens of MB of memory).
2. ~~**Vector store at scale.**~~ Resolved 2026-09-26: the gate passed on real embeddings (§9). What remains is the partitioning plan for very large or heavily duplicated tables (§9), and a re-measure on a real corpus of ≥1M chunks on production-sized hardware (Phase 5).
3. **Valkey deployment.** Sentinel or an operator, or a managed Redis/Valkey service where the operator has one. Decided per install; the Kubernetes manifests (Phase 5) should support at least Sentinel.
4. **Hosting details per install.** Managed Postgres or CloudNativePG; which S3-compatible storage for primary data and backups; ingress and TLS; the ExternalSecrets backend; the SMTP relay; where on-call alerts go; any required GitHub org, registry or GitOps tool. A deployment profile records the answers. The generic manifests must not assume any of them.
5. ~~**Break-glass approval.**~~ Decided 2026-09-27: a platform setting, off by default (one admin with a written reason); an install can require a second admin's approval (§3.6, ADR-0024).
6. **Retention defaults.** Every period is configurable and nothing is hard-coded to delete (§8). Each install confirms the periods it runs with with its records management and legal counsel before production.
7. **Model capacity.** Measure the gateway's throughput for the chosen chat and embedding models before a backfill. Per-document embedding requests capped ingestion at the key's requests per minute; cross-document batching removes that cap (§5.5, [`scale-10k.md`](benchmarks/scale-10k.md)).
8. **Name.** Decided 2026-09-27: the product is **Grounded** (module `github.com/ncecere/grounded`, binary `grounded`, default `INSTANCE_NAME` `Grounded`), renamed from the working names "Open RAG System" and `ragd` ([ADR-0022](adr/0022-name-grounded.md)).
9. **Gateway token counts.** Gateways may report embedding `prompt_tokens` differently from a tokenizer; one tested gateway reports characters, about 4.7× Grounded's count for English text ([`scale-10k.md`](benchmarks/scale-10k.md) §4). The ledger records the gateway's figure, since that is what the gateway bills in, with Grounded's count beside it (`countedTokens`). Compare the two on each new gateway before using embedding tokens for budgets.
10. **Moderation provider per install** (ADR-0019). Which provider kind each install uses, and the evaluation set per category used to compare them and set thresholds. Decided before Phase 4 ships public agents.

## 19. Roadmap

| Phase | Status | Scope | Exit criteria |
|---|---|---|---|
| **0 Foundation** | Done | Repo, config, migrations, CI, image; OIDC + dev login, sessions, audit; users, teams, members, invites; platform admin API (users, teams, classifications, model connections, models, embedding profiles); **user portal and admin portal** | A platform admin connects a proxy, adds models, defines an embedding profile and creates a team; team owners manage members in the user portal |
| **1 Ingest + retrieve** | Done | `upload` source type, built-in parsing (optional Tika), chunker, embedding, pgvector store, KBs, `/retrieve`, API keys, limits, usage ledger, S3 storage | 10k documents uploaded and retrievable with citations ([`scale-10k.md`](benchmarks/scale-10k.md)); **vector benchmark gate** passed ([`vector-gate.md`](benchmarks/vector-gate.md)) |
| **2 Web + shared sources** | Done | Native `web` source (scrape/batch/crawl/map ported from yoink), allowlist + domain requests, scheduled re-sync, tombstones, platform-shared sources, classification impact checks ([`phase2-web-sources.md`](phase2-web-sources.md)) | A public institutional site crawled into a KB; a shared source used by two teams |
| **3 Agents (team)** | Done | Agents, drafts/versions, chat over SSE with citations, `always`/`tool` retrieval, strict grounding, conversations (delete/export), feedback, metadata filters, OpenAI-compatible endpoint, team analytics without content, access log, platform kill switch ([`phase3-agents.md`](phase3-agents.md), including deviations) | A team member chats with a team agent through the UI and the API |
| **Open-source readiness** | In progress | ADR-0018: instance identity settings, neutral defaults and seed data, neutral UI text and API examples, a deployment profile template, community files (CONTRIBUTING, SECURITY, CODE_OF_CONDUCT), the name (§18 item 8) | A fresh install names no institution; the repository holds no institution-specific data (ADR-0023); an install runs from its own profile alone; the repository can be made public |
| **4 Publishing** | Done ([`phase4-publishing.md`](phase4-publishing.md)) | `authenticated` + `public` audiences, pluggable moderation and judgment providers (ADR-0019), short names, iframe widget + publishable keys, public guardrails, analytics dashboards, notifications (in-app + SMTP) | A public agent embedded on a test page with rate limits and moderation enforced |
| **5 Deploy + harden** | Planned | Kubernetes (Kustomize base + overlays, HA topology), break-glass, retention + legal hold jobs, profile migration tooling, maintenance mode, SLO dashboards and alerts, restore rehearsal, load tests at 2× estimates, security review package | Meets the 99.9% target and load targets; runbooks written |
| **Later** | — | OCR, PII scanning, more source types and file types, authenticated crawling, rerankers and other judgments (grounding and citation checks, injection detection; ADR-0019), restricted audiences (groups/affiliation), document ACLs, model-chosen filters, webhooks, in-app team requests, more retrieval evaluation sets | — |
