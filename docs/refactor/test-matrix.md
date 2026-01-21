# Test and Smoke Matrix

## Purpose
- Provide a single reference for automated checks and manual smoke validation.
- Align workflows with existing test commands and responsible owners.
- Highlight gaps where only manual coverage exists today.

## Automated checks by app

| App/Scope | Automated checks | Notes | Owner |
| --- | --- | --- | --- |
| Monorepo | `bun run test`, `bun run lint`, `bun run typecheck` | Aggregate validation across workspaces. | Unassigned |
| API | `bun run --filter @grounded/api test` | Covers API routes/services (bun test). | Unassigned |
| Web App | `bun run --filter @grounded/web test` | Component/unit test suite. | Unassigned |
| Ingestion Worker | `bun run --filter @grounded/ingestion-worker typecheck` | Typecheck only; no unit tests today. | Unassigned |
| Scraper Worker | `bun run --filter @grounded/scraper-worker typecheck` | Typecheck only; no unit tests today. | Unassigned |

## Workflow validation matrix

| Workflow | Primary services | Automated coverage | Smoke check | Owner |
| --- | --- | --- | --- | --- |
| Auth + tenant access | API, Web App | API auth route tests (`bun run --filter @grounded/api test`) | Register/login; confirm `/api/v1/auth/me` + `/api/v1/auth/tenants`. | Unassigned |
| Chat SSE (widget/chat endpoint) | API, Widget | Chat integration tests (`apps/api/src/routes/chat-integration.test.ts`). | Stream `/api/v1/widget/:token/chat/stream` or `/api/v1/c/:token/chat/stream`; verify `status` -> `text` -> `sources` -> `done`. | Unassigned |
| Ingestion run (discover -> embed) | API, Ingestion Worker, Scraper Worker | Typecheck only for workers (`bun run --filter @grounded/ingestion-worker typecheck`). | Trigger run; validate stage progression, progress counts, and chunk creation. | Unassigned |
| Scrape page fetch | Scraper Worker, Ingestion Worker | Typecheck only for scraper (`bun run --filter @grounded/scraper-worker typecheck`). | Enqueue `page-fetch`; confirm fetch mode selection, Redis HTML storage, and stage transition. | Unassigned |

## Gap notes
- Ingestion and scraper workers rely on manual smoke checks; add unit tests once job modules are refactored.
- Workflow smoke checks should be exercised after infra changes (Redis/Postgres, Playwright updates).
