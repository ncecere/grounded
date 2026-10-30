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

## Wave 0 — foundations and baseline (baseline and security release complete)

1. [x] Read all 29 issues and comments; inspect open PRs, roadmap and v0.7/v0.8 decisions.
2. [x] Record waves, release gates and v1.0 restriction.
3. [x] Establish executable Go/Node tooling and disposable integration infrastructure; locate homelab dev-env tooling without exposing secrets.
4. [x] Record baseline check results; distinguish pre-existing failures from regressions.
5. [x] Inspect #165–167, advisories and CI; prioritize newly identified security blockers (#169) and stale calendar assertions (#172).
6. [x] Publish and independently verify the separate **v0.6.2 security patch** (#171/#176 merged; exact-source main, tag pipeline and both-platform final artifact gates passed; #169 closed).
7. [ ] Refresh and batch safe routine dependency updates at a validated milestone; do not mix an unreviewed group into the security patch.

## Wave 1 — API/security correctness (in progress; candidate v0.6.3)

Order: #116, security/contract portions of #119 and #146, then #77 if its verification environment is available.

- **#116:** finish wrong-method handling with OpenAI-shaped 405 errors and `Allow`, preserving the already-fixed no-key/internal errors.
- **#119:** close key deletion oracle; validate scopes before role restrictions; case-insensitive Bearer; deliberate 405/OPTIONS/CORS contract; reject unsafe display-name/filename controls; friendly config validation; align preview auth contract; OpenAI history/content validation; strict retrieve topK; global 429 documentation; safe HTTPS/HSTS operator policy.
- **#146 (server):** authorization before revision errors, connection timeout consistency, retention/reason copy, format errors, model context/output bounds, public-message floor/required ceiling, duplicate-owner invite investigation.
- **#77 — complete on main:** PR #179 denies OCR egress, excludes OCR from the additive base DNS grant, and passes real standalone/composed policy tests, positive controls, allowed API/worker ingress, fresh readiness and a live DNS mutation. Both standalone and full existing-cluster/application smoke paths passed, all CI green; issue closed. This is for the next patch, not v0.6.2.

Exit: API spec/generated types agree, negative/authz and method regressions pass, required CI green. Do not wait on inaccessible infrastructure to ship independently complete fixes; keep blocked items open.

## Wave 2 — remaining v0.6 QA (combine with v0.6.3 if ready, otherwise a later patch)

- **#140:** suspended-requester approval; Unicode template uniqueness; paused/editable withdrawn-destination webhook; DNS label validation; remaining DESIGN/OpenAPI mismatches; router sharing/export clarity; approved classification; mobile webhook/request tables.
- **#132:** explicit costs-enabled signal to remove spend 404s; Unicode slug strategy; accurate numeric errors; alt-less image removal; upload scope/size copy; top-k validation; no-op source edits and duplicate publishing; profile the crawl's skip-heavy tail and expose a real waiting reason if applicable.
- **#128:** reconcile multi-tab conversation history without losing a local stream or duplicating messages; test unknown IDs including `?c=null` deliberately.
- **#146 (UI/docs):** reload hash scrolling and remaining admin documentation/copy. Verify already-shipped bullets rather than repeating fixes.

Exit: each remaining tracker bullet has test or documented investigation evidence; keyboard, mobile (390px) and accessibility checks plus cluster QA walks reviewed. Separate external docs PRs where required.

## Deferred contract steps (recorded, not part of v0.6.3; #195)

Staged by ADR-0013 (follow-up of 2026-10-30; details and rationale in [`docs/operations/upgrades.md`](../docs/operations/upgrades.md#staged-constraints)). Each needs its own migration, upgrade-test steps and CHANGELOG entry; do not fold them into a patch release.

- [ ] **Agent template names, unique index (a later release; the next minor at the earliest, once nothing older than v0.6.3 can run).** Migration: rename Unicode-only twins that old pods saved (as 00054 does), `CREATE UNIQUE INDEX CONCURRENTLY agent_templates_name_fold_key ON agent_templates (lower(name COLLATE "und-x-icu"))`, drop `agent_templates_name_fold_idx`. Upgrade test: with the v0.6.3 image as the old one, a new-schema twin write must be refused as `409`, not a 500. The code already recognises the index name (`isTemplateNameTaken`).
- [ ] **Agent template names, old index contract (the release after that).** Drop `agent_templates_name_key`; remove its name from `isTemplateNameTaken`.
- [ ] *(Optional, low value)* Remove the audit-log lookup for an empty `team_requests.approved_classification` after a bounded batch backfill outside a migration; until then the lookup is indexed (`audit_log_target_idx`) and only runs for old approved rows.

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

- Initial inventory: 29 issues / 10 comments, preserved above. Execution added security issue **#169** and test-maintenance issue **#172**; both are now closed after validated fixes and, for #169, publication/verification. Original issue **#77** is also complete/closed. Aggregate QA issues remain open for their remaining bullets.
- Tooling established: verified Go archive, Go 1.26.10 selected by the updated toolchain pin; Node 22.23.0, Docker, kubectl and the homelab's `tools/dev-env` (with `GROUNDED_REPO`/`KUBECONFIG_DEV` overrides). No credentials printed. Local database regressions use isolated Postgres 17 + Valkey containers with cleanup. Homelab development tests use `dev-grounded`; local kind tests own their cluster and smoke/acceptance namespaces. No production namespace or other project's environment is used.
- Baseline `8e61890`: cluster authz and k8s suites pass with exit-0 artifact results; resources removed. The initial API connection timeout and the retry wrapper's anomalous exit are documented rather than hidden.
- **v0.6.2 published and verified:** PR #171 merged without override as `4f099247abd228801b7aa84ea304dfa34061ba22`; #176 prepared the release, tagged at immutable source `a1dc01fb903675b247655f007b29822d9fdf8e7a`. Go 1.26.10, x/net v0.62.0, go-jose v4.1.6, seroval 1.7.3 and development-only undici 8.12.3 fix the fresh findings. Main run `40798452222` and tag run `40803814316` passed. The tag's initial OCR signing hit Rekor's duplicate-entry 409; failed jobs passed on retry, without moving the tag or bypassing signing. Post-publication evidence/support guidance merged in #180.
- Security validation: full local lint/unit checks, clean Go/npm audits, **144 UI files / 1,196 tests**, v0.6.1 upgrade rehearsal, cluster doctor on Postgres 18 and an admin/user 1280/390px walk (**94 captures, 0 configured-check failures**, four representative screenshots reviewed). Exact published app/OCR indexes independently pass workflow signatures, source-bound **amd64/arm64** provenance/SPDX and vulnerability scans: 0 Go / 0 fixable HIGH/CRITICAL findings. Release asset checksums pass; app SBOM assets match signed OCI. Both amd64 CLI versions report v0.6.2/exact source; no ARM hardware run is claimed. App retains 3 UNKNOWN findings; OCR retains 341 Debian findings including one unfixable critical. Exact-source scan: 0 secrets, prior 28 MEDIUM/HIGH IaC findings unchanged plus 43 reviewed LOW findings in the all-severity scan. Full receipts and limitations: `docs/security/validation/v0.6.2.md`.
- **#116 / #119 methods:** #170 merged with all checks green as `e8dc9f0`. Actual-mux 405/Allow, overlapping literal/wildcard matches, OpenAI envelopes and the no-preflight-CORS-write policy are covered by real-DB/race/router contracts. #178 completes shared-middleware envelopes (expired/suspended sessions, CSRF, rate limits, invalid URL, auth-store failures and pre-header panic); local refreshed regressions pass and CI is pending. Its unrelated webhook timeout fixture was stabilized without production changes: 100 race stress runs pass and disabling HTTP Client.Timeout via a compiler overlay is caught. Keep #116 open until both increments are merged.
- **#119 keys:** #173 implements invisible-key DELETE 404, invalid scopes 400 versus known over-privileged scopes 403, and case-insensitive Bearer schemes while preserving secret case. Refreshed real-DB/race key tests and the complete authorization/break-glass matrix pass; fresh CI is pending. Denied deletion leaves the key active. #181 adds text-only/51-message OpenAI bounds and strict explicit retrieval topK 1–50 with omission preserved: named fail-before proofs and real-DB pass-after controls recorded; CI green, merge held for dependency order. Friendly config type errors are in development with fail-before and real-DB create/PATCH tests. Names/filenames, preview contract, shared 429 documentation and HSTS guidance remain.
- **#146 authorization:** #174 checks platform access before body/revision validation, preserving explicit read-only POST previews. All reported cases and the complete real-DB authorization/break-glass matrix pass again under race on current main; fresh CI remains a gate.
- **#146 validation/copy:** #175 covers explicit zero timeout, chat-model output/context bounds including partial updates, retention 0/keep copy, Unicode-aware disable reason and MCP Features guidance. Fresh real-DB/race/generated/lint/type/style/size checks pass. Fixed the CI E2E cross-spec race by moving the global Webhooks toggle into the existing serial platform phase; exact navigation and role assertions are preserved. Full four-worker local Playwright **51/51 pass**, using an owned browser container because host libatk was absent; DB/browser cleanup verified. Fresh CI remains a gate; other #146 bullets remain open.
- **#89 measurement design:** use existing DESIGN sizing and Phase-5 harness as provisional assumptions (recorded in the issue), not an invented owner SLO or a claim that old 16k-passage measurements prove current 10M-passage capacity. No production load or configuration changes.
