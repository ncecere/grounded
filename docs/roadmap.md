# Roadmap candidates

Status: refreshed 2026-09-28 for **v0.2** planning (branch `v0.2`). Phases 0–5 are done and **v0.1.0 is released** (the reference install runs it). Nothing below is scheduled until the owner picks it; the proposed v0.2 short list is at the end.

**How to read this:**
- Each item has an ID so you can pick by number. IDs are stable: finished items keep theirs and are marked **Done**.
- **Size:** S = a day or two, M = about a week, L = several weeks.
- **Value** is my estimate of impact for teams and admins.
- **Depends on** lists what must exist first.
- ★ marks the items I'd recommend first in each section.
- **New** marks items added in this refresh: from the v0.1.0 walkthrough of every page by role (four personas, 138 findings; the rest were fixed before release) and from running the release.

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

## A. Answer quality

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| A1b | **Cross-encoder reranking** | Rerank the fused top 30–50 with a `/rerank` model (the kind already exists in the catalog). It's much faster than per-passage SystemOne judging on one GPU. | S–M | High | a rerank model |
| A2 ★ | **Evaluation sets and regression runs** | Teams keep sets of questions with the expected page or answer, per KB or agent. One click runs them and shows recall and nDCG plus citation support over time, so every change to settings, chunking or models gets a score. This generalises `ragbench`'s URL-judged sets. | M | High | — |
| A4 | **Contextual chunks** | At ingest, prepend a short model-written summary of the document and section to each chunk before embedding. | M | Medium–High | budget for ingest-time LLM calls |
| A5 | **Parent/child retrieval** | Search small chunks, but give the model their larger parent section. | M | Medium | — |
| A6 | **Query decomposition** | Split multi-part questions into sub-queries, retrieve for each, then merge. | S | Medium | — |
| A7 | **Model-chosen filters** | In tool mode, the model passes metadata filters (source, tags, URL prefix, date) to `search_knowledge`. | S | Medium | — |
| A8 | **Answer cache** | Cache answers per agent version for identical or near-identical questions, invalidated on publish or re-index. | M | Medium (High for public) | — |
| A9 | **Semantic chunking per profile** | Heading- and sentence-aware splitting tuned per source type. | M | Medium | P2 |
| A10 | **Tables and figures** | Keep tables structured, and describe figures with a vision model at ingest. | M | Medium | a vision model |
| A11 **New** | **Near-duplicate boilerplate** | Boilerplate matching today is exact-hash, so a menu with one highlighted item isn't caught. Add fuzzy matching (shingles or MinHash) per source. | S | Medium | — |
| A12 **New** | **SystemOne capacity** | Batch judging was slower and worse on one GPU. Queue per GPU with priorities (interactive before ingest), and show the added latency per feature in the agent editor. | S | Medium | — |
| A13 **New** ★ | **Citation marks per claim** | A citation takes the worst verdict of every sentence that cites it, so one unsupported sentence marks a source that correctly supports the others as unsupported. Mark each claim instead, and show a source as "supported here, not there". | M | High | — |

