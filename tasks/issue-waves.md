# Open-issue implementation waves

Baseline: `8e61890` (v0.6.1). Inventory: all 29 open issues and all 10 comments read on 2026-10-28, plus the three open Dependabot PRs (#165–167). The roadmap remains the scope source of truth; this file orders execution, not a replacement roadmap. Owner authorizes implementation, testing, improvements and pre-1.0 releases; **v1.0.0 requires the owner's explicit decision**.

## Execution rules

- One focused branch/PR per issue or coherent subset of a tracking issue. Add regression tests; OpenAPI first for contract changes; regenerate rather than hand-edit generated files.
- Read issue comments: many unchecked QA bullets already shipped in v0.6.1. Verify before changing them; retain evidence for each remaining bullet. Do not close a tracking issue for a partial fix.
- Run focused checks during development and all required GitHub checks before merging. CI is the release gate, not merely a submitted workflow. Follow CONTRIBUTING.md and AGENTS.md for integration, authorization, cluster QA and release scans.
- Use disposable development infrastructure only. No production writes, toggling production settings for experiments, production deployment, or tests in other namespaces. #77's isolated-namespace requirement needs an explicitly approved test environment or local isolated cluster, not a bypass of AGENTS.md.
- Release only validated coherent changes, with changelog, release notes, dependency/license inventory, security scans, upgrade compatibility and artifact verification. Batch routine dependency updates at milestones; prioritize security fixes. Never bypass branch protections.
- Fake models test mechanics, not retrieval/answer quality. Record missing real-model measurements honestly; never manufacture results. External credentials/infrastructure and unavailable corpora are explicit blockers, not reasons to close issues.
- Each completed increment updates this file and the issue with PR/test evidence. Reinventory before the final sweep and at release boundaries.

## Wave 0 — foundations and baseline (in progress)

1. [x] Read all 29 issues and comments; inspect open PRs, roadmap and v0.7/v0.8 decisions.
2. [x] Record waves, release gates and v1.0 restriction.
3. [ ] Establish executable Go/Node tooling and disposable integration infrastructure; locate homelab dev-env tooling without exposing secrets.
4. [ ] Record baseline check results; distinguish pre-existing failures from regressions.
5. [ ] Inspect #165–167, advisories and CI; batch safe updates at the next release gate.

## Wave 1 — API/security correctness (candidate v0.6.2)

Order: #116, security/contract portions of #119 and #146, then #77 if its verification environment is available.

- **#116:** finish wrong-method handling with OpenAI-shaped 405 errors and `Allow`, preserving the already-fixed no-key/internal errors.
- **#119:** close key deletion oracle; validate scopes before role restrictions; case-insensitive Bearer; deliberate 405/OPTIONS/CORS contract; reject unsafe display-name/filename controls; friendly config validation; align preview auth contract; OpenAI history/content validation; strict retrieve topK; global 429 documentation; safe HTTPS/HSTS operator policy.
- **#146 (server):** authorization before revision errors, connection timeout consistency, retention/reason copy, format errors, model context/output bounds, public-message floor/required ceiling, duplicate-owner invite investigation.
- **#77:** deny OCR egress and verify DNS/external denial, allowed API/worker ingress and readiness with no additive allow policy. Static validation alone does not finish this issue.

Exit: API spec/generated types agree, negative/authz and method regressions pass, required CI green. Do not wait on inaccessible infrastructure to ship independently complete fixes; keep blocked items open.

## Wave 2 — remaining v0.6 QA (candidate v0.6.3, or combine with v0.6.2 if ready)

- **#140:** suspended-requester approval; Unicode template uniqueness; paused/editable withdrawn-destination webhook; DNS label validation; remaining DESIGN/OpenAPI mismatches; router sharing/export clarity; approved classification; mobile webhook/request tables.
- **#132:** explicit costs-enabled signal to remove spend 404s; Unicode slug strategy; accurate numeric errors; alt-less image removal; upload scope/size copy; top-k validation; no-op source edits and duplicate publishing; profile the crawl's skip-heavy tail and expose a real waiting reason if applicable.
- **#128:** reconcile multi-tab conversation history without losing a local stream or duplicating messages; test unknown IDs including `?c=null` deliberately.
- **#146 (UI/docs):** reload hash scrolling and remaining admin documentation/copy. Verify already-shipped bullets rather than repeating fixes.

Exit: each remaining tracker bullet has test or documented investigation evidence; keyboard, mobile (390px) and accessibility checks plus cluster QA walks reviewed. Separate external docs PRs where required.

## Wave 3 — ingestion/retrieval quality (version chosen after measured scope)

1. **#25:** establish repeatable reranker/chunker comparisons and per-stage latency measurement on authorized nonproduction real-model data. Reuse the existing 96-question set if accessible; large-corpus quality remains blocked until representative questions exist.
2. **#19 (remaining C15):** obtain representative mixed-procedure pages, specify/test structure boundaries; preserve chunker v1 byte-for-byte. Do not claim quality improvement without measurement.
3. **#24:** structured tables with row/header preservation, long-table chunking fixtures and index-preview comparison.
4. **#23:** bounded per-source fuzzy boilerplate detection, deterministic thresholds, false-positive safeguards and benchmarks.
5. **#20:** parent/child indexing/retrieval, bounded context and citation correctness; preview before switching.
6. **#21:** opt-in contextual chunks, model/budget controls and estimate, reproducibility, retries and no untrusted-context privilege escalation.
7. **#22:** content health report: stale/broken/duplicate/uncited/parse failure signals with tenant-safe pagination. Supplies the review surface for wave 5 PII findings.

Exit: designs before nontrivial implementation; migration/rollback/upgrade tests; measured comparisons (quality, latency, cost) without fake-model quality claims. This work was deferred from v0.5.0: do not relabel it as already delivered or reuse an existing release tag.

## Wave 4 — adoption (v0.7.0)

Follow `docs/v0.7.0.md` and produce detailed designs first.

1. **#31:** Helm generated from Kustomize, parity tests, common values, OCI release artifact; existing installs unchanged.
2. **#32:** configuration YAML export/dry-run/apply for sources/KBs/agents/evaluations/webhooks; named secret references, no content/secrets exported, tenant-scoped authorization, deterministic diff and safe conflict semantics.
3. **#33:** bitop-ui published docs/registry and Grounded installation instructions, coordinated in the external repository. Do not hand-edit vendored UI components.
4. **#34:** settings-derived assistant cards on signed-in/public/widget views and editable accessibility/contact statement; no leaking private model/source details to unauthorized audiences.

Exit: clean-install/upgrade/parity checks, export/import round-trip and secret-leak tests, keyboard/axe/mobile QA, documentation and published artifacts verified.

## Wave 5 — identity/compliance (v0.8.0)

Follow `docs/v0.8.0.md`; expand/contract migrations, detailed threat/design review before implementation.

1. **#39:** audience on usage events and aggregation, compatible historical unknown audience; shared basis for analytics and budgets.
2. **#40:** auditor team settings as read-only facts (not disabled edit forms).
3. **#38:** per-agent budgets, migration/re-embedding and queued-ingest enforcement, shorter near-exhaustion cache; concurrent-spend and boundary tests.
4. **#35:** SCIM users/groups with scoped provider tokens, IdP ownership rules, audited lifecycle and prompt revocation of sessions/keys/connected apps; reuse SSO mappings.
5. **#36:** signed/checksummed daily JSONL audit exports and approved TLS syslog/HTTPS streaming with retry/checkpoint/gap detection, no content leakage.
6. **#37:** deterministic configurable PII scanning, checksums, counts/types/pages only; flag by default and explicit block/review path, surfaced in #22. No jurisdiction-specific default institutional data.

Exit: authorization/revocation matrix, tamper/gap/export recovery checks, sensitive-data leakage tests, budget concurrency tests, migration compatibility and operations docs.

## Wave 6 — private content (v0.9.0 tentative)

1. **#41:** fail-closed document ACLs and identity mapping, enforced in retrieval, parent expansion, citations/viewer, caches, evaluation, export, sharing, router, API and MCP; permission revocation/invalidation tests. Must precede private connectors.
2. **#42:** Microsoft Graph SharePoint/OneDrive with pagination, delta/deletion sync and permissions.
3. **#43:** Google Drive with change tokens, shared drives and permissions.
4. **#44:** separate increments for Confluence, Canvas LMS, Box, GitHub and S3 using ADR-0008; each with least-privilege auth, pagination/deletions, rate-limit/retry, SSRF defenses and ACL propagation as relevant. A single connector does not close the aggregate issue.

Exit: fixture contract tests and opt-in real-provider acceptance for each connector; revocation/deletion tests, encrypted secrets and operational recovery documented. Do not enable paid/external tenants without credentials and authorization.

## Wave 7 — measured scale and final sweep (pre-1.0 only)

- **#89 starts with measurement design during wave 0/1**, not after all features: document explicit provisional targets (not invented owner requirements), seeders/open-loop load tests, fake-upstream performance harness and multi-replica stack. Run bounded tests only on approved disposable capacity. Feed measured bottlenecks into earlier waves if correctness/availability demands it.
- Re-run capacity after waves 3, 5 and 6; compare vectors/retrieval/rerank, River queues/crawler, model slots, caches, rate limits, usage/audit writes, auth, evaluations, Postgres, backup/restore. Issue and fix measured findings, then capacity/failure/restore runs with before/after numbers and scale operations docs.
- Review all remaining open issues/PRs, stale tracker checkboxes and external docs; verify acceptance evidence and reconcile blockers. Do not close #25/#19/#77/#89 merely for shipping harnesses.
- Security/dependency refresh, complete QA and pre-1.0 maintenance release(s) as warranted. **Stop short of v1.0.0; the owner alone decides that tag.**

## Progress / evidence

- Initial environment: GitHub CLI authenticated; Node 22.23.0, npm 10.9.8, Docker 29.1.3 and kubectl present. Go is not on PATH; documented homelab checkout/dev-env path absent. Kubernetes context exists; no credentials printed. No integration/CI result claimed yet.
- First implementation increment: #116 method/error contract, with overlapping method requirements from #119 considered to avoid incompatible routing fixes.
