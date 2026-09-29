# Phase 5: deploy and harden → v0.1.0

Status: **done: released as v0.1.0 on 2026-09-28**. Owner decisions are recorded in §9.

Phase 5 ends in the first release, **v0.1.0**, and that release is when the repository goes public (owner decision, 2026-09-27).

**Scope:** DESIGN §19 Phase 5 (items P1–P9 in [`roadmap.md`](roadmap.md)), plus:
- **E7:** production safety checks;
- **E10:** key rotation;
- **F6:** demo mode.

The Kubernetes work is generic and lives in this repository. The owner's homelab cluster is the first real install (the reference install, §4). Its configuration is an overlay in the owner's own GitOps repository, not here (ADR-0023).

---

## 1. Goals and exit criteria for v0.1.0

**v0.1.0 is done when all of these hold:**
1. **Fresh install:** a Kubernetes install from `deploy/kubernetes` plus an overlay runs Grounded end to end. That means OIDC sign-in, a web source crawled into a KB, an agent answering with verified citations, and the public widget on an allowed site.
2. **Reference install:** the owner's homelab install (§4) does all of that through its own OIDC provider and tunnel.
3. **Safety:** the server refuses to start in production with the example keys or with `DEV_AUTH` on (E7).
4. **Key rotation** works end to end on the reference install (E10).
5. **Profile migration:** an existing KB moves to a new embedding profile without downtime (P2).
6. **Retention and legal hold:** these jobs run, and break-glass access is audited (P3, P4).
7. **Maintenance mode** pauses ingestion while chat keeps working (P5).
8. **Monitoring:** dashboards and alerts exist, and one restore of Postgres and object storage has been rehearsed and written up (P6, P7).
9. **Load tests** run at 2× the capacity estimates, with the results written down. Laptop and homelab hardware give indicative numbers only (P7).
10. **Security package:** `docs/security/` holds the data-flow diagram, controls, dependency inventory and threat model (P8).
11. **Demo mode:** `grounded demo` seeds a neutral sample install. The public README is based on it (F6).
12. **Tests** (added 2026-09-27): a Playwright end-to-end suite runs in CI over the main flows, with axe on every page; a route × role × foreign-team authorization matrix generated from the OpenAPI spec passes; the kind smoke test runs in CI on `main`; CI publishes a coverage report; an upgrade-test harness exists (§5, "Test coverage").
13. **Release:** `v0.1.0` is tagged, with signed, digest-pinned images on ghcr.io and release notes. The repository is public with a fresh history, and its security settings are on (P9).

## 2. Milestones

Each milestone is merged and deployed to the reference install before the next one starts.

| Milestone | Contents | Visible result |
|---|---|---|
| **M1: first deploy** | Image publishing in CI; the generic Kustomize base and components (P1); the reference overlay and its OIDC access policy | Grounded running at the reference install with the owner's sign-in |
| **M2: safe to run** | E7 safety checks, E10 key rotation, P5 maintenance mode; kind smoke test and coverage report in CI | The reference install on its own keys, and a rotation tested there |
| **M3: switch models safely** | P2 profile migration | A KB moved to a new embedding profile, with no manual rebuild |
| **M4: governance** | P3 retention and legal hold, P4 break-glass | Retention jobs and break-glass in the admin UI |
| **M5: operate it** | P6 dashboards and alerts, P7 load tests and restore rehearsal, P8 security package; Playwright end-to-end suite, authorization matrix, upgrade-test harness | Grafana dashboards, alerts, and `docs/operations/` runbooks |
| **M6: release** | F6 demo mode, the README, P9 release and going public | `v0.1.0` public on GitHub |

## 3. Generic Kubernetes (this repository): `deploy/kubernetes/` (P1)

**Base** (`deploy/kubernetes/base`):
- **`grounded-api` Deployment:** `grounded api`, 2 replicas by default.
  - An init container runs `grounded migrate`. The advisory lock makes concurrent runs safe.
  - Readiness uses `/readyz`, liveness `/healthz`.
  - Graceful shutdown lets SSE chats finish (`SHUTDOWN_DELAY`, `terminationGracePeriodSeconds`).
  - Topology spread across nodes, and a PodDisruptionBudget.
