# Roadmap candidates

Status: refreshed 2026-10-04. **v0.4.2 is released** (2026-10-04) and running on the reference install: ready for a wider beta. Releases so far: v0.1.0 (2026-09-28), v0.2.0–v0.2.2 (2026-09-29/30), v0.3.0 and v0.3.1 (2026-09-30), v0.4.0 and v0.4.1 (2026-10-02), v0.4.2 (2026-10-04); each has a "Done in" section below and notes under [`releases/`](releases/). Grounded stays one MIT project named Grounded (ADR-0025 rejected). **Next:** the beta, measuring v0.4 with real use (reranking on and off, latency per step from traces), then v0.5.0 "better knowledge in" (§ L, the release plan).

**How to read this:**
- Each item has an ID so you can pick by number. IDs are stable: finished items keep theirs and are marked **Done**.
- **Size:** S = a day or two, M = about a week, L = several weeks.
- **Value** is my estimate of impact for teams and admins.
- **Depends on** lists what must exist first.
- ★ marks the items I'd recommend first in each section.
- **New** marks items added in the 2026-09-29 refresh: from the v0.2 walkthrough by role, the UX and answer review before rc.1 ([`ui-review/v0.2-review.md`](ui-review/v0.2-review.md)) and running the release.

---

## Done in v0.1.0 (Phase 5)

| ID | Item | Where |
|---|---|---|
| P1 | **Kubernetes.** The generic Kustomize base covers:<br>• the api and worker, with migrations in an init container<br>• probes, PDBs, and API pods required on different nodes<br>• restricted pods and default-deny NetworkPolicies<br>• a content-hashed ConfigMap, so config changes roll the pods<br><br>Components: single Postgres, CloudNativePG, Valkey, `pg_dump` backups, off-site object backups, Ingress, Tika, monitoring, alerts and dashboards.<br><br>There are two example overlays, and `make vendor-k8s` for private consumers. It runs at the reference install. | [`deployments/kubernetes.md`](deployments/kubernetes.md) |
| P2 | **Profile migration:** re-embed a KB into a new embedding profile in the background, switch atomically, and switch back within a grace period. | [`operations/profile-migration.md`](operations/profile-migration.md) |
| P3 | **Retention jobs and legal holds:** a rule per data kind, nothing deleted by default, dry-run reports, and holds that stop every deletion. | [`operations/retention.md`](operations/retention.md) |
| P4 | **Break-glass:** time-boxed, audited reads of team content. Second-admin approval is a platform setting, and owners are notified. | [ADR-0024](adr/0024-break-glass-scope-and-approval.md), [`operations/break-glass.md`](operations/break-glass.md) |
| P5 | **Maintenance mode:** ingestion pauses and parked work resumes afterwards, while chat and reads keep working. | [`phase5-deploy.md`](phase5-deploy.md) §5 |
| P6 | **Metrics, 5 Grafana dashboards and 23 alerts** with runbooks, all validated in CI. `/metrics` is served on an internal listener. | [`operations/monitoring.md`](operations/monitoring.md), [`operations/alerts.md`](operations/alerts.md) |
| P7 | **k6 load tests** at 2× sizing on a throwaway kind cluster, and a timed **restore rehearsal**: destroy Postgres and the bucket, restore, verify. | `docs/benchmarks/load.md` and `docs/operations/restore.md`, merging with the last Phase 5 branch |
| P8 | **Security package:** data flow, controls, STRIDE threat model, dependencies and licences, scan results.<br><br>An **authorization matrix** checks every API operation, as 12 kinds of caller, against another team's resources. It found and fixed a real bug: personal API keys could reach every conversation their user had. | [`security/`](security/README.md) |
| E7 | **Production safety checks:** refuse to start with the example keys, `DEV_AUTH` or a non-https `APP_URL`; warnings on the admin Overview; **`grounded doctor`**. | [`deployments/kubernetes.md`](deployments/kubernetes.md) |
| E10 | **Key rotation:** `grounded rotate-keys` with `*_PREVIOUS` keys, resumable and audited. API keys are re-hashed with the new pepper the next time they're used. | [`operations/rotate-keys.md`](operations/rotate-keys.md) |
| E12 | **Clearer connection errors:** each failure names its cause (certificate, TLS, proxy, DNS, refused, or a timeout and its phase). Connection tests and `doctor` show DNS, connect, TLS and first-byte timings, which pinned down a slow DNS server at the reference install. | — |
| F6 | **Demo mode:** `grounded demo`, a built-in fake model, and `compose.demo.yaml` / `make demo`. | [`demo.md`](demo.md) |
| F7 | **Flaky timing tests** (crawl pacing, waits in CI) made robust. | — |
| — | **Tests in CI:** the Playwright end-to-end suite with axe on every page, the kind smoke test, a coverage report, and an upgrade test in which both the previous image and the new one must serve the migrated database. | [`phase5-deploy.md`](phase5-deploy.md) §5 |
| — | **Release automation:** a `v*` tag builds, scans and signs the image and creates the GitHub Release; `-rc` tags become pre-releases. The README, changelog and release notes are written. | [`releases/v0.1.0.md`](releases/v0.1.0.md) |
| — | **Fixes found on the reference install:**<br>• citation markers inside code (`` `[3]int` ``) and trailing "Citations:" lines no longer produce wrong citations or verdicts<br>• processes wait for Postgres at start-up<br>• ingest no longer runs in 5-second bursts | — |

Earlier refreshes finished A1 (partly: SystemOne judging), A3, boilerplate suppression, self-hosted model support, the UI redesign, G3, G6 and the name.

---

## v0.1.0 (released 2026-09-28)

Phase 5 ended in **v0.1.0**: rc.1 and rc.2 ran on the reference install, a walkthrough of every page by role changed records and long forms into pages (no side sheets) and fixed what it found, including a database-pool deadlock in profile migrations. The repository and the image are public; bitop-ui is public too. Its known issue, the binary reporting its version as `v0.1`, is fixed in the image workflow for the next release (H1).

