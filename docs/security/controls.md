# Controls

The security controls of Grounded as built, grouped by the items of DESIGN §16, with where each is implemented and which tests check it. Paths are in this repository; tests run in CI on every push (`make test`, with Postgres, Valkey and S3).

## Access control and tenant isolation

| Control | Implemented in | Tested by |
|---|---|---|
| Roles: platform (admin, auditor) and team (owner, admin, editor, member), rules as pure functions | `internal/authz/authz.go`; each service checks inside the transaction that makes the change | `internal/authz/authz_test.go`; `teams_integration_test.go` (`TestTeamLifecycleAndMembership`, `TestPlatformUserAdministration`, …) |
| **Authorization matrix:** every operation in `api/openapi.yaml` called by 12 kinds of caller (anonymous; member, editor, team admin, owner; platform admin; auditor; personal keys with each scope; a service key; a publishable key) on their own team and on another team's objects. Expected status per cell; responses to another team's objects must be 401/403/404 and never contain that team's names, IDs or content; nothing denied may change anything | `internal/httpapi/authz_matrix_*` (classification tables in `authz_matrix_policy_*_test.go`) | `TestAuthorizationMatrix` (210 operations, about 3,300 calls); `TestAuthzMatrixClassifiesEveryOperation` fails for any route not classified, without a database, so new routes can't skip it; `TestRoutesMatchOpenAPI` keeps the spec and the served routes identical |
| Non-members get 404 for a team's objects (no existence oracle) | Team access helpers (`internal/teams`) | The matrix (foreign-team cells) |
| API keys: bound to one team; scopes `query`, `ingest`, `manage` acting as member, editor and admin on the routes that accept keys; KB and agent restrictions; expiry; never platform administration; revoked when the user leaves the team | `internal/apikeys`, `internal/httpapi/keyauth.go`, `authz.KeyGrant` | Matrix key columns; `TestAPIKeysAndPermissions`, `TestAgentChatWithAPIKeys`, `TestAPIKeyAgentRestrictionAndContact`, `TestPersonalKeyConversationsStayWithinTheKey` |
| Admins have no content access by default | `sources` and `agents` services refuse non-members' content reads unless `breakglass.Authorize` grants them | Matrix (platform admin and auditor cells), `TestBreakGlassDocumentsAndConversations` |
| **Break-glass:** one admin, one team, `documents` and/or `conversations`, time-boxed (default 1 h, maximum a setting), reason ≥ 20 characters, optional second-admin approval (no self-approval), every read audited with the session ID before content is fetched, owners notified at start and end, revocable | `internal/authz/breakglass.go`, `internal/breakglass`, [ADR-0024](../adr/0024-break-glass-scope-and-approval.md), [runbook](../operations/break-glass.md) | `internal/authz/breakglass_test.go`; `breakglass_integration_test.go`; `TestAuthorizationMatrixBreakGlass` (every team and per-user operation as the admin with each scope: exactly the scope's reads open, on that team only, no writes, closed again after the end) |
| Transcripts are their user's alone; a personal key reaches them only with the query scope, for its team's agents within its restriction | `internal/agents/conversations.go` (`ownerOnly`, `keyReaches`) | Matrix per-user cells; `TestConversationPrivacyExportFeedbackAnalytics`; `TestPersonalKeyConversationsStayWithinTheKey` |
| Classification: model, audience and team ceilings, enforced at write time and again at query time | `internal/agents` (policy evaluation), `internal/kbs`, `internal/catalog` | `agents_policy_integration_test.go`, `classification_settings_integration_test.go`, `TestClassificationLevels` |
| Last active platform admin and last team owner can't be removed | `internal/platform`, `internal/teams` | `TestPlatformUserAdministration`, `TestConcurrentOwnerRemovalKeepsAnOwner` |

## Authentication and sessions

| Control | Implemented in | Tested by |
|---|---|---|
| OIDC authorization code with PKCE, state and nonce; issuer and audience checked; optional allowed email domains; users keyed by `(issuer, sub)`; first admin by exact `(issuer, sub)`, once | `internal/auth/oidc.go`, `login.go` | `TestOIDCLoginFlow`, `TestOIDCRejections`, `TestOIDCCallbackRequiresMatchingState`, `TestOIDCOpenRedirectBlocked`, `TestBootstrapRoleIsGrantedOnlyOnce` |
| Server-side sessions (Postgres), `HttpOnly` `SameSite=Lax` cookies, `Secure` on HTTPS; CSRF token and same-origin `Origin` on every write; suspended users cut off at once | `internal/auth/auth.go` | `TestDevLoginSessionAndCSRF`, `TestSuspendedUserIsBlocked` |
| Sign-in attempts rate-limited per client IP | `auth.admitLogin` | (limit configurable: `LOGIN_ATTEMPTS_PER_MINUTE`) |
| Development sign-in only with `DEV_AUTH` and a loopback `APP_URL` | `internal/auth/dev.go`, `internal/config` | `TestDevLoginDisabledOutsideDevAuth`, `TestSafetyChecks` |

## Public agents and the widget

| Control | Implemented in | Tested by |
|---|---|---|
| The anonymous API is `/v1/public/*` only and refuses credentials; writes from Grounded's own origin only | `internal/httpapi/public.go` | Matrix (public cells), `TestAnonymousPublicChatAndRetention` |
| Public access is one platform switch; public agents need a moderation provider; audience ceilings per classification | `internal/agents` (audience), `internal/public` | `publishing_integration_test.go` |
| Publishable keys: one agent, allowed origins (exact or `https://*.domain`), stored as peppered hashes, rate limits per key | `internal/public/keys.go`, `origins.go`, `keyadmin.go` | `internal/public/public_test.go`, `TestWidgetEmbedAndGuardrails`, `TestWidgetCheck` |
| Embed page CSP `frame-ancestors` from the key's origins; `X-Frame-Options: DENY` everywhere else; `widget.js` served with an integrity hash for the snippet | `internal/httpapi/embed.go`, `spa.go`, `middleware.go` | `TestWidgetEmbedAndGuardrails`, `spa_test.go` |
| Anonymous sessions: random tokens stored hashed, IP kept as /24 (IPv4) or /48 (IPv6), per-IP and per-agent rate limits and daily caps that fail closed when Valkey is down, optional CAPTCHA | `internal/public/service.go`, `guard.go`, `internal/captcha` | `internal/public/guard_test.go` (`TestGuardFailsClosed`), `TestAnonymousPublicChatAndRetention` |
| Moderation of input and output (block, retract, withhold), buffered answers for public agents, fail-closed option | `internal/moderation`, `internal/agents/moderate.go` | `moderation_integration_test.go` |

## Specific threats

| Control (DESIGN §16) | Implemented in | Tested by |
|---|---|---|
| **SSRF-safe crawler:** public unicast addresses only (private, loopback, link-local, CGNAT, metadata, documentation and translation ranges refused), checked for every hop (pages, robots.txt, sitemaps, redirects) and pinned at dial time against DNS rebinding; the crawl allowlist and domain requests; robots.txt | `internal/crawl/guard.go`, `fetch.go`, `internal/web` | `internal/crawl/fetch_test.go` (`TestSSRFLiteralAddresses`, `TestSSRFResolvedAddresses`, `TestSSRFDNSRebindingDialsApprovedIP`, `TestSSRFRedirectToPrivate`, `TestHostPolicyOnEveryHop`) |
| **Retrieved text is untrusted:** passages go to the model inside `<sources>` with a system instruction to treat them as data and never follow instructions in them; closing tags inside passages are escaped; citations are checked against the retrieved passages; optional SystemOne scope and citation checks | `internal/agents/prompt.go`, `citations.go`, `citecheck.go`, `scope.go` | `TestSystemPrompt`, `TestFormatSources`, `TestApplyCitations`, `systemone_checks_integration_test.go` |
| **API key secrets stored only as peppered hashes** (HMAC-SHA256 with `API_KEY_PEPPER`), shown once | `internal/apikeys`, `internal/public/keypepper.go`, `internal/secrets` | `TestPeppers`, `TestPepperRotation` |
| **Key rotation without downtime:** `grounded rotate-keys` re-encrypts stored secrets (resumable, audited, dry run); API and publishable keys re-hashed on next use with `API_KEY_PEPPER_PREVIOUS` | `internal/keyrotation`, `internal/secrets`, [runbook](../operations/rotate-keys.md) | `TestRotateEveryEncryptedColumn`, `TestRotateResumesAfterInterruption`, `TestRotateRefusals`, `TestEveryEncryptedColumnIsRegistered`, `TestPepperRotation` |
| **Stored secrets encrypted:** gateway, moderation and SMTP credentials with AES-256-GCM under `ENCRYPTION_KEY`, never returned by the API | `internal/secrets`, `internal/catalog` | `TestSealOpenRoundTrip`, `TestConnectionsStoreKeysEncryptedAndTest` |
| **Browser protections:** CSRF and `Origin` (above), CSP on the app, `nosniff`, `Referrer-Policy`, `X-Frame-Options` | `internal/httpapi/middleware.go`, `spa.go` | `spa_test.go`, `TestDevLoginSessionAndCSRF` |

## Data handling

| Control | Implemented in | Tested by |
|---|---|---|
| Retention per data kind, nothing deleted until a period is set (anonymous conversations aside), dry-run reports, bounded and audited runs | `internal/retention`, [runbook](../operations/retention.md) | `internal/retention/*_test.go` (`TestDefaultsKeepEverything`, `TestConversationsPerLevelAndDryRun`, `TestBoundedBatches`, …), `TestRetentionAndLegalHolds` |
| Legal holds stop every retention deletion of what they cover, never expire, and are audited | `internal/retention` (`legal_hold_covers()` in SQL) | `TestHoldsStopDeletion`, `TestHoldAdministration` |
| Audit log: append-only (a trigger rejects updates and deletes except the retention purge); actor, target, request ID, IP; break-glass reads recorded by kind and target, never content | `migrations/00001_identity.sql`, `internal/audit` | `TestAuditLogIsAppendOnly`, `audit_integration_test.go`, `TestBreakGlassDocumentsAndConversations` |
| Analytics for teams are aggregates and metadata only | `internal/analytics` | `analytics_integration_test.go` (`assertNoContentOrIdentities`) |

## Operation

| Control | Implemented in | Tested by |
|---|---|---|
| **Production safety checks (E7):** every process refuses to start off loopback with the example `ENCRYPTION_KEY` or `API_KEY_PEPPER`, with `DEV_AUTH`, or with a plain-http `APP_URL`; risky settings are warned about at start, on the admin Overview and by `grounded doctor` | `internal/config/safety.go`, `internal/preflight`, `internal/doctor` | `TestSafetyChecks`, `TestExampleKeyHashesMatchEnvExample`, `internal/preflight/preflight_test.go`, `TestDoctorHealthyInstall`, `TestDoctorFailures` |
| Maintenance mode pauses ingestion, keeps chat | `internal/platform` | `maintenance_integration_test.go` |
| Container: distroless static image, non-root (65532), no shell; Kubernetes base with a read-only root filesystem, all capabilities dropped, seccomp `RuntimeDefault`, default-deny NetworkPolicies | `Dockerfile`, `deploy/kubernetes/base` | `make k8s-validate` (kubeconform), `make k8s-smoke` (kind) |
| Zero-downtime upgrades: expand/contract migrations under an advisory lock | `internal/store`, [upgrades](../operations/upgrades.md) | `make upgrade-test` (CI job `upgrade` on `main`: old and new code against the migrated schema) |

## Supply chain

| Control | Where |
|---|---|
| `govulncheck` on every push (`make lint`) | `.github/workflows/ci.yml` |
| Images built in CI only, multi-arch, with an SBOM and max-mode provenance attestation (BuildKit), scanned by Trivy (fails on fixable HIGH and CRITICAL), signed keyless with cosign; deployed by digest | `.github/workflows/image.yml` |
| Every third-party GitHub Action pinned by commit SHA (the version in a comment) | `.github/workflows/ci.yml`, `image.yml` |
| Dependency inventory with licenses, regenerated by `make deps-inventory` | [`dependencies.md`](dependencies.md) |
| Web dependencies installed with `npm ci --ignore-scripts` (no install scripts run) | `Makefile`, `Dockerfile`, CI |