- **`grounded-worker` Deployment:** `grounded worker`, 2 replicas, with a PodDisruptionBudget. `/metrics` on the worker port.
- **Services and config:**
  - Services for the API (HTTP) and for metrics.
  - A ConfigMap for the non-secret settings.
  - Secrets are referenced by name only: `grounded-runtime`, `grounded-s3`, and optionally `grounded-smtp`. The base never contains secret values.
- **Security context:** non-root, read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`, and an `emptyDir` for `/tmp`.
- **NetworkPolicies:**
  - Default-deny.
  - Ingress to the API from a labelled ingress controller namespace.
  - Egress to Postgres, Valkey, S3 and DNS, plus HTTPS to the internet for models, the crawler and OIDC. The crawler's SSRF guard still applies in the app.

**Components**, optional and added by overlays:
- `components/postgres-single`: a pgvector Postgres 17 StatefulSet. For small installs without CloudNativePG or a managed database, the way the reference install runs it.
- `components/postgres-cnpg`: a CloudNativePG `Cluster` with 1 primary and 2 replicas, WAL archiving to S3, and scheduled backups. The HA path that DESIGN §15 describes.
- `components/valkey-single`: a Valkey StatefulSet with a password.
- `components/backup-pgdump`: a daily `pg_dump` CronJob, validated with `pg_restore --list`, retained N days. For installs without CNPG.
- `components/ingress`: a generic `Ingress` with the host and class filled in by the overlay.
- `components/tika`: optional Apache Tika.
- `components/monitoring`: a ServiceMonitor (Prometheus Operator) or scrape annotations, plus dashboards and alert rules (§7).

**Example overlays:**
- `overlays/example-small`: single Postgres, single Valkey, pg_dump backups.
- `overlays/example-ha`: CNPG, and a Valkey note: use Sentinel or a managed service (DESIGN §18 item 3).

Both are validated in CI with `kustomize build` and `kubeconform`.

**Images:**
- **Workflow:** a GitHub Actions workflow builds `ghcr.io/ncecere/grounded` on every push to `main` (tags `sha-<commit>`) and on `v*` tags. The image is multi-arch (amd64 and arm64).
- **Provenance:** images get an SBOM and provenance attestation, and a cosign signature.
- **Visibility:** they're private until v0.1.0. Overlays pin images by **digest**.

## 4. The reference install

The first real install is the owner's single-node homelab cluster. Its configuration is an overlay in the owner's own GitOps repository, not here (ADR-0023). It vendors `deploy/kubernetes` with `make vendor-k8s` and adds:

| Piece | Choice |
|---|---|
| Delivery | Flux applies the overlay from the GitOps repository; nothing is applied by hand. |
| Ingress | Traefik behind a tunnel that keeps the `Host` header; no proxy SSO in front, because OIDC inside Grounded is the session. |
| OIDC | Authentik, RS256, email scope from a verified-email mapping; access limited to one group through a policy binding (OpenTofu). |
| First admin | Sign in once, then set `BOOTSTRAP_ADMIN_SUBJECT` to your `sub` from the users table. The next sign-in makes you platform admin. |
| Database | `components/postgres-single` (pgvector) on a retained NFS PVC, plus `components/backup-pgdump` onto a separate PVC. |
| Valkey | `components/valkey-single`. |
| Object storage | An S3-compatible bucket and user on the cluster's own object store. |
| Secrets | External Secrets from the cluster's OpenBao store: `grounded-runtime` (`ENCRYPTION_KEY`, `API_KEY_PEPPER`, database and Valkey passwords and URLs, OIDC client), the bucket credentials, and a registry pull secret while the image was private. Values were generated in memory and never shown. |
| Models | **One self-hosted GPU box only** (decided 2026-09-27): chat Qwen3.8-27B (`extraBody` thinking off; about 14 s per answer), embeddings Qwen3-Embedding-4B at 768 dimensions (task instruction on queries, keyword weight 0.02), and SystemOne for moderation, citation checks and scope checks. The keys are entered in the admin UI after first start and stored encrypted. |
| Monitoring | The cluster's Alloy, Mimir and Grafana: Alloy scrapes the `metrics` ports, the dashboards load into a Grafana folder, and the alert rules sync to the Mimir ruler. |

**The reference install isn't highly available.** It has one Postgres on NFS, and its backups sit on the same NAS. It proves the manifests, not the 99.9% target, which needs the HA overlay (CNPG, or managed Postgres and Valkey) on separate storage.

## 5. Application work

### E7: production safety checks (M2)
- **Refuse to start** unless `APP_URL` is loopback, when any of these holds:
  - `ENCRYPTION_KEY` or `API_KEY_PEPPER` equals a value in `.env.example` (their hashes are compiled in);
  - `DEV_AUTH` is on;
  - `APP_URL` isn't https.
- **Warnings,** in the log and on the admin Overview:
  - an empty crawl allowlist;
  - public agents without moderation;
  - no SMTP;
  - no OIDC domain restriction or access policy;
  - ~~`MIGRATE_ON_START` with more than one API replica~~: a process can't see the replica count, so this is not checked. The Kubernetes base pins it to `false` and migrates in init containers.
- **`grounded doctor`** prints the same checks, plus connectivity to Postgres, Valkey, S3, the OIDC issuer and each model connection. Connection failures are named (TLS, DNS, proxy, certificate), which also covers roadmap E12.

**Built (M2 part A):** `config.SafetyErrors` (all four modes; `migrate` only when `APP_URL` is set; the example keys stay allowed as `*_PREVIOUS`); `internal/preflight` warnings, logged at startup and returned as `warnings` on `GET /v1/admin/overview` (the Overview's attention queue); `grounded doctor` (`--json`, `--mode`, `--probe`); named transport errors with `httptrace` phase timings (DNS, connect, TLS, first byte) in `doctor` and in the admin connection and model tests (`timings`). Kubernetes: `grounded-config` is generated with a content hash (also when vendored), API pods spread with `DoNotSchedule`. See [`deployments/kubernetes.md`](deployments/kubernetes.md), "Safety checks", "grounded doctor" and "Slow DNS".

### E10: key rotation (M2)
- **`grounded rotate-keys`** re-encrypts every stored secret: connection keys, SMTP and moderation secrets.
  - It decrypts with the old `ENCRYPTION_KEY` and encrypts with the new one, table by table in batches, one transaction per batch. It's resumable, idempotent and audited (counts only), with a `--dry-run`.
  - During rollout the server accepts `ENCRYPTION_KEY_PREVIOUS` for reads.
- **Pepper rotation** takes `API_KEY_PEPPER_PREVIOUS`. Existing API keys keep working until they're next used: they are then re-hashed with the new pepper and marked. After a grace period, keys still on the old pepper are reported.
- **Runbook:** `docs/operations/rotate-keys.md`, tested on the home install.

### P5: maintenance mode (M2)
- A platform setting with a reason and an optional end time.
- New ingestion, crawls and uploads are paused, and so are writes the plan names. Chat, retrieval and reads keep working.
- A banner shows for admins and team owners. It's audited, and `grounded doctor` reports it.
- **Built** (migration 00025):
  - **Setting:** Admin → Maintenance (platform admins; auditors read it): on or off, a required reason shown to users, and an optional planned end, which is informational only. It never ends by itself. The state is the `maintenance_mode` row. Each process caches it for 2 s (`platform.MaintenanceGate`), so every API and worker process sees a change within seconds without depending on Valkey. Changes are audited as `platform.maintenance_start`, `_update` and `_end`. The API is `GET /v1/maintenance` (any session or key) and `GET/PUT /v1/admin/settings/maintenance`.
  - **Refused** with `503 maintenance_mode`, which carries the reason, `details {reason, plannedEndAt}` and `Retry-After`. This applies to everyone, including platform admins and API keys, for: uploads, creating a web source (its first crawl), Sync now, page re-fetches, retries and site maps.
  - **Deferred:** settings changes that schedule work, such as resuming a source or changing repeated-block settings, are saved, and the work waits. Creating upload sources, KBs and agents, KB attach (which starts no work), deletes and crawl cancels all keep working.
  - **Parked in the worker:** the dispatcher queues no pending documents. A queued document's job returns it to pending, while one already processing finishes. The scheduler starts no due sync; it starts once maintenance ends. A running crawl finishes its current page, then waits with reason `maintenance`, its River job snoozed. Boilerplate refreshes snooze between steps. All of it resumes by itself within about 10 s of the switch going off.
  - **Keeps working:** sign-in, chat (team, signed-in and public), retrieval, the OpenAI-compatible API, reads and platform administration.
  - **UI:** a banner for platform admins and team owners, admins and editors (not on chat pages). Upload files, Sync now, Retry and Re-fetch are disabled with the reason.
  - **Doctor hook:** `platform.Maintenance(ctx, db)` returns the uncached state.

### P2: profile migration (M3)
- **Start:** an admin picks a KB and a target embedding profile, and sees counts, estimated embedding calls and time. They start the migration (maintenance mode is optional).
- **Background re-embed:** each source's chunks are re-embedded into the target profile's table, reusing stored parsed text (no re-fetch, no re-parse). It's throttled by the connection's rate limit, resumable, and cancellable.
- **Shared sources** keep both sets of vectors until every KB using them has switched (ADR-0007).
- **Atomic switch:** the KB switches in one step once every source is complete. Old vectors are deleted after a grace period, and a switch-back works within it.
- **Visibility:** progress shows in the admin UI and on the KB. It's audited, and admins are notified on completion.
- **Built** (migration 00029; runbook [`operations/profile-migration.md`](operations/profile-migration.md)):
  - **Who:** platform admins start, cancel, retry, switch back and finish migrations (Admin → Profile migrations, a tab of Embedding profiles since v0.2.1, or "Change embedding profile…" on a KB's page); auditors read them; team members see their KB's migration on its page (`GET /v1/teams/{team}/kbs/{kbId}/profile-migration`). Team owners can't start one: the embedding load is platform-wide and shared sources span teams.
  - **Data:** `chunks.profile_id`; `source_embedding_sets` (a source's extra profiles: building, ready, deleting); `embedding_set_failures` (per document version); `profile_migrations` (one running or switched per KB). A trigger fills in `profile_id` for chunks written by the previous release.
  - **Preflight** (`POST /v1/admin/profile-migrations/preflight`): sources, documents, passages, tokens, requests at `EMBED_BATCH_SIZE`, and time at the connection's `requestsPerMinute`; blockers (same or retired profile, disabled model or connection, classification ceiling, dimensions, another active migration) and warnings (re-chunking, shared sources, documents in progress, failed documents, no request limit, maintenance for large migrations).
  - **Re-embedding:** the `embedding_set.sync` job per source and profile, through the shared batcher at background priority; passages copied when the chunk settings match, else cut again from the stored parsed text (no fetch; a document without stored parsed text is parsed from its stored original). Bounded steps, one job per set at a time (an advisory lock, and a follow-up job when a kick finds one running), a sweep every 30 s. Temporary failures retry twice, then wait for Retry.
  - **Switch:** one transaction flips `knowledge_bases.embedding_profile_id` (retrieval, including keyword search, uses the new profile from the next query); a source's own profile moves once every KB using it has. New documents are embedded for every profile the source has, during the migration and the grace period. Switch back within the grace period (`PROFILE_MIGRATION_GRACE_DAYS`, default 7, 0–90 per migration); Finish ends it early; the cleanup job (10 min) deletes unneeded sets in batches.
  - **Audit** (counts only): `kb.profile_migration_start`, `_cancel`, `_retry`, `_finish`, `_complete`, `kb.profile_switch`, `kb.profile_switch_back`. **Notifications:** `platform.profile_migration` (admins: switched, needs attention), `kb.profile_changed` (the team's admins and owners).

### P3: retention and legal hold (M4)
- **Retention jobs** for conversations (per classification level and audience; A8 stored the settings), access logs, usage events, audit (DESIGN §13 retention), and deleted documents and blobs.
- **Dry run:** each job has a dry-run report. Every period is configurable, and nothing is deleted by default where DESIGN §8 says "confirm with records management".
- **Legal hold** on a user, team, agent or conversation stops deletion for everything it covers. Holds are listed, reasoned, audited, and never expire automatically.
- **Built** (migration 00027; runbook [`operations/retention.md`](operations/retention.md)):
  - **Rules** (`internal/retention`): conversations per level and audience (signed-in days, anonymous hours; the Phase 4 anonymous rule is now one of them), conversations users deleted (grace period), the access log, analytics events, the usage ledger (rolled up per UTC day into `usage_daily` in the same statement; analytics token totals read both), the audit log (through the `ragd.audit_purge` trigger setting; `legal_hold.*` entries are never purged), deleted documents' and sources' stored files (recorded in `deleted_files` when deleted; passages and vectors still go at once), expired invites, and anonymous sessions at expiry. Every period but anonymous conversations is empty by default (keep).
  - **Settings:** `RETENTION_*_DAYS` environment defaults, overridden per kind in Administration → Retention (`GET/PUT /v1/admin/retention`, audited). Conversation periods stay on the classification levels.
  - **Job:** River, every 10 minutes and "Run now" (`POST /v1/admin/retention/runs`, audited); one run at a time (advisory lock); bounded batches (`RETENTION_BATCH_SIZE`, `RETENTION_MAX_BATCHES`); runs recorded with counts per kind (`GET /v1/admin/retention/runs`); a system audit entry `retention.purge` with counts only; metrics `grounded_retention_*`.
  - **Dry run:** `GET /v1/admin/retention/report`, the same query per kind as the purge, in a read-only transaction; counts per team, level, audience and reason, and what holds keep.
  - **Legal holds:** `legal_holds` and `legal_hold_covers()`, applied in SQL by every rule; `/v1/admin/legal-holds` (list, place, release with a reason); audited without a team so only platform admins and auditors see them. A conversation its user deletes under a hold is hidden from the user and kept; admins see the count on the hold.
  - **UI:** Administration → Retention (Periods, Dry run, Runs) and Administration → Legal holds (Active, Released, All); since v0.2.1 Legal holds is a fourth tab of Retention, with a Status filter.

### P4: break-glass (M4)
- A platform admin starts a time-boxed session (default 1 hour) with a reason to read a team's content (conversations or documents).
- A platform setting decides approval: by default one admin with a written reason; an install can require a second admin's approval before the session starts (DESIGN §18 item 5).
- Every read is audited with the session ID. The team owners are notified afterwards, and a banner shows during the session.
- **Built** (migration 00028, [ADR-0024](adr/0024-break-glass-scope-and-approval.md), runbook [`operations/break-glass.md`](operations/break-glass.md)):
  - **Sessions:** Admin → Break-glass starts one for a team with a reason (at least 20 characters), a scope (conversations, documents or both) and a duration (default 1 hour, at most the maximum setting). One open session per admin and team. The reading admin ends it early; any other platform admin can revoke it. The worker's `breakglass.sweep` records expiries and lapsed requests every minute; access stops at the end time regardless.
  - **Setting:** `break_glass_settings` (own one-row table, like maintenance mode): approval required (off), longest session (8 hours), request timeout (1 hour). With approval on, another platform admin approves (the time starts then) or denies with a reason; self-approval is refused.
  - **Reads:** `internal/authz` holds the grant rules; `sources` and `agents` ask `breakglass.Authorize` on every read by a non-member, which records `breakglass.read` (session ID, kind, target, never content) before the content is fetched. Documents are read through the normal source pages and routes; conversations through `GET /v1/teams/{team}/conversations` (break-glass only) and `GET /v1/conversations/{id}`, shown in a read-only conversation reader. No writes, exports or other pages.
  - **Notifications:** `breakglass.started` and `breakglass.ended` (with kinds and counts) reach the team's owners and can't be turned off; `breakglass.requested` and `breakglass.decided` reach platform admins.
  - **UI:** the admin's banner (time left, End now), the owners' notice on team pages, the session list with read logs, and the settings. API: `/v1/admin/break-glass…`, `/v1/admin/settings/break-glass`, `/v1/me/break-glass`, `/v1/teams/{team}/break-glass`.

### P6: dashboards and alerts (M5)
- **Metrics:** request rate, errors and latency per route group; chat time to first token and total; retrieval latency; model calls, errors and 429s per connection; queue depth and job age per kind; ingest throughput; crawl errors; moderation blocks; SystemOne latency; Postgres pool and Valkey health.
- **Dashboards:** Grafana JSON in `deploy/observability/dashboards/` (API, chat and retrieval, ingest and jobs, models and moderation).
- **Alerts:** rules in Prometheus format (`deploy/observability/alerts/`), usable by Prometheus, Mimir or Grafana. They cover API error rate and latency SLO burn, jobs stuck or failing, a model connection failing, a backup that didn't run, a certificate expiring, and the disk.
- **Home:** the home cluster already runs Mimir, Loki and Alloy. The overlay adds scraping and loads the dashboards and rules into the existing Grafana.
- **Built** (no migration; [`operations/monitoring.md`](operations/monitoring.md), runbooks [`operations/alerts.md`](operations/alerts.md)):
  - **Metrics** (`internal/observability`, bounded labels, never IDs): HTTP metrics gain a `group` label (ops, chat, public, openai, admin, auth, api, ui); chat answers, time to first token and total by channel; retrieval per KB search; model requests, outcomes (429 `rate_limited`, the connection's own `throttled`, error kinds) and latency per connection name and model kind (a gateway client hook set by the catalog; admin tests and doctor aren't counted); SystemOne per feature; moderation decisions by stage; River jobs by kind and outcome (worker middleware); document outcomes, embedding batch sizes, crawl pages; break-glass transitions and reads; Valkey errors (a go-redis hook); `grounded_build_info` with the mode; the Postgres pool; and, in worker processes at scrape time, queue depth and oldest waiting and running job per kind, maintenance mode and open break-glass sessions (`grounded_state_up`).
  - **Dashboards:** Overview (availability, p95, 30-day error and latency budgets, burn rates), API, Chat & retrieval, Ingest & jobs, Models & moderation; data source via `${DS_PROMETHEUS}`, a `namespace` filter.
  - **Alerts:** 23 alerts and SLO recording rules: multi-window burn rates (99.9% of requests not 5xx; 95% of non-streaming requests within 1 s), API or worker down, chat answers failing, jobs failing, discarded or stuck, queue backlog, retention, maintenance mode over 4 hours, a model connection failing or rate limited, the Postgres pool, Valkey, the pg_dump CronJob (kube-state-metrics) and volumes (kubelet). Certificate expiry is left to the ingress controller. `promtool test rules` unit tests.
  - **Kubernetes:** `components/alerts` (PrometheusRule; also loadable into Mimir by Alloy's `mimir.rules.kubernetes`) and `components/dashboards` (sidecar ConfigMaps), generated by `tools/obsgen`. `make obs-validate` (promtool, pinned; in CI) checks rules, dashboards and the generated components; Go tests check every expression against the exposed metric names.

### P7: load tests and restore rehearsal (M5)
- **Load tests:** k6 scripts in `deploy/loadtest/` for chat (fake-model and real-model modes), retrieval, uploads and crawls, run at 2× the DESIGN capacity estimates.
- **Results** go in `docs/benchmarks/load.md`, with the home hardware stated.
- **Restore rehearsal:** restore a `pg_dump` and the RustFS bucket into a scratch namespace, check the app against it, and time it (RTO). It's written up as `docs/operations/restore.md`.
- **Built** (no migration; [`benchmarks/load.md`](benchmarks/load.md), [`operations/restore.md`](operations/restore.md)):
  - **Load tests:** k6 in `deploy/loadtest/`, run with the digest-pinned `grafana/k6` image by `make k8s-load`. It runs on a kind cluster of `deploy/kubernetes/test/load` (2 api, 2 worker, `postgres-single`, and `grounded demo --serve-fake-models` with `--fake-word-delay` so answers stream like a model). `setup.js` prepares team `load` with raised limits through the API. Scenarios: chat over SSE, retrieve, OpenAI-compatible, uploads to ready, and a mixed day at 2×. All passed with no errors.
  - **Found and fixed:** ingest ran in 5-second bursts (dispatch kicks dropped while a dispatch ran). A finishing document now refills its slot in its commit transaction: 279 to 2,401 documents/min.
  - **Open:** retrieval is bound by Postgres CPU (about 45/s at 2 CPUs; the target is 5/s); full-text cost grows with matching chunks; the pgx pool follows the node's CPU count.
  - **Not run:** real models and crawls: the scripts run against any install (`TARGET=url`), but that would load the GPU or someone else's site.
  - **Restore:** `components/backup-objects` (daily off-site bucket copy), restore Jobs in `deploy/kubernetes/restore/`, and `make k8s-restore-rehearsal`. The rehearsal backs up, deletes the Postgres PVC, the backups PVC and the bucket's contents, restores from the off-site copy and verifies: 46 s from stop to verified. The backup alerts cover the objects CronJob.

### P8: security package (M5)
`docs/security/` holds:
- a data-flow diagram (browser, API, worker, Postgres, S3, Valkey, the model gateway, OIDC, crawled sites);
- a controls list mapped to DESIGN §16;
- a dependency inventory (Go and npm, with the SBOM from CI);
- a threat model (STRIDE per boundary: tenant isolation, SSRF, prompt injection, widget origins, keys);
- the results of `govulncheck`, `npm audit` and a container scan.

**Built** ([`security/`](security/README.md)): `data-flow.md` (Mermaid diagram, 15 boundary flows, data at rest, who sees content), `controls.md` (DESIGN §16 mapped to code and tests), `threat-model.md` (STRIDE for tenant isolation, SSRF, prompt injection, widget origins and CSP, API keys and the pepper, OIDC, admin powers and break-glass, supply chain; findings M5-1 to M5-5), `dependencies.md` (the BuildKit SBOM and provenance and how to read them; direct Go and npm dependencies with licenses from `make deps-inventory`; MPL-2.0 River and the OFL-1.1 Inter font noted; scan results: govulncheck and npm audit clean, Trivy image clean apart from a `tzdata` data update, misconfiguration findings reviewed). Found and fixed: personal API keys reached every transcript of their user (M5-1); CI's test job used unpinned actions (M5-2). Open: `/metrics` is reachable through the generic Ingress (M5-3, low).

### Test coverage (M2 and M5, added 2026-09-27)
- **Kind smoke test in CI (M2).** `make k8s-smoke` runs on every push to `main`, alongside the manifest checks.
- **Coverage report (M2).** CI runs the Go suite with coverage across `internal/...` (unit and integration together), publishes the total and a per-package table in the job summary, and uploads the profile. The report is a guide, not a gate.
- **End-to-end browser tests (M5).** A Playwright suite runs in CI against a real server, with dev sign-in and the fake model gateway. It covers:
  - sign-in and the workspace shell;
  - a team with an upload source, a KB and an agent, then a streamed chat with citations;
  - Team settings;
  - the admin Overview, Logs and Limits;
  - maintenance mode;
  - the public page and the widget on an allowed origin.
  It runs `@axe-core/playwright` on every page it visits, as DESIGN §15 promises.
  **Built** (no migration; [`web/README.md`](../web/README.md), "End-to-end tests"): `web/e2e`, run by `make e2e` and the CI `e2e` job, which gates the image. [`tools/e2eserver`](../tools/e2eserver/main.go) runs `grounded serve` on its own database (`grounded_e2e`, dropped afterwards) with the fake model gateway; specs arrange their own teams through the API and run in parallel, and maintenance mode runs after them on its own. Besides the list above, it covers ⌘K navigation, feedback, API keys, the audit log's record sheet, retention's dry run, legal holds, break-glass, the widget's refusal on another origin and what members and non-staff can't open. A shared fixture fails a test on any axe violation (WCAG 2.1 A/AA), on a visited page it never checked, or on an uncaught page error.
- **Authorization matrix (M5).** A Go test generated from `api/openapi.yaml`. For every route, it checks each role (anonymous, member, editor, owner, auditor, platform admin, a scoped API key) against resources in the caller's own team and in another team, and asserts the expected status (200/201/204, 401, 403 or 404, never another team's data). New routes fail the test until they're classified. It's part of the security package (P8).
- **Upgrade-test harness (M5).** A CI job starts the previous release's image against a database, loads fixture data, then runs the new image's migrations and a smoke check (old and new code against the migrated schema, per expand/contract). It's in place for v0.1.0 and first compares releases at v0.2.0.

**Built (M5):** the authorization matrix is `internal/httpapi/authz_matrix_*` (every operation × anonymous, member, editor, team admin, owner, platform admin, auditor, personal keys per scope, a service key and a publishable key; own team and another team's objects; leak checks for the other team's names, IDs and content; `TestAuthzMatrixClassifiesEveryOperation` fails for unclassified routes without a database; `TestAuthorizationMatrixBreakGlass` repeats the team and per-user routes as the admin under each break-glass scope). The upgrade test is `make upgrade-test` (`deploy/kubernetes/scripts/upgrade-test.sh`, CI job `upgrade` on `main` after the image is published; [`operations/upgrades.md`](operations/upgrades.md) has the expand/contract rules).

### F6: demo mode (M6)
- **`grounded demo`** seeds a neutral install:
  - a "Demo" team;
  - a web source over the Go documentation (`https://go.dev/doc/`, about 100 pages; `go.dev` added to the crawl allowlist by the demo);
  - a KB and two agents, one team and one public.
