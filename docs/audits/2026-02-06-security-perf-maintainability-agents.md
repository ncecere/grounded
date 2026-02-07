# 2026-02-06 Security, Dependency, Performance, Maintainability, and Agent Configuration Audit

## Scope
- Repository: `/Users/nickcecere/Projects/WEB/KCB`
- Includes current working tree changes.
- Focus: security hardening, dependency risk, runtime performance, maintainability guardrails, and public AI agent access paths.

## Severity Model
- `P0`: immediate exploitation or auth bypass risk.
- `P1`: high-impact weakness with practical abuse path.
- `P2`: moderate risk/performance debt.
- `P3`: low risk/cleanup debt.

## Implemented Remediations

### P0 Security
- Added markdown HTML sanitization before `dangerouslySetInnerHTML` in:
  - `apps/web/src/pages/chat/ChatMessageBubble.tsx`
  - `packages/widget/src/components/Message.tsx`
- Migrated vulnerable spreadsheet parser path away from `xlsx` to `exceljs` in:
  - `apps/api/src/services/upload-helpers.ts`
  - Removed `xlsx` dependency from `apps/api/package.json`
- Added hardened `.pptx` extraction with size/entry guards and XML text-only parsing:
  - `apps/api/src/services/upload-helpers.ts`
  - `apps/api/src/services/upload-helpers.test.ts`
- Result: `bun audit` now returns no known vulnerabilities.

### P1 Security and Public Endpoint Policy
- Implemented deterministic token hashing helpers and constant-time token comparison utilities:
  - `apps/api/src/services/public-token-security.ts`
- Added DB fields and indexes for hash-based lookup and migration compatibility:
  - `packages/db/src/schema/agents.ts`
  - `migrations/0028_public_token_hashing.sql`
- Completed plaintext token column removal with guarded migration checks:
  - `packages/db/src/schema/agents.ts`
  - `migrations/0030_remove_public_token_plaintext.sql`
- Dual-write token metadata (`token_hash`, `token_prefix`) on token creation:
  - `apps/api/src/modules/agents/service.ts`
- Switched new token issuance to hash-only at rest with one-time reveal + preview metadata:
  - `apps/api/src/modules/agents/service.ts`
  - `apps/api/src/routes/agents.ts`
  - `apps/web/src/lib/api/types/agents.ts`
  - `apps/web/src/components/agents/tabs/WidgetTab.tsx`
  - `apps/web/src/components/agents/tabs/ChatApiTab.tsx`
- Hash-only + constant-time token validation for widget and chat endpoints:
  - `apps/api/src/services/widget-chat-helpers.ts`
  - `apps/api/src/routes/chat-endpoint.ts`
- Removed plaintext-token runtime fallback and now enforce hash-only token lookup:
  - `apps/api/src/services/widget-chat-helpers.ts`
  - `apps/api/src/routes/chat-endpoint.ts`
- Added startup verification for active public tokens missing hash metadata:
  - `apps/api/src/startup/backfill-public-token-hashes.ts`
  - `apps/api/src/startup/index.ts`
- Enforced public access policy checks (`isPublic`, `allowedDomains`, `oidcRequired`) on public config/chat paths:
  - `apps/api/src/services/public-access-policy.ts`
  - `apps/api/src/routes/widget.ts`
  - `apps/api/src/routes/chat-endpoint.ts`
- Upgraded `oidcRequired` enforcement from bearer-presence check to real user bearer verification
  (local JWT first, then OIDC when configured) for public routes:
  - `apps/api/src/services/public-user-auth.ts`
  - `apps/api/src/services/public-access-policy.ts`
- Added tenant-aware OIDC policy binding for public routes:
  - `apps/api/src/services/public-user-auth.ts`
  - `apps/api/src/services/public-access-policy.ts`
  - `apps/api/src/routes/widget.ts`
  - `apps/api/src/routes/chat-endpoint.ts`
- Added per-tenant, per-token, and per-IP rate limiting for public chat flows:
  - `apps/api/src/services/widget-chat-helpers.ts`
  - `apps/api/src/routes/chat-endpoint.ts`
- Added hosted chat CSP and safe inline config serialization to prevent script injection:
  - `apps/api/src/routes/chat-endpoint.ts`
- Hardened internal worker auth defaults (deny unless explicit local bypass flag):
  - `apps/api/src/routes/internal/workers.ts`

### P2 Abuse/DoS and Streaming Robustness
- Added global request body size enforcement with explicit `413` handling for JSON/multipart and tighter public chat cap:
  - `apps/api/src/app.ts`
- Standardized SSE heartbeat + abort cleanup behind a shared stream utility used across admin/widget/public chat routes:
  - `apps/api/src/services/sse-stream.ts`
  - `apps/api/src/routes/chat.ts`
  - `apps/api/src/services/widget-chat-helpers.ts`
  - `apps/api/src/routes/chat-endpoint.ts`

### P2 Performance
- Added route-level lazy loading and Suspense boundaries for major web pages:
  - `apps/web/src/App.tsx`
- Added enforceable web bundle budget gates (largest chunk + entry chunk + largest route chunk) for CI:
  - `apps/web/scripts/check-bundle-budget.mjs`
  - `apps/web/package.json` (`build:budget`)
  - `.github/workflows/ci.yml`
- Replaced Redis `KEYS` scans with cursor-based `SCAN` in run cleanup path:
  - `packages/queue/src/index.ts`

### P2 Agent Configuration Behavior
- Activated reranker flag behavior in Simple RAG path via heuristic reranking and corrected analytics logging:
  - `apps/api/src/services/simple-rag.ts`

### P2 CI and Supply Chain
- Added CI workflow for API/Web/Widget test gates plus audit, lint, and typecheck as blocking checks:
  - `.github/workflows/ci.yml`
- Added repo-wide lint command using `oxlint`:
  - `package.json`
- Added automated weekly dependency update policy:
  - `.github/dependabot.yml`

### P2 Maintainability
- Removed explicit `any` usage across runtime and test code in `apps/*` and `packages/*`:
  - Typed test doubles now use `unknown`/parameter-derived casts.
  - Scraper job handler typing updated to keep registry assignability without `any`.

## Validation Results
- `bun audit`: **pass** (no vulnerabilities found).
- `bun run --filter @grounded/api test`: **pass**.
- `bun run --filter @grounded/web test`: **pass**.
- `bun run --filter @grounded/widget test`: **pass**.
- `bun run typecheck`: **pass**.
- `bun run lint`: **pass** (`oxlint`, warnings only).
- `bun run --filter @grounded/web build:budget`: **pass**.

## Residual Risks / Follow-up
- Legacy `.xls` and `.ppt` formats remain intentionally unsupported; users must convert to `.xlsx`/`.pptx` or `.pdf`.
- Lint is now enforced in CI, but current policy tolerates warning-only output; teams should burn down warning volume over time.
