# 2026-02-06 Remediation Backlog

## Ticket Schema
Each ticket must include: `ID`, `Severity`, `Evidence`, `Risk`, `Fix`, `Owner`, `Effort`, `Tests`, `Rollback`.

## Resolved in This Cycle
- `SEC-002`: public `oidcRequired` now performs tenant-aware bearer validation and policy enforcement on public routes.
- `SEC-001`: plaintext public token columns removed; runtime is hash-only lookup with guarded migration.
- `PERF-001`: bundle budget policy tightened to include largest chunk, entry chunk, and largest route chunk caps.
- `PERF-002`: shared SSE abstraction (`sse-stream.ts`) adopted by admin/widget/public chat routes.
- `MAIN-001`: repo-wide `bun run typecheck` now passes; CI typecheck gate is blocking.
- `MAIN-002`: repo-wide lint command is in place (`oxlint`); CI lint gate is blocking.
- `MAIN-004`: explicit `any` usage removed across `apps/*` and `packages/*`.

## Wave 1: P0/P1 Security and High-Risk Dependencies

### SEC-003
- Severity: P1
- Evidence: `.pptx` parsing is now hardened and enabled; legacy `.xls`/`.ppt` remain blocked.
- Risk: Functional gap for users relying on those formats.
- Fix: Add secure conversion/quarantine flow for legacy Office binaries (`.xls`/`.ppt`) or keep strict conversion requirement with explicit product messaging.
- Owner: API/Ingestion
- Effort: M
- Tests: malformed legacy file rejection, conversion-path acceptance tests, extraction parity checks.
- Rollback: keep formats disabled.

## Wave 2: Performance and Reliability

No open P2 performance/reliability items from this wave remain in code; continue monitoring in weekly closure reviews.

## Wave 3: Maintainability and Guardrails

### MAIN-003
- Severity: P2
- Evidence: Large files remain (types, queue, test-suites routes, prompt-input).
- Risk: increased change risk and review burden.
- Fix: staged modularization by feature boundaries with behavior-preserving tests.
- Owner: Respective module owners
- Effort: L
- Tests: regression tests per extracted module.
- Rollback: revert per-module extraction commits.

## Weekly Closure Checklist
- Close all P0/P1 before release (current open: `SEC-003` legacy Office conversion path).
- Audit dependency PR queue and merge security updates.
- Review 429/403/401 rates for public endpoints.
- Review p95 first-token latency and stream abort rate.