- It's idempotent, and refused unless the install is empty or `--force` is given.
- **Model modes:** with the fake model (a local demo with no model keys), or with real connections given by flags.
- **Screenshots** for the README come from it.

**Built** (no migration; [`demo.md`](demo.md)): `internal/demo` calls the services as the owner (the bootstrap admin, `admin@localhost` with `DEV_AUTH`, or the only platform admin; `--owner-email` otherwise), so every object is validated and audited as in the UI, plus one `demo.seed` system entry. It refuses a non-empty install without `--force`, never changes existing data, records its team in `bootstrap_state` (`demo_seed`) and adds only what is missing on later runs; `--force` adds nothing when another team already uses the `demo` slug. Both agents ("Go docs assistant", team; "Go docs (signed-in)", `all_authenticated`) are published with welcome messages and starter questions; the plan's "public" agent is signed-in only, because publishing to the public needs the platform switch and a moderation provider, which a fresh install doesn't have. Models: `--models=fake` uses a fake gateway built into the binary (`grounded demo --serve-fake-models`: hashed bag-of-words embeddings, canned answers that quote the retrieved passages under a "Demo model" label); `--models=openai-compatible` creates connections, models, an embedding profile (default only when it is the first) and optionally a SystemOne model from `--chat-*`/`--embed-*` flags or `DEMO_*` variables; without `--models` the install's own models are used. [`compose.demo.yaml`](../compose.demo.yaml) (`make demo`) runs Postgres, Valkey, `grounded serve` with development sign-in on loopback, and the `demo` service seeding and serving the fake models.

