# Changelog

All notable changes to Grounded are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before 1.0, minor releases may include breaking changes; the release notes say how to adapt.

## [Unreleased]

Work towards v0.2.0 ([`docs/v0.2.0.md`](docs/v0.2.0.md)). The release notes are drafted in [`docs/releases/v0.2.0.md`](docs/releases/v0.2.0.md).

### Added
- The command palette (⌘K) finds objects by name on the server (`GET /v1/search`, E15): the agents, knowledge bases and data sources of all your teams (no longer only the first ten), agents you may chat with, and your own conversations by title; platform admins and auditors also find teams, users, models, connections, embedding profiles and shared sources, which open their admin pages. Results are ranked by how the name matches (prefix, word start, anywhere) and only include what the caller may see. A migration adds trigram indexes for the searched names.
- SSO group mapping (E1): platform admins map an identity-provider group to a team role under **Admin → Group mapping** (and a team's **Group mapping** tab). At each OIDC sign-in the groups claim (`OIDC_GROUPS_CLAIM`, default `groups`) adds members or raises their role, and lowers or removes the memberships the mapping created; memberships added by hand are never changed, the highest role wins, and a team's last owner is kept. A dry run shows who a rule change affects, from each person's groups at their last sign-in; saving applies it at once. Every change is audited with the system as the actor. Owners see "Managed by SSO group X" and can't remove such members by hand. `DEV_AUTH_GROUPS` gives development personas groups; `grounded doctor` warns when rules exist but no sign-in carries the claim. Runbook: [`docs/operations/sso-groups.md`](docs/operations/sso-groups.md). Migration `00032_sso_group_mapping.sql`.
- `GET /v1/teams/{team}/api-keys/{keyId}` returns one API key, including a revoked one (`revokedAt`), for team admins and the key's owner. An audit-log entry about a key links to its record page (`?tab=api-keys&record=<id>`), which now loads a revoked key by id and shows it read-only; before, the link led to the list, which hides revoked keys.
- Release assets: each GitHub Release has the image's SPDX SBOM per platform (`grounded-<tag>-linux-amd64.sbom.spdx.json` and `-linux-arm64`), `grounded-<tag>.digest.txt` and a `checksums.txt` (SHA-256), next to the image attestations. The release fails clearly if the image has no SBOM or an upload fails.

### Changed
- `CONTRIBUTING.md` has a Dependabot triage policy: routine weekly grouped updates are merged in a batch at each milestone with CI green, and security updates are merged promptly.
- CI: the authorization matrix (`TestAuthorizationMatrix*`, about 3,600 calls under `-race`) runs in its own `authz` job, in parallel with `test`, which skips it (`make test SKIP_AUTHZ=1`; `make test-authz` runs it alone). The image job needs both. The matrix and its break-glass pass run in parallel with each other, each on its own database.
- `cmd/sparkbench` reads citation markers with `internal/agents` (exported `CitedNumbers`, `RemoveMarkers`, `IsRefusal`) instead of its own copy of the old pattern, so benchmark scores count markers exactly as the product does (never inside code or array indices).
- CI: a tag build fails, before the image is scanned and signed, unless the built image reports exactly its tag (`grounded v0.2.0 (<commit>)`).

### Fixed
- A crawl waiting for the next day's page quota (`crawl_pages_per_day`) resumes as soon as a platform admin raises the limit, through a team override or the platform default, instead of at midnight UTC. A waiting crawl also re-checks its limit every 15 minutes.
- Removing someone from a team (or leaving it) marks their unread "You were added to ..." and role-change notifications for that team read; they led to a page the person can no longer open.
- Release images take the full git tag as their version: v0.1.0's binary reported `v0.1`.
### Fixed
- A deleted agent's conversations open read-only (`/conversations/<id>`): the transcript with a note that the agent was deleted, and no composer, instead of "Agent not available" (G2).
- The answer feedback thumbs show which one you chose: both are toggle buttons (`aria-pressed`), and the chosen one has a primary tint and a filled icon (G16).
- An agent's default accent colour is the theme's primary colour everywhere: Appearance no longer names `#0021a5` (a leftover from a removed institution theme), its first quick pick is the theme's indigo, and the widget's launcher uses the same default (G17).
- The widget key form opens with `?form=new` (and `?form=<id>` to edit), like every other form page, instead of `?record=` (G18).
- Adding an embedding profile for a model with known prefixes fills them in (nomic-embed: `search_document: ` / `search_query: `; Qwen3-Embedding: its query instruction), and warns with a "Use the recommended prefixes" button when they're emptied (G7).

## [0.1.0] - 2026-09-28

The first release. It covers the design's Phases 0 to 5. The release notes are in [`docs/releases/v0.1.0.md`](docs/releases/v0.1.0.md).

Development before this release happened in a private repository. The public repository starts from a single commit, and the full pre-release history is kept in a private archive.

### Added

#### Foundation (Phase 0)
- `grounded`, a single Go binary with an embedded React UI. Its subcommands are `serve` (API and worker in one process), `api`, `worker`, `migrate`, `parse` and `version`.
- Configuration from environment variables, optionally layered over a YAML file (`GROUNDED_CONFIG_FILE`), with `*_FILE` variants for secrets.
- Instance identity settings (`INSTANCE_NAME`, `ORG_NAME`, `UI_LOGO_URL`, `SUPPORT_URL`, `TEAM_REQUEST_URL`) and a one-time crawl allowlist seed (`CRAWL_ALLOWLIST_SEED`).
- OIDC sign-in with an email-domain restriction, and development sign-in for loopback installs only. The first platform admin is set by OIDC subject (`BOOTSTRAP_ADMIN_SUBJECT`).
- Users, teams, members with owner, admin, editor and member roles, and email invites that expire. Platform admin and platform auditor roles.
- A user portal and an admin portal, with a switcher between them and a command palette.
- Model connections to any OpenAI-compatible gateway, catalog models (chat, embedding, moderation and SystemOne) with compatibility flags, and embedding profiles.
- Data classification levels (Open, Sensitive and Restricted by default, configurable). Each level has model ceilings and audience ceilings, which are enforced on every change and again on every query.
- An append-only audit log for platform and team changes, with readable entries, diffs and filters.
- Migrations embedded in the binary that run under an advisory lock.

#### Ingest and retrieval (Phase 1)
- Upload sources for PDF, DOCX, PPTX, HTML, Markdown and text files. The built-in parsers include PDFium in WebAssembly, and Apache Tika is an optional fallback.
- An ingestion pipeline: heading-aware chunking measured in tokens, cross-document embedding batches that respect each connection's request limit, and retries.
- A pgvector store (`halfvec`, one table per embedding profile) that searches small knowledge bases exactly and uses HNSW with iterative scans above a threshold.
- Knowledge bases with hybrid vector and keyword retrieval, tunable fusion weights (with defaults per embedding profile), metadata filters and citations. Knowledge bases can also be searched directly through the API (`POST /v1/teams/{team}/kbs/{kbId}/retrieve`).
- Personal and team service API keys, scoped, optionally restricted to agents, and stored as peppered HMAC digests.
- Limits per team with platform defaults and ceilings, and a usage ledger per team, user, agent and key.
- S3-compatible object storage for original files and parsed text, with a filesystem backend for development.

#### Web and shared sources (Phase 2)
- A native web crawler that can scrape a page, fetch a list of pages, crawl a site or map one. It follows sitemaps and robots.txt, paces requests per site, re-syncs on a schedule, removes pages that disappear, and can re-fetch a single page.
- An SSRF guard that always refuses private, loopback and link-local addresses and ports other than 80 and 443.
- An admin crawl allowlist with wildcards, and domain requests from teams.
- Platform-shared sources that any team can attach to its knowledge bases.
- Repeated-boilerplate suppression: text that repeats across many pages of a source (navigation, footers) is left out of search and can be switched off per source.
- Classification impact checks that name the agents and models affected before a source's classification is raised.

#### Agents (Phase 3)
- Agents with drafts, immutable published versions, and a comparison of any two versions.
- Chat streamed over SSE, with retrieval before every answer (`always`) or as a tool the model calls (`tool`), several knowledge bases per agent, query rewriting, and optional reasoning.
- Strict grounding, on by default: an agent answers only from its sources, and gives the team's refusal message when the sources contain nothing relevant.
- Numbered citations with snippets, heading paths, pages and source URLs.
- Private conversations with paging, export (Markdown or JSON) and deletion, plus feedback on answers.
- An OpenAI-compatible endpoint: each agent is a model (`agent:{team}/{agent}`) on `POST /v1/chat/completions`, streamed or not.
- Team analytics without message content, an access log, and a platform kill switch for agents.
- An AI runtime (provider client, streaming events, agent loop and tools) with support for self-hosted servers such as vLLM and SGLang: `extraBody`, embedding output dimensions and reasoning tokens.

#### Publishing (Phase 4)
- Two more audiences: everyone who signs in (listed in an agent directory) and the public. Agents can have admin-assigned short names and pages that work without the app shell.
- Pluggable moderation with four provider kinds: OpenAI-compatible `/moderations`, guardrail models, chat models used as classifiers, and SystemOne models. Policies are set per audience with agent overrides. Moderation is required for public agents and fails closed.
- Anonymous public chat with short-lived sessions.
- An embeddable iframe widget with publishable keys, allowed origins (`frame-ancestors`) and optional CAPTCHA (Cloudflare Turnstile).
- Public guardrails: per-IP and per-session rate limits, daily query and token caps per agent, concurrency limits, and a platform-wide public switch.
- Notifications in the app (a bell, an inbox and per-user settings) and by email over SMTP.
- Analytics dashboards for platform admins and auditors, with audience and moderation breakdowns and a CSV export.
- Optional SystemOne models for passage judging (re-rank, keep conflicting passages apart, drop injections), citation checks (annotate or enforce), and scope checks for small talk and off-topic questions. All are off by default.

#### Deploy and harden (Phase 5)
- A generic Kubernetes Kustomize base, optional components (single Postgres or CloudNativePG, Valkey, `pg_dump` backups, Ingress, Apache Tika, monitoring, alerts, dashboards, private registry) and example overlays (`example-small`, `example-ha`). `make vendor-k8s` renders the base into a GitOps repository.
- Container images published to `ghcr.io/ncecere/grounded` for linux/amd64 and linux/arm64, with SBOM and provenance attestations and cosign keyless signatures.
- `grounded doctor`, which checks the configuration and every dependency (Postgres, Valkey, object storage, the OIDC issuer and each model connection). It reports timings for each phase and names the cause of connection failures.
- `grounded rotate-keys`, which rotates `ENCRYPTION_KEY` and `API_KEY_PEPPER` without downtime.
- Maintenance mode, which pauses ingestion and crawls while chat, retrieval and reads keep working.
- Profile migration, which moves a knowledge base to a new embedding profile in the background. The switch happens in one step, and you can switch back during a grace period.
- Retention jobs with configurable periods for each kind of data, a dry-run report and recorded runs. Legal holds on users, teams, agents and conversations stop deletion.
- Break-glass: time-boxed, read-only access to one team's conversations or documents, with an optional second-admin approval. Every read is audited, and the team's owners are notified.
- Prometheus metrics grouped by route, model connection, job kind and feature. Five Grafana dashboards, 23 alerts with runbooks, and SLO burn-rate rules, with `make obs-validate` to check them.
- `grounded demo`, which seeds a sample Demo team over the Go documentation using fake or real models, and `compose.demo.yaml` (`make demo`) to try Grounded with Docker only.
- Load tests with k6 at twice the design estimates (`make k8s-load`) and a timed restore rehearsal (`make k8s-restore-rehearsal`) on throwaway kind clusters; the `backup-objects` component copies the bucket off-site daily, and restore Jobs rebuild Postgres and the bucket ([`docs/operations/restore.md`](docs/operations/restore.md)).
- A Playwright end-to-end suite with axe on every page it visits, an authorization matrix that tests every API route against every kind of caller, a kind smoke test of the manifests, an upgrade test between versions, and a coverage report in CI.
- Documentation: the Kubernetes guide, runbooks for operations, the security package (data flow, controls, threat model, dependency inventory), deployment profiles, and benchmark reports.

### Security
- Every process refuses to start on a non-loopback URL with the example `ENCRYPTION_KEY` or `API_KEY_PEPPER`, with development sign-in on, or with a plain-HTTP `APP_URL`. Risky but allowed settings are shown to platform admins and printed by `grounded doctor`.
- Gateway, SMTP and moderation secrets are stored encrypted (AES-256-GCM). API keys are stored only as peppered digests. Both secrets can be rotated.
- Platform admins have no access to team content outside an audited break-glass session. Conversation transcripts are readable only by their owner.
- Browser sessions use CSRF tokens and Origin checks. The widget is limited to allowed origins, and public chat is rate limited and moderated.
- Retrieved text is treated as untrusted, and optional SystemOne passage judging drops prompt injections.
- Hardened Kubernetes defaults: non-root, a read-only root filesystem, no capabilities, seccomp `RuntimeDefault`, no service account token, default-deny NetworkPolicies, and the `restricted` Pod Security Standard.
- Supply chain: CI builds images from actions pinned by commit SHA and scans them with Trivy (fixable HIGH and CRITICAL findings fail the build). `govulncheck` runs on every push.
- Fixed before release: personal API keys could reach every transcript of their user across teams. They are now limited to their team, scope and agent restriction (found by the authorization matrix).
- Fixed before release: `/metrics` was reachable through the generic Ingress. The API now serves metrics on an internal listener (`METRICS_ADDR`, `:9091` in the Kubernetes base).

### Changed
- Records (documents, keys, audit entries, models, connections, holds, sessions, agent versions, domain requests) open as pages of their own over their list, and long create and edit forms are pages too; short forms stay in dialogs. There are no side sheets. Each page has a back link and a breadcrumb, can be linked to, and closes with Back.
- Every list shares one filter row (search, filters, then Columns), page header actions line up with the title, sizes use IEC units (KiB, MiB, GiB) everywhere, and the layout fits a phone-width screen.
- Ingest refills free worker slots as each document finishes, instead of in 5-second bursts: 8.7× the throughput in the load test.
- The product is named Grounded (Go module `github.com/ncecere/grounded`, binary `grounded`). It was renamed from its working names, so cookies, metric prefixes and gateway tags use the new name ([ADR-0022](docs/adr/0022-name-grounded.md)).
- Grounded is institution-neutral. Defaults, examples, UI text and test data name no institution, and each install supplies its own identity through configuration ([ADR-0018](docs/adr/0018-open-source-institution-neutral.md), [ADR-0023](docs/adr/0023-no-institution-data-in-the-repository.md)).
- Break-glass can include conversation transcripts (in scope with the conversations scope), and approval by a second admin is a platform setting ([ADR-0024](docs/adr/0024-break-glass-scope-and-approval.md), amending ADR-0010 and ADR-0011).
- Retention: deleting a document or source now removes its passages and vectors at once, but its stored files are kept until the deleted-files retention period (and any legal hold) allows deletion.


### Fixed
- Profile migrations and retention runs no longer hold a pooled database connection for their lock: with a small pool (4 connections on a 2-CPU host) several embedding jobs could each hold one and wait for another, stalling until their 15-minute timeout. Ingest reads the maintenance state before opening its commit transaction for the same reason. CI now runs the tests with a 3-connection pool.
- "Send request" in the domain-request dialog opened from a new website source no longer loses the request.

[Unreleased]: https://github.com/ncecere/grounded/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ncecere/grounded/releases/tag/v0.1.0