---

## Done in v0.2.0 (released 2026-09-29)

The plan and the owner's decisions are in [`v0.2.0.md`](v0.2.0.md); the release notes are [`releases/v0.2.0.md`](releases/v0.2.0.md).

| ID | Item | Where |
|---|---|---|
| A2 | **Evaluations:** sets of questions per KB or agent; retrieval runs (recall@k, MRR, the expected document's real rank) and full-answer runs (cites, must-mention, refusals, supported claims); import from CSV or ragbench JSONL; "Add to evaluations" from your own conversations and the Try it panel; compare runs; opt-in automatic runs with drop notifications. | [`evaluations.md`](evaluations.md), [`operations/evaluations.md`](operations/evaluations.md) |
| E1 | **SSO groups:** IdP group → team role rules applied at sign-in, with a dry run; memberships made by hand are never changed. | [`operations/sso-groups.md`](operations/sso-groups.md) |
| E2 | **Costs and budgets:** dated prices per model and unit; Off / Track only / Enforce with per-team overrides; monthly budgets in the platform time zone with extensions; Track only shows progress, Enforce pauses chats, searches and ingestion at 100%. | [`costs.md`](costs.md), [`operations/costs.md`](operations/costs.md) |
| B4 | **OCR:** pages without a text layer and PNG/JPEG/TIFF uploads, read by the new `grounded-ocr` Tesseract sidecar, Tika or a vision model; per-source switch, daily page limit; admins see failed and needs-OCR documents by team without file names, and retry them or notify owners. | [`ocr.md`](ocr.md), [`operations/ocr.md`](operations/ocr.md) |
| E15 | **⌘K finds objects** through `GET /v1/search`, with team-side words (spend, members, evaluations…) and agent descriptions. | — |
| C13, C14, G1, G2, G4, G5, G7–G18 | The small-fixes batch: agent Settings tab, KB top-k inherited, table `<br>`, deleted agents' conversations, crawls woken by a raised limit, one date rule, clickable-row semantics, toasts as status messages, and the rest. | CHANGELOG |
| F8, F9, F10, F12 | Operations: the authorization matrix in its own CI job; SBOMs, digests and checksums on each release; the reference install on the remote Kustomize base; the Dependabot triage policy. | CONTRIBUTING, `deploy/release/` |
| H1, H2 | The image reports exactly its tag (`grounded v0.2.0-rc.1 (…)`), checked on every tag build; `[Unreleased]` in the CHANGELOG and notes per release. | `.github/workflows/image.yml` |
| — | **From the review before rc.1:** a verdict per citation marker and uncited factual sentences flagged (in chat and evaluation scores); follow-up rewriting across turns; model punctuation normalised (broken email links); stopped answers settle their citations; the widget preview's 403; clearer refusals with starter questions; money in cents; evaluation results that show expected vs what came back; collapsible admin groups; phone layouts (drawer, one header button); "Try it", "SSO groups", "Parsing & OCR". | [`ui-review/v0.2-review.md`](ui-review/v0.2-review.md) |
| — | **Found while releasing:** UTF-8 web pages without a charset declaration were stored garbled as windows-1252 (pages re-read on their next sync); a blocked team's upload could slip into a free ingestion slot; the release job's asset upload. | CHANGELOG |

---

## Done in v0.2.1 (released 2026-09-29)

The plan is [`v0.2.1.md`](v0.2.1.md); the release notes are [`releases/v0.2.1.md`](releases/v0.2.1.md).

| ID | Item | Where |
|---|---|---|
| I1–I8 | **Navigation and clarity:** the admin sidebar in eight collapsible groups (Legal holds a tab of Retention, Profile migrations a tab of Embedding profiles); the admin Overview's Features card with the evaluations switch; quality and spend on the team Overview; a team Evaluations page and sidebar item; Usage & spend with spend in one line; Crawl domains on Data sources; a shorter Costs Overview; a six-tab agent editor with versions in the header; the admin team's budget card on its Overview; Analytics' Checks tab. Old addresses redirect. | § I below |
| I9 | **Per-claim verification:** each factual sentence is a claim with one verdict, shown with its text; chat and evaluations count the same claims; `claims[]` in the API. | [`systemone.md`](systemone.md) |
| G19 (part), G20 | A fixed 0–100% score chart and a collapsible breadcrumb (bitop-ui); the "Retrieval , Sep 28" link text. | CHANGELOG |
| — | **From the v0.2.1 walkthrough:** editors no longer see budget entries in the team audit log; evaluation trends skip unscored runs; Compare versions includes SystemOne settings; the claim card opens from the keyboard (a chip now opens it, with "Show source"); sources start collapsed; the first Tab reaches "Skip to content"; ⌘K opens moved tabs directly; and many smaller copy, keyboard and phone fixes. | CHANGELOG |

## Done around v0.2.1: the project's public sites

| Item | Where |
|---|---|
| **Project website:** a landing page for Grounded as open source (what it does, screenshots of a fictional "Example University" instance, run it yourself, project status), Next.js static export served by nginx. | [`ncecere/grounded-website`](https://github.com/ncecere/grounded-website) |
| **Documentation site:** guides for people chatting, editors, team owners and platform admins; self-hosting (install, configuration, OIDC, models, OCR, observability, backups, upgrades, security); the API with a reference generated from `api/openapi.yaml`; release notes. Fumadocs with static search. | [`ncecere/grounded-docs`](https://github.com/ncecere/grounded-docs) |
| **Screenshot set:** a clean instance seeded with fictional data and generic model names, so public screenshots show nothing from a real install. | — |

---

## Done in v0.2.2 (released 2026-09-30)

Small fixes after v0.2.1 (§ J); the release notes are [`releases/v0.2.2.md`](releases/v0.2.2.md).

| ID | Item |
|---|---|
| J1–J6 | The Features card layout, SystemOne connections tested with a SystemOne request, team initials, an editor withdrawing a domain request, bitop-ui follow-ups (G19), and local development that survives a Docker restart (F13). |

---

## Done in v0.3.0 (released 2026-09-30)

The plan and the owner's decisions are in [`v0.3.0.md`](v0.3.0.md); the release notes are [`releases/v0.3.0.md`](releases/v0.3.0.md). The Community/Enterprise edition plumbing (ADR-0025) was deferred, and the editions were later rejected: Grounded stays one MIT project (owner, 2026-10-02).

| ID | Item | Where |
|---|---|---|
| C1a | **Grounded as an MCP server:** `POST /mcp` (protocol `2026-07-28` and older clients), the `search` and `ask` tools, the `mcp` key scope, limits, budgets and audit as for the REST API. | [`mcp.md`](mcp.md) |
| — | **OAuth sign-in for MCP clients** (experimental, off by default): Grounded as an OAuth 2.1 authorization server in front of the OIDC provider, a consent page and Connected apps. | [`mcp.md`](mcp.md) |
| C1b | **MCP tools in agents:** a registry of remote MCP servers with tool approval and classification ceilings, Build → Tools, results cited as sources and verified like passages, metered and audited calls. | [`mcp-client.md`](mcp-client.md) |
| E11 | **Stored health** of connections, models and MCP servers: every Test stores its result, a scheduled re-test at no cost, failures under Needs attention, metrics and an alert. | [`operations/health.md`](operations/health.md) |
| F1 | **OpenTelemetry tracing:** one answer is one trace across HTTP, retrieval, model calls, SystemOne, MCP (both ways) and jobs; trace context through MCP `_meta`; log lines carry the trace ID. | [`operations/tracing.md`](operations/tracing.md) |
| — | **Faster answers:** a follow-up is rewritten only when it depends on the conversation, the search runs alongside the input and scope checks, a passage judging time limit, and progress steps until the first words. | [`phase3-agents.md`](phase3-agents.md) §6–7 |
| — | **Reasoning effort** per agent for models that accept it; **Publish** disabled while the draft has problems. | — |
| — | **From the walkthrough by role:** about 60 fixes (how a person acted in the audit log, client cancellations no longer counted as 500s, a real `mcp_calls_per_answer` maximum, Connected apps for everyone, accessibility fixes, and more). | [`CHANGELOG.md`](../CHANGELOG.md) |

---

## K. v0.4.0: answers people trust and teams can improve — **Done** (v0.4.0, [`releases/v0.4.0.md`](releases/v0.4.0.md))

In priority order; the design is [`v0.4.0.md`](v0.4.0.md) (all five items are decided; milestones in § 6).

| # | ID | Item | Why |
|---|---|---|---|
| 1 | C2 (+A15) | **Unanswered-questions and gap report**, with sharing a failed question on a thumbs-down: **Done** (v0.4.0 M2, [`gaps.md`](gaps.md)) | Teams see what their agents fail at (refusals, no context, thumbs-down), clustered into the sources to add. |
| 2 | A1b **Done** (v0.4.0 M1) | **Cross-encoder reranking** | Better retrieval, and fewer passages for SystemOne to judge (the slowest step before the first words). |
| 3 **Done** (v0.4.0 M4) | A8 | **Answer cache** ([`answer-cache.md`](answer-cache.md)) | Repeated questions (public agents especially) answered at once, keyed by agent version and knowledge-base state. |
| 4 **Done** (v0.4.0 M5) | **New** | **Stream public answers safely:** moderate the answer in chunks as it's written instead of buffering it whole ([`moderation-streaming.md`](moderation-streaming.md)) | Visitors see text in seconds while moderation still fails closed. |
| 5 **Done** (v0.4.0 M3) | B10 (+A13) | **Document viewer with highlights**, and citation marks per claim ([`source-viewer.md`](source-viewer.md)) | A citation opens the passage, highlighted: the clearest proof that an answer is grounded. |
| — | C8, A14, B12, A12 | **Small wins**: **Done** (v0.4.1, [`releases/v0.4.1.md`](releases/v0.4.1.md)) | Follow-up suggestions, warnings about expectations a KB can't meet, OCR follow-ups, SystemOne capacity. |
| — | — | **Housekeeping** | **Done:** the product name (ADR-0025 rejected 2026-10-02: the name stays Grounded and the project stays fully open source); the screenshot refresh (v0.4.0, again in v0.4.2 with dark mode). **Open:** the MCP threat-model update ([`security/threat-model.md`](security/threat-model.md) predates the MCP server and client). |

Later (owner, 2026-09-30): D1 Teams and Slack bots; B1 Microsoft 365 connector with B6 document ACLs; E4 SCIM and E5 SIEM export.

---

## Done in v0.4.1 (released 2026-10-02)

| ID | What shipped | Docs |
|---|---|---|
| C8 | **Follow-up suggestions** under answers with citations, moderated and saved with saved answers. | [`follow-ups.md`](follow-ups.md) |
| A14 | **Evaluation questions that need attention**: expectations the knowledge base can't meet, and expected pages out of reach after 3 runs. | [`operations/evaluations.md`](operations/evaluations.md) |
| B12 | **OCR follow-ups:** every page of a TIFF; partly scanned PDFs join the OCR retry; the sidecar in the smoke test. | [`ocr.md`](ocr.md) |
| A12 | **SystemOne capacity:** answers first, background work capped at half the slots; the wait metric; the editor shows each check's added time. | [`systemone.md`](systemone.md) §8 |
| — | **Reasoning and tool steps in order** in Try it and stored conversations; today's date in the platform's time zone. | [`v0.4.1.md`](v0.4.1.md) |

---

## Done in v0.4.2 (released 2026-10-04)

The pre-beta release ([`v0.4.2.md`](v0.4.2.md), [`releases/v0.4.2.md`](releases/v0.4.2.md)): four testers used v0.4.1 by role and filed 119 findings, a re-test found 63 more, and all are fixed.

| ID | What shipped | Docs |
|---|---|---|
| — | **Admin → Models → Reranking:** status, a setup guide, settings, a before-and-after test, and "Reranking: off · Set up" on the Overview. | [`operations/rerank.md`](operations/rerank.md) |
| — | **Admin → Settings:** time zone, currency, default budget, feature switches, and the values the environment sets. | [`operations/settings.md`](operations/settings.md) |
| VI-38 | **Dark mode:** follows the device, with System / Light / Dark in the account menu; the public page and widget follow the visitor's device. | [`personal-settings.md`](personal-settings.md) |
| — | **Answers with tools:** the answer is the model's final turn; tool results aren't judged out; a follow-up's rewritten query is checked before use; reasoning written into the answer is treated as reasoning; low-confidence "contradicts" shows as "not supported". | [`phase3-agents.md`](phase3-agents.md) |
| — | **Kept work and fewer dead ends:** save conflicts keep your edits on every settings form; a rate limit shows a countdown and Try again now; a link to a deleted conversation says so; the Build tab no longer scrolls past its content; phones, tablets and keyboard use throughout. | [`v0.4.2.md`](v0.4.2.md) "As built" |

---

## L. Release plan (owner, 2026-10-04)

| Version | Theme | Items |
|---|---|---|
| **v0.4.3** | Beta fixes, during the beta | A16 (models that ignore thinking off, [issue #7](https://github.com/ncecere/grounded/issues/7)), G22 ("Working on it…" while a model slot is busy), E18 (profile page, API keys in the account menu), and what beta testers report |
| **v0.5.0** | **Better knowledge in** (owner chose theme A) | **Index preview:** re-index a knowledge base with new ingest settings into a candidate index, run its evaluation sets against old and new, then switch or discard (extends profile migrations, P2); **structure-aware chunking** (A9 + C15); **parent/child retrieval** (A5); **contextual chunks**, opt-in per source with a cost estimate (A4); **content health report** (B8); **fuzzy boilerplate** (A11); **tables** kept structured (A10, first half) |
| **v0.6.0** | **Service desk building blocks** | **Webhooks** (F3); **agent templates** (C4); a **router agent** (C5); **conversation sharing** (C12); **in-app team requests** (E3), optional: off until a platform admin turns them on |
| v0.7.0 (tentative) | Adoption by other installs | F5 Helm chart, D2 SDKs and CLI, D4 configuration as code, F11 bitop-ui docs site |
| v0.8.0 (tentative) | Where people work, and identity | D1 Teams and Slack bots, E4 SCIM, E5 audit export and SIEM, E13 audience in usage |
| v0.9.0 (tentative) | Private content | B6 document permissions, B1 Microsoft 365, then B2 Google Drive and B3 connectors |

Not planned yet: **C3 human handoff and ticketing** (owner, 2026-10-04: no ticketing integration for now); D3 email-to-agent; C6 voice, C7 image input, C10 structured outputs, C11 version A/B tests (if the beta asks for them).

Before v0.5.0's design, measure v0.4 with real use: reranking on and off in evaluation runs, and latency per step from traces.

---

## A. Answer quality

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| A1b **Done** (v0.4.0) | **Cross-encoder reranking** | Rerank the fused top 30–50 with a `/rerank` model (the kind already exists in the catalog). It's much faster than per-passage SystemOne judging on one GPU. | S–M | High | a rerank model |
| A2 **Done** (v0.2.0) | **Evaluation sets and regression runs** | Teams keep sets of questions with the expected page or answer, per KB or agent. One click runs them and shows recall and nDCG plus citation support over time, so every change to settings, chunking or models gets a score. This generalises `ragbench`'s URL-judged sets. | M | High | — |
| A4 | **Contextual chunks** | At ingest, prepend a short model-written summary of the document and section to each chunk before embedding. | M | Medium–High | budget for ingest-time LLM calls |
| A5 | **Parent/child retrieval** | Search small chunks, but give the model their larger parent section. | M | Medium | — |
| A6 | **Query decomposition** | Split multi-part questions into sub-queries, retrieve for each, then merge. | S | Medium | — |
| A7 | **Model-chosen filters** | In tool mode, the model passes metadata filters (source, tags, URL prefix, date) to `search_knowledge`. | S | Medium | — |
| A8 **Done** (v0.4.0) | **Answer cache** | Cache answers per agent version for identical or near-identical questions, invalidated on publish or re-index. | M | Medium (High for public) | — |
| A9 | **Semantic chunking per profile** | Heading- and sentence-aware splitting tuned per source type. | M | Medium | P2 |
| A10 | **Tables and figures** | Keep tables structured, and describe figures with a vision model at ingest. | M | Medium | a vision model |
| A11 | **Near-duplicate boilerplate** | Boilerplate matching today is exact-hash, so a menu with one highlighted item isn't caught. Add fuzzy matching (shingles or MinHash) per source. | S | Medium | — |
| A12 **Done** (v0.4.1) | **SystemOne capacity** | Batch judging was slower and worse on one GPU. Queue per GPU with priorities (interactive before ingest), and show the added latency per feature in the agent editor. Built as interactive and background priorities on each connection's slots, a wait metric and the editor's "Adds about 0.4 s" ([`systemone.md` §8](systemone.md#8-capacity)). | S | Medium | — |
| A13 ★ **Done** (v0.2.1 I9, v0.4.0 M3) | **Citation marks per claim** | A citation takes the worst verdict of every sentence that cites it, so one unsupported sentence marks a source that correctly supports the others as unsupported. Mark each claim instead, and show a source as "supported here, not there". | M | High | — |
| A14 **Done** (v0.4.1) | **Warn about expectations the KB can't meet** | An evaluation question can expect a phrase or document that isn't in the knowledge base (v0.2.0 warns while typing); add a set-level check that lists them, and flag questions whose expected document keeps ranking beyond the top 50. | S | Medium | A2 |
| A16 **New** | **Reasoning models that ignore "How to turn thinking off"** ([issue #7](https://github.com/ncecere/grounded/issues/7)) | Some models reason whatever is sent, so the rewrite stays slow, Reasoning effort Off does nothing, and follow-up suggestions run out of tokens. The model Test checks thinking off; suggestions retry with a larger budget when the model reasons anyway. | S | High (latency) | — |
| A15 **Done** (v0.4.0 M2, [`gaps.md`](gaps.md)) | **Share a failed question on a thumbs-down** | Let the person rating an answer opt in to sharing just the question with the team's editors, for evaluations. Changes ADR-0010, so it needs an ADR update, retention and a per-agent switch (deferred by the owner, 2026-09-28). | M | Medium–High | A2, an ADR |

## B. Content and sources

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| B1 ★ | **Microsoft 365 connector** (SharePoint and OneDrive) | Graph API, delta sync, and permissions mapped to the reserved ACL hook. | L | High | B6 for private sites |
| B2 | **Google Drive connector** | The same for Google Workspace. | L | Medium–High | B6 |
| B3 | **Confluence, Canvas LMS, Box, GitHub and S3 connectors** | Built on the source plugin interface (ADR-0008). | M each | Varies | — |
| B4 **Done** (v0.2.0) | **OCR for scanned PDFs** | Scanned PDFs are skipped today. Use Tesseract, or a vision model through the gateway. | M | High | — |
| B5 | **Crawling sites behind a login** | Cookie or token injection, or service accounts. | L | Medium | security review |
| B6 | **Document ACLs** | Honour source permissions at query time (the schema reserves a field for this). | L | High (for B1/B2) | — |
| B7 | **PII scanning at ingest** | Patterns (national ID numbers, institutional ID formats, card numbers), then model-based detection; block or flag documents. | M | High for compliance | — |
| B8 | **Content health report** | Stale pages, broken links, duplicates across sources, pages never cited, parse failures. | M | Medium | — |
| B9 | **Duplicate detection across teams** | Suggest shared sources when several teams crawl the same site. | S | Medium | — |
| B10 **Done** (v0.4.0 M3) | **Document viewer with highlights** | A citation opens the page or PDF at the cited passage. Done as the [source viewer](source-viewer.md): the passage in context beside the answer, "Open the page" with a text fragment, the whole document for editors. | M | Medium–High | viewer permissions |
| B11 | **Crawl preview matches the crawl** | The preview lists pages in a different order from the crawl (QA F-14; the wording is fixed, the behaviour isn't). Share the frontier logic. | S | Medium | — |
| B12 **Done** (v0.4.1) | **OCR follow-ups** | Multi-page TIFF (only the first page was read); partly scanned PDFs uploaded while OCR was off joining the "Needs OCR" retry (before: delete and re-upload); the OCR sidecar in the kind smoke test. Done: every TIFF page read with OCR, partly scanned PDFs need OCR and are retried with the scans, `make k8s-smoke` reads a scanned page with the sidecar ([`ocr.md`](ocr.md)). | S | Medium | B4 |

## C. Agents and chat

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| C1 ★ **Done** (v0.3.0 M1, M3) | **MCP support** | (a) Expose each KB or agent as an MCP server: **done** as `POST /mcp` with the `search` and `ask` tools, API keys with the `mcp` scope ([`mcp.md`](mcp.md)), and experimental OAuth sign-in behind a platform setting (M5). (b) Let agents call admin-approved external MCP tools: **done** (M3, [`mcp-client.md`](mcp-client.md)): Admin → Models → MCP servers with per-tool approval and a classification ceiling, Build → Tools, results cited as sources and verified, `mcp_calls` metering, MCP servers in stored health. | M | High | a tool approval policy |
| C2 **Done** (v0.4.0 M2, [`gaps.md`](gaps.md)) | **Unanswered-questions and gap report** | Cluster questions that got no context, refusals or thumbs-down, without showing content (ADR-0010). Tells teams what to add. | M | High | privacy review |
| C3 **Not planned** (owner, 2026-10-04: no ticketing integration for now) | **Human handoff and ticketing** | Create a ticket (webhook, or ServiceNow/Jira/TeamDynamix adapters) with the transcript, with the user's consent. | M | High for service desks | F3 |
| C4 | **Agent templates** | "Service desk FAQ", "Policy explainer" and others, with good defaults. | S | Medium | — |
| C5 | **Router agent** | One front-door agent routes each question to the best specialised agent. It could use SystemOne's scope check. | M | Medium–High | — |
| C6 | **Voice** | Speech to text and text to speech in the chat and the widget, through models the gateway serves. | M | Medium (accessibility) | — |
| C7 | **Image input** | Users attach a screenshot for vision-capable models. | M | Medium | a vision model |
| C8 **Done** (v0.4.1) | **Follow-up suggestions** | 2–3 grounded follow-up questions after each answer: **done** (v0.4.1 M1, [`follow-ups.md`](follow-ups.md)): up to 3 chips under an answer with citations, from a separate small call after it, moderated, saved with saved answers, on by default (Build → Advanced). | S | Medium | — |
| C9 **Partly done** | **Reasoning display and answer-length presets** | Per-agent control. **Done:** reasoning effort per agent (v0.3.0) and per audience, with Off (v0.4.0); "Thinking…" for readers and the reasoning panel for editors in Try it, in order with tool steps (v0.4.1); a maximum answer length in tokens (Build → Advanced). **Open:** answer-length presets (short / normal / detailed) instead of a token number. | S | Medium | — |
| C10 | **Structured outputs and forms** | Agents return checklists, forms or JSON. | M | Medium | — |
| C11 | **Version A/B tests** | Split traffic between two published versions. | M | Medium | — |
| C12 | **Conversation sharing** | A read-only, revocable snapshot of your own conversation. | S | Medium | — |
| C13 **Done** (v0.2.0) | **Agent Settings tab, KB primary action** | Sources and KBs have a Settings tab with a Danger zone; agents keep name and address in Appearance and Disable/Delete in the "…" menu. A new, empty KB has no "Attach source" in its header. Make the three detail pages match. | S | Medium | — |
| C14 **Done** (v0.2.0) | **KB results per search vs the agent's** | A KB's Retrieval settings say agents use the same settings, but a new agent shows its own "results per search" (6) and records it in the version. Say which wins, or make the agent inherit until overridden. | S | Medium | — |
| C15 **New** | **Content that mixes procedures** | Reviews found transcript answers mixing in the apostille procedure, because one crawled chunk combines both. Detect and split mixed sections at chunking, or let an agent's instructions rank special-case procedures lower. | M | Medium | — |

## D. Channels and integrations

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| D1 ★ | **Microsoft Teams and Slack bots** | Chat with an agent where people work. | M each | High | — |
| D2 | **Client SDKs and CLI** | TypeScript and Python clients generated from the OpenAPI spec, plus a CLI. | M | Medium | — |
| D3 | **Email-to-agent** | An inbox address per agent. | M | Low–Medium | — |
| D4 | **Configuration as code** | Export and import sources, KBs and agents as YAML; GitOps. | M | Medium | — |

## E. Administration and governance

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| E1 **Done** (v0.2.0) | **SSO group → team mapping** | Team membership and roles from IdP groups (OIDC claims or SCIM). | M | High | — |
| E2 **Done** (v0.2.0) | **Cost reporting and chargeback** | Tokens and requests per team, agent and model, priced from admin-entered prices, with budgets and alerts. Prices must be configurable per unit, because some gateways report embedding tokens as characters. | M | High | — |
| E3 | **In-app team requests** | A form with admin review, replacing the external link. | S | Medium | — |
| E4 | **SCIM provisioning** | Create users from the IdP, and suspend them when they leave. | M | Medium–High | E1 |
| E5 | **Audit export and SIEM streaming** | Splunk, Elastic, syslog; signed daily exports. | S | Medium | — |
| E7 **Done** | **Production safety checks** | Refuse to start outside loopback dev with the example `ENCRYPTION_KEY` or `API_KEY_PEPPER` from `.env.example`, or with `DEV_AUTH` on. Warn on an empty allowlist or on missing moderation for public agents. Add a `grounded doctor` command and admin page. The 2026-09-27 secret scan found the dev install using the example keys. **Done** (Phase 5 M2): warnings on the admin Overview. | S | High | — |
| E8 | **Accessibility statement and model cards** | "About this assistant" cards. | S | Medium | — |
| E9 | **i18n** | Translated UI, answers in the user's language. | M | Medium | — |
| E10 **Done** | **Key rotation** | `grounded rotate-keys`: re-encrypt stored secrets under a new `ENCRYPTION_KEY`, and rotate `API_KEY_PEPPER` with a grace period. Today there is no way to move off a leaked or example key without re-entering every connection key. | S | High | — |
| E11 **Done** (v0.3.0) | **Stored model health** | Keep the last test result per model and connection, re-test on a schedule, and flag failures on the admin Overview and in the catalog. **Done** (v0.3.0 M2, [`operations/health.md`](operations/health.md)): Test buttons store their result; the worker re-tests enabled connections every 15 minutes at no cost and derives their models' health; "Healthy · 3 minutes ago" on Connections and Models; Needs attention; `grounded_health_failing_seconds` and the `GroundedHealthCheckFailing` alert. MCP servers joined in M3 (their tool list, never a tool call). | S | Medium | — |
| E12 **Done** | **Clearer connection errors** | TLS, proxy and certificate failures all show as "request failed". Name the cause, e.g. "certificate not trusted", "TLS handshake failed", "proxy refused". **Done** (Phase 5 M2), with DNS, connect, TLS and first-byte timings in model tests and `grounded doctor`. | S | Medium | — |
| E13 | **Audience in the usage ledger** | Record the audience on usage events, so analytics can split token use by audience as well as by team. | S | Low–Medium | — |
| E14 | **Profile migration for team owners** | Only platform admins start profile migrations today, because the embedding load is platform-wide. Let owners request one for their KB, with admin approval or a budget. | S | Medium | P2 |
| E15 **Done** (v0.2.0) | **Command palette finds objects** | ⌘K finds pages and actions, not teams, users, agents, sources, KBs or models by name (admin and workspace walkthroughs both asked for it). | S–M | Medium–High | — |
| E16 | **Admin team settings as read-only facts** | Admin → Team → Settings shows auditors disabled inputs; the workspace shows the same data as a read-only list. Use the read-only pattern for auditors. | S | Low–Medium | — |
| E18 **New** | **A profile page, and API keys in the account menu** | People have no page for their own profile, and personal API keys are found only under team settings (v0.4.2 bug hunt). | S | Medium | — |
| E17 **Partly done** | **Budget follow-ups** | Granted extensions can be revoked (v0.4.2, AD-35). Still open: Per-agent budgets (not in v0.2.0); re-embedding during a profile migration checked against the budget; documents already queued when a budget runs out (they finish today); a shorter cache than 30 s for teams close to 100%. | S–M | Medium | E2 |

## F. Platform and operations

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| F1 **Done** (v0.3.0 M4) | **OpenTelemetry tracing** | HTTP → retrieval → model calls, with per-stage timings for admins. **Done** ([`operations/tracing.md`](operations/tracing.md)): off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set; one answer is one trace across HTTP, retrieval, model calls (token counts, time to first token), SystemOne, agent turns and MCP tool calls; trace context through HTTP, MCP `_meta` (both ways) and River job metadata; `trace_id` in log lines; never content. Per-stage timings inside the product and dashboard trace links are not done. | M | Medium–High | — |
| F2 | **Partitioned vector tables** | Hash-partition `emb_<profile>` before millions of chunks. | M | High at scale | P2 |
| F3 | **Webhooks** | Signed, retried events (source synced, crawl failed, agent published, feedback). | M | Medium | — |
| F4 | **Second vector store** | Qdrant or pgvectorscale behind the interface. | L | Low for now | only if F2 isn't enough |
| F5 | **Helm chart** | Alongside Kustomize. | S | Medium (adoption) | P1 |
| F6 **Done** | **Demo mode and seed data** | `grounded demo` seeds a neutral sample team, sources, a KB and agents over a public documentation site. Useful for evaluations, screenshots and the public README, and it replaces the dev instance's hand-built data. | S | Medium–High (adoption) | — |
| F7 **Done** | **Flaky crawl timing test** | `TestFetcherPacesEveryRequest` fails under machine load. Make it tolerant, or use a fake clock. | S | Low (CI noise) | — |
| F8 **Done** (v0.2.0) | **Faster authorization matrix** | About 3,300 calls under `-race` take over 7 minutes on a 2-vCPU CI runner. Run the calls in parallel per team fixture, or give the matrix its own CI job. | S | Medium (CI time) | — |
| F9 **Done** (v0.2.0) | **Release assets** | Attach an SBOM file and a checksums file to each GitHub Release; today they exist only as attestations on the image. | S | Medium (adoption, compliance) | — |
| F10 **Done** (v0.2.0) | **Remote Kustomize base for the reference install** | The repository is public, so the homelab overlay can reference `github.com/ncecere/grounded//deploy/kubernetes?ref=v0.1.0` and drop its vendored copy (`docs/deployments/kubernetes.md`, "Consuming the base"). Upgrades become a one-line ref and digest change. | S | Medium | — |
| F11 **Partly done** | **bitop-ui docs site and npm** | The CLI is on npm (`@bitop-dev/cli`); the docs site is still unpublished. bitop-ui is public, but its docs site isn't published (`DEPLOY_PAGES` is off) and the CLI installs from a checkout. Publish the site, and consider a registry URL so Grounded (and others) install without a local clone. | S | Medium (adoption) | — |
| F12 **Done** (v0.2.0) | **Dependabot triage** | Weekly grouped update PRs now arrive for Go, npm, Actions and Docker. Decide who merges them and how (CI green → merge), so they don't pile up. | S (ongoing) | Medium | — |
| F13 **Done** (v0.2.2, J6) | **Local dev resilience** | The dev fake model proxy and the OCR sidecar don't come back after Docker restarts; `make deps-up` should start (or `make dev` should supervise) everything a local build expects. | S | Low (developers) | — |

## G. Small fixes and polish

All of G1–G18 are **Done** in v0.2.0; G21 and G22 are open.

| ID | Item | Size |
|---|---|---|
| G1 **Done** | `<br>` inside model-written tables shows literally; render it as a line break in bitop-ui `response` (table cells only). | S |
| G2 **Done** | A deleted agent's conversations: show the transcript read-only instead of "not available". | S |
| G4 **Done** | A crawl waiting for tomorrow's page quota doesn't resume when the limit is raised. | S |
| G5 **Done** | Per-minute usage is shown only for the team-wide query rate. | S |
| G7 **Done** | When an admin creates a profile for a model with known prefixes (nomic, Qwen3), fill the recommended prefixes in, or warn when they're empty. The help text mentions them today. | S |
| G8 **Done** | Hand-built show/hide toggles → bitop-ui `Disclosure`. | S |
| G9 **Done** | Pick up bitop-ui's review follow-ups as they land, above all M1 (clickable table rows add a tab stop per row and aren't announced as clickable) and M2 (a chart series below 3:1 contrast). | S |
| G10 **Done** | bitop-ui `Avatar` builds initials from punctuation: "Go docs (signed-in)" shows "G(". It should skip non-letters. | S |
| G11 **Done** | `cmd/sparkbench` still has its own copy of the old citation-marker regex; switch it to the `internal/agents` markers. | S |
| G12 **Done** | A revoked API key's audit-log link lands on the API keys list, which hides revoked keys. Let the API return a revoked key by id so its record page opens. | S |
| G13 **Done** | Dates: lists use relative times, but Home's "Continue where you left off", open invites and a few admin tables show absolute dates, and Analytics shows ISO dates. One rule: relative in lists (absolute on hover), absolute on record pages. | S |
| G14 **Done** | A "You were added to <team>" notification stays after the person is removed and leads to a no-access page. Resolve it on removal. | S |
| G15 **Done** | Toasts are exposed to screen readers as dialogs (Base UI's toast); they should be status messages. A bitop-ui change. | S |
| G16 **Done** | The answer feedback buttons have no pressed state (`aria-pressed`), and the selected thumb is only a faint fill. | S |
| G17 **Done** | Agent Appearance says the default accent is `#0021a5`, but the preview uses the theme's indigo: a leftover from the removed institution theme. | S |
| G18 **Done** | The widget key form opens with `?record=new`; every other form page uses `?form=`. | S |
| G19 **Done** | bitop-ui follow-ups. **Done in v0.2.1:** the collapsed breadcrumb item and LineChart's fixed range (0–100% score chart). **Done in v0.2.2 (J5):** Combobox no longer submits a form or dialog on Enter (Grounded's wrapper is gone); `TooltipText`, an accessible tooltip on plain text (the evaluation Score cell); LineChart `ticks` (0%, 50%, 100% on the score chart); DataTable `columnsMenuMin` and `showFilterLabel` (the evaluation lists); no FilterBar chip for single-choice toggles (Legal holds' duplicated "Status: Active ×"); Menu popups portalled into their trigger's landmark (axe `region`; Popover popups are dialogs, which axe already accepts); InlineCitation `sourceAction` (the chat citation card); column hiding on the team spend tables (DataTable with `defaultHiddenNarrow`). **Noticed, not scheduled:** Select, Combobox, Tooltip and ContextMenu popups still open at the end of `<body>` (axe `region`, a best-practice rule outside the WCAG A/AA set the tests enforce); they can use the same `useLandmarkContainer`. | S |
| G20 **Done** | Evaluation run links read "Retrieval , Sep 28…" (a stray space before the comma). | S |
| G22 **New** | **"Working on it…" while a model slot is busy:** the status shows nothing while an answer waits for the gateway's or SystemOne's capacity; a status step for the wait (re-test US-09). | S |
| G21 **New** | A document's passages list cuts a long passage off after about 6 lines with no way to expand it (a multi-page TIFF's single passage hides its later pages; v0.4.1 walkthrough). Let a passage expand, or open it in the source viewer. | S |

## H. Next release housekeeping

| ID | Item | Size |
|---|---|---|
| H1 **Done** (v0.2.0) | The v0.1.0 binary reports its version as `v0.1` (the image workflow passed the `vX.Y` tag as the version). Fixed in `.github/workflows/image.yml`; ships with the next release. | Done in CI |
| H2 **Done** (v0.2.0) | CHANGELOG: open an `[Unreleased]` section for v0.2, and keep release notes per version under `docs/releases/`. | S |

---

## I. v0.2.1: navigation and clarity — **Done** (v0.2.1, [`releases/v0.2.1.md`](releases/v0.2.1.md))

**Scheduled** by the owner (2026-09-28; design agreed 2026-09-29 in [`v0.2.1.md`](v0.2.1.md)): the structural clean-up the review before rc.1 proposed ([`ui-review/v0.2-review.md`](ui-review/v0.2-review.md), "Structural changes"), deferred so it gets its own walkthrough.

| ID | Item | Size |
|---|---|---|
| I1 **Done** | **Admin navigation regroup:** 8 groups and about 21 items (Profile migrations a tab of Embedding profiles, Legal holds a tab of Retention, Break-glass under Records, Limits next to Costs). | M |
| I2 **Done** | **Admin Overview "Features" card:** what's on and off (Evaluations, Cost tracking, OCR, SSO groups, SystemOne, Public access, Maintenance), with the evaluations switch moved there; the stats strip first. | S |
| I3 **Done** | **Team Overview "Quality & spend":** latest evaluation scores and regressions; spend and the budget bar for owners; a team index of evaluation sets at `/teams/:team/evaluations`. | M |
| I4 **Done** | **Usage & spend:** a one-line budget strip with the breakdown in a disclosure, per-agent spend in agent Analytics; Crawl domains moves to Data sources. | S–M |
| I5 **Done** | **Costs Overview consolidated:** KPIs, the chart with "Show data", one "Top spenders" card (Teams / Agents / Models). | S |
| I6 **Done** | **Agent editor to 6 tabs:** Versions into the header's version menu; Build · Evaluations · Appearance · Share · Analytics · Settings. | S–M |
| I7 **Done** | **Admin team page:** cost tracking and budget as a card on Overview; the Limits tab holds only limits. | S |
| I8 **Done** | **Analytics:** the SystemOne cards in a "Checks" tab. | S |
| I9 **Done** | **Per-claim verification (A13, second step):** the claim text in the citation popover and one unit shared by chat and evaluations. | M |

---

## J. v0.2.2: small fixes — **Done** (v0.2.2, [`releases/v0.2.2.md`](releases/v0.2.2.md))

On branch `release/v0.2.2`; found while preparing the public sites' screenshots and in the v0.2.1 walkthrough.

| ID | Item | Size |
|---|---|---|
| J1 **Done** | The admin Overview's Features card squeezed the Evaluations description into a one-word column beside its switch: a row with a control now puts its actions under its text. | S |
| J2 **Done** | A connection test fails with 404 for a working SystemOne connection (the test asks `/models`, which a SystemOne service doesn't serve). Test SystemOne connections with a SystemOne request: a connection with only SystemOne models (or a 404 from `/models` and a SystemOne model) is asked one SystemOne question; `grounded doctor` does the same. | S |
| J3 **Done** | Team avatar initials: "IT Help Desk" showed "ID"; bitop-ui's Avatar now takes the first letters of the first two words ("IH"), still skipping punctuation (G10) and passing over lowercase name particles (van, de, of). | S |
| J4 **Done** | Editors can't withdraw their own pending domain request (there's no API for it). `DELETE /v1/teams/{team}/domain-requests/{id}` for the requester or a team admin or owner while pending, audited (`crawl.domain_withdraw`); "Withdraw request…" on Data sources → Crawl domains. The request is removed, not given a new status (no migration). | S |
| J5 **Done** | The G19 bitop-ui items above. | S |
| J6 **Done** | F13 local dev resilience: the fake model proxy and OCR sidecar come back after a Docker restart. Compose services restart with Docker; `make deps-up` starts the OCR sidecar when `.env` sets `OCR_TESSERACT_URL`; `make dev-up` adds the fake gateway as a Docker service. | S |


---

## v0.2.0 scope (owner decisions, 2026-09-28)

The spec is [`v0.2.0.md`](v0.2.0.md). Everything below shipped in v0.2.0 except what is marked later.

| Item | Decision |
|---|---|
| **A2** evaluation sets | In, with the full-answer check; on for editors, a platform switch turns it off. **Done.** |
| **A13** citation marks per claim | A first step shipped (a verdict per marker, uncited sentences flagged); the rest is I9 in v0.2.1. |
| **A1b** cross-encoder reranking | Parked until a rerank model is available to test with. |
| **E1** SSO group → team mapping | In. **Done.** |
| **E2** cost reporting | In, with Off, Track only and Enforce. **Done.** |
| **B4** OCR | In: Tesseract sidecar (the reference install), Tika or a vision model. **Done.** |
| **E15** command palette finds objects | In. **Done.** |
| Small fixes: G1, G2, G4, G5, G7–G18, C13, C14 | In. **Done.** |
| Operations: F8, F9, F10, F12 | In. **Done.** |

Next in line after v0.2.2, for v0.3: **C1** MCP, **D1** Teams/Slack bots, **B1** Microsoft 365 connector (with **B6** ACLs), **C2** unanswered-questions report, **E11** stored model health, **F1** tracing, **A1b** once there's a model.