### P9: release and going public (M6)
- **Release workflow:** `v0.1.0` tag, then the GitHub release with notes, images pinned by digest, the SBOM and cosign signatures.
- **README:** what Grounded is, screenshots, a quick start (compose and Kubernetes), and the project status.
- **Fresh public history:** one initial commit. The current history goes to a private archive repository.
- **GitHub settings:** private vulnerability reporting, branch protection on `main` (CI required), Dependabot alerts and updates, secret scanning with push protection, and topics and description.
- **Packages:** the ghcr package becomes public.

## 6. How the work is run

- **Milestones in order.** Within one, independent parts run as parallel agents in git worktrees, as before. Everything is merged with tests, lint and generate clean, and deployed to the reference install before the next milestone.
- **Checkpoints:** each milestone ends with a short report and screenshots for you.
- **GitOps changes** for the reference install go on a branch for the owner to merge; identity-provider changes are OpenTofu files the owner plans and applies; secret-store writes need the owner's login.
- **Cluster access** is read-only (checks, logs and port-forwards). Nothing is applied or deleted by hand; Flux applies everything.

## 7. Risks

- **Model latency on one GPU.** The one GPU box serves chat at about 14 s per answer (Qwen3.8-27B, thinking off) and SystemOne at about 0.7 s per request, one at a time. Load tests with real models will be slow; the fake-model mode measures Grounded itself.
- **NFS for Postgres.** It's fine for a homelab, but not for the HA target. The load-test numbers will reflect it.
- **Fresh public history** loses the per-commit history on GitHub. The private archive keeps it.
- **Scope.** M4 and M5 are the largest. If time matters, v0.1.0 could ship after M3 and M6, with M4 and M5 as v0.2.0 (the earlier "split" option). You chose the full path; that choice stands unless you change it.

## 8. Not in Phase 5

The rest of the roadmap: evaluation sets (A2), reranking (A1b), SSO group mapping (E1), cost reporting (E2), OCR (B4), MCP and bots (C1, D1), and so on. They're chosen after v0.1.0.

## 9. Owner decisions (2026-09-27)

1. ~~**Chat model on the reference install.**~~ Decided: the one GPU box only (chat, embeddings, SystemOne); see §4.
2. ~~**SMTP.**~~ Decided: in-app only for now; SMTP can be added later as settings plus a `grounded-smtp` secret.
3. ~~**Break-glass approval.**~~ Decided: a platform setting. The default is one admin with a written reason; an install can require a second admin's approval.
4. ~~**Backups off the NAS.**~~ Decided: none for now. The reference install's backups stay on the same NAS, an accepted risk stated in its overlay's README. The generic `backup-pgdump` component still supports copying to an off-site S3 target for other installs.
5. ~~**Demo content.**~~ Decided: the Go documentation (`go.dev/doc`), capped at about 100 pages. Grounded's own docs are added as a second source after the release.
6. ~~**Public agents on the reference install.**~~ Decided: sign-in only for now. Public access is one admin switch, to be turned on later once load tests show what the GPU box can take.