## B. Content and sources

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| B1 ★ | **Microsoft 365 connector** (SharePoint and OneDrive) | Graph API, delta sync, and permissions mapped to the reserved ACL hook. | L | High | B6 for private sites |
| B2 | **Google Drive connector** | The same for Google Workspace. | L | Medium–High | B6 |
| B3 | **Confluence, Canvas LMS, Box, GitHub and S3 connectors** | Built on the source plugin interface (ADR-0008). | M each | Varies | — |
| B4 ★ | **OCR for scanned PDFs** | Scanned PDFs are skipped today. Use Tesseract, or a vision model through the gateway. | M | High | — |
| B5 | **Crawling sites behind a login** | Cookie or token injection, or service accounts. | L | Medium | security review |
| B6 | **Document ACLs** | Honour source permissions at query time (the schema reserves a field for this). | L | High (for B1/B2) | — |
| B7 | **PII scanning at ingest** | Patterns (national ID numbers, institutional ID formats, card numbers), then model-based detection; block or flag documents. | M | High for compliance | — |
| B8 | **Content health report** | Stale pages, broken links, duplicates across sources, pages never cited, parse failures. | M | Medium | — |
| B9 | **Duplicate detection across teams** | Suggest shared sources when several teams crawl the same site. | S | Medium | — |
| B10 | **Document viewer with highlights** | A citation opens the page or PDF at the cited passage. | M | Medium–High | viewer permissions |
| B11 **New** | **Crawl preview matches the crawl** | The preview lists pages in a different order from the crawl (QA F-14; the wording is fixed, the behaviour isn't). Share the frontier logic. | S | Medium | — |

## C. Agents and chat

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| C1 ★ | **MCP support** | (a) Expose each KB or agent as an MCP server. (b) Let agents call admin-approved external MCP tools. | M | High | a tool approval policy |
| C2 ★ | **Unanswered-questions and gap report** | Cluster questions that got no context, refusals or thumbs-down, without showing content (ADR-0010). Tells teams what to add. | M | High | privacy review |
| C3 | **Human handoff and ticketing** | Create a ticket (webhook, or ServiceNow/Jira/TeamDynamix adapters) with the transcript, with the user's consent. | M | High for service desks | F3 |
| C4 | **Agent templates** | "Service desk FAQ", "Policy explainer" and others, with good defaults. | S | Medium | — |
| C5 | **Router agent** | One front-door agent routes each question to the best specialised agent. It could use SystemOne's scope check. | M | Medium–High | — |
| C6 | **Voice** | Speech to text and text to speech in the chat and the widget, through models the gateway serves. | M | Medium (accessibility) | — |
| C7 | **Image input** | Users attach a screenshot for vision-capable models. | M | Medium | a vision model |
| C8 | **Follow-up suggestions** | 2–3 grounded follow-up questions after each answer. | S | Medium | — |
| C9 | **Reasoning display and answer-length presets** | Per-agent control. | S | Medium | — |
| C10 | **Structured outputs and forms** | Agents return checklists, forms or JSON. | M | Medium | — |
| C11 | **Version A/B tests** | Split traffic between two published versions. | M | Medium | — |
| C12 | **Conversation sharing** | A read-only, revocable snapshot of your own conversation. | S | Medium | — |
| C13 **New** | **Agent Settings tab, KB primary action** | Sources and KBs have a Settings tab with a Danger zone; agents keep name and address in Appearance and Disable/Delete in the "…" menu. A new, empty KB has no "Attach source" in its header. Make the three detail pages match. | S | Medium | — |
| C14 **New** | **KB results per search vs the agent's** | A KB's Retrieval settings say agents use the same settings, but a new agent shows its own "results per search" (6) and records it in the version. Say which wins, or make the agent inherit until overridden. | S | Medium | — |

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
| E1 ★ | **SSO group → team mapping** | Team membership and roles from IdP groups (OIDC claims or SCIM). | M | High | — |
| E2 ★ | **Cost reporting and chargeback** | Tokens and requests per team, agent and model, priced from admin-entered prices, with budgets and alerts. Prices must be configurable per unit, because some gateways report embedding tokens as characters. | M | High | — |
| E3 | **In-app team requests** | A form with admin review, replacing the external link. | S | Medium | — |
| E4 | **SCIM provisioning** | Create users from the IdP, and suspend them when they leave. | M | Medium–High | E1 |
| E5 | **Audit export and SIEM streaming** | Splunk, Elastic, syslog; signed daily exports. | S | Medium | — |
| E7 **Done** | **Production safety checks** | Refuse to start outside loopback dev with the example `ENCRYPTION_KEY` or `API_KEY_PEPPER` from `.env.example`, or with `DEV_AUTH` on. Warn on an empty allowlist or on missing moderation for public agents. Add a `grounded doctor` command and admin page. The 2026-09-27 secret scan found the dev install using the example keys. **Done** (Phase 5 M2): warnings on the admin Overview. | S | High | — |
| E8 | **Accessibility statement and model cards** | "About this assistant" cards. | S | Medium | — |
| E9 | **i18n** | Translated UI, answers in the user's language. | M | Medium | — |
| E10 **Done** | **Key rotation** | `grounded rotate-keys`: re-encrypt stored secrets under a new `ENCRYPTION_KEY`, and rotate `API_KEY_PEPPER` with a grace period. Today there is no way to move off a leaked or example key without re-entering every connection key. | S | High | — |
| E11 **New** | **Stored model health** | Keep the last test result per model and connection, re-test on a schedule, and flag failures on the admin Overview and in the catalog. | S | Medium | — |
| E12 **Done** | **Clearer connection errors** | TLS, proxy and certificate failures all show as "request failed". Name the cause, e.g. "certificate not trusted", "TLS handshake failed", "proxy refused". **Done** (Phase 5 M2), with DNS, connect, TLS and first-byte timings in model tests and `grounded doctor`. | S | Medium | — |
| E13 **New** | **Audience in the usage ledger** | Record the audience on usage events, so analytics can split token use by audience as well as by team. | S | Low–Medium | — |
| E14 **New** | **Profile migration for team owners** | Only platform admins start profile migrations today, because the embedding load is platform-wide. Let owners request one for their KB, with admin approval or a budget. | S | Medium | P2 |
| E15 **New** ★ | **Command palette finds objects** | ⌘K finds pages and actions, not teams, users, agents, sources, KBs or models by name (admin and workspace walkthroughs both asked for it). | S–M | Medium–High | — |
| E16 **New** | **Admin team settings as read-only facts** | Admin → Team → Settings shows auditors disabled inputs; the workspace shows the same data as a read-only list. Use the read-only pattern for auditors. | S | Low–Medium | — |

## F. Platform and operations

| ID | Item | What and why | Size | Value | Depends on |
|---|---|---|---|---|---|
| F1 | **OpenTelemetry tracing** | HTTP → retrieval → model calls, with per-stage timings for admins. | M | Medium–High | — |
| F2 | **Partitioned vector tables** | Hash-partition `emb_<profile>` before millions of chunks. | M | High at scale | P2 |
| F3 | **Webhooks** | Signed, retried events (source synced, crawl failed, agent published, feedback). | M | Medium | — |
| F4 | **Second vector store** | Qdrant or pgvectorscale behind the interface. | L | Low for now | only if F2 isn't enough |
| F5 | **Helm chart** | Alongside Kustomize. | S | Medium (adoption) | P1 |
| F6 **Done** | **Demo mode and seed data** | `grounded demo` seeds a neutral sample team, sources, a KB and agents over a public documentation site. Useful for evaluations, screenshots and the public README, and it replaces the dev instance's hand-built data. | S | Medium–High (adoption) | — |
| F7 **Done** | **Flaky crawl timing test** | `TestFetcherPacesEveryRequest` fails under machine load. Make it tolerant, or use a fake clock. | S | Low (CI noise) | — |
| F8 **New** | **Faster authorization matrix** | About 3,300 calls under `-race` take over 7 minutes on a 2-vCPU CI runner. Run the calls in parallel per team fixture, or give the matrix its own CI job. | S | Medium (CI time) | — |
| F9 **New** | **Release assets** | Attach an SBOM file and a checksums file to each GitHub Release; today they exist only as attestations on the image. | S | Medium (adoption, compliance) | — |
| F10 **New** ★ | **Remote Kustomize base for the reference install** | The repository is public, so the homelab overlay can reference `github.com/ncecere/grounded//deploy/kubernetes?ref=v0.1.0` and drop its vendored copy (`docs/deployments/kubernetes.md`, "Consuming the base"). Upgrades become a one-line ref and digest change. | S | Medium | — |
| F11 **New** | **bitop-ui docs site and npm** | bitop-ui is public, but its docs site isn't published (`DEPLOY_PAGES` is off) and the CLI installs from a checkout. Publish the site, and consider a registry URL so Grounded (and others) install without a local clone. | S | Medium (adoption) | — |
| F12 **New** | **Dependabot triage** | Weekly grouped update PRs now arrive for Go, npm, Actions and Docker. Decide who merges them and how (CI green → merge), so they don't pile up. | S (ongoing) | Medium | — |

## G. Small fixes and polish

| ID | Item | Size |
|---|---|---|
| G1 | `<br>` inside model-written tables shows literally; render it as a line break in bitop-ui `response` (table cells only). | S |
| G2 | A deleted agent's conversations: show the transcript read-only instead of "not available". | S |
| G4 | A crawl waiting for tomorrow's page quota doesn't resume when the limit is raised. | S |
| G5 | Per-minute usage is shown only for the team-wide query rate. | S |
| G7 | When an admin creates a profile for a model with known prefixes (nomic, Qwen3), fill the recommended prefixes in, or warn when they're empty. The help text mentions them today. | S |
| G8 | Hand-built show/hide toggles → bitop-ui `Disclosure`. | S |
| G9 **New** | Pick up bitop-ui's review follow-ups as they land, above all M1 (clickable table rows add a tab stop per row and aren't announced as clickable) and M2 (a chart series below 3:1 contrast). | S |
| G10 **New** | bitop-ui `Avatar` builds initials from punctuation: "Go docs (signed-in)" shows "G(". It should skip non-letters. | S |
| G11 **New** | `cmd/sparkbench` still has its own copy of the old citation-marker regex; switch it to the `internal/agents` markers. | S |
| G12 **New** | A revoked API key's audit-log link lands on the API keys list, which hides revoked keys. Let the API return a revoked key by id so its record page opens. | S |
| G13 **New** | Dates: lists use relative times, but Home's "Continue where you left off", open invites and a few admin tables show absolute dates, and Analytics shows ISO dates. One rule: relative in lists (absolute on hover), absolute on record pages. | S |
| G14 **New** | A "You were added to <team>" notification stays after the person is removed and leads to a no-access page. Resolve it on removal. | S |
| G15 **New** | Toasts are exposed to screen readers as dialogs (Base UI's toast); they should be status messages. A bitop-ui change. | S |
| G16 **New** | The answer feedback buttons have no pressed state (`aria-pressed`), and the selected thumb is only a faint fill. | S |
| G17 **New** | Agent Appearance says the default accent is `#0021a5`, but the preview uses the theme's indigo: a leftover from the removed institution theme. | S |
| G18 **New** | The widget key form opens with `?record=new`; every other form page uses `?form=`. | S |

## H. Next release housekeeping

| ID | Item | Size |
|---|---|---|
| H1 **New** | The v0.1.0 binary reports its version as `v0.1` (the image workflow passed the `vX.Y` tag as the version). Fixed in `.github/workflows/image.yml`; ships with the next release. | Done in CI |
| H2 **New** | CHANGELOG: open an `[Unreleased]` section for v0.2, and keep release notes per version under `docs/releases/`. | S |

---

## v0.2 scope (owner decisions, 2026-09-28)

The spec is [`v0.2.md`](v0.2.md).

| Item | Decision |
|---|---|
| **A2** evaluation sets | In: retrieval check, then the full-answer check if time allows. Optional: editors only, and a platform switch. |
| **A13** citation marks per claim | Later: a refinement of the citation checks already in chat. |
| **A1b** cross-encoder reranking | Parked until a rerank model is available to test with. |
| **E1** SSO group → team mapping | In. |
| **E2** cost reporting | In, with modes: Off, **Track only**, Enforce (budgets). |
| **B4** OCR | In, optional and pluggable: Tesseract, Apache Tika, or a vision model. |
| **E15** command palette finds objects | In. |
| Small fixes: G1, G2, G4, G5, G7–G18, C13, C14 | In. |
| Operations: F8, F9, F10, F12 | In. |

Next in line for v0.3: **C1** MCP, **D1** Teams/Slack bots, **B1** Microsoft 365 connector (with **B6** ACLs), **C2** unanswered-questions report, **E11** stored model health, **F1** tracing, **A13**, **A1b** once there's a model.
