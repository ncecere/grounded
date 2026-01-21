# Dependency Map

## Purpose
- Summarize package and service dependencies for the refactor scope.
- Identify owners for dependency domains and integration touchpoints.
- Provide a quick reference when splitting modules or moving files.

## Package dependency map

| App/Package | Workspace dependencies | Notes | Owner |
| --- | --- | --- | --- |
| `apps/api` | `@grounded/ai-providers`, `@grounded/crawl-state`, `@grounded/db`, `@grounded/embeddings`, `@grounded/llm`, `@grounded/logger`, `@grounded/queue`, `@grounded/shared`, `@grounded/vector-store` | API entrypoint, routes, and services. Serves widget asset. | Unassigned |
| `apps/ingestion-worker` | `@grounded/ai-providers`, `@grounded/crawl-state`, `@grounded/db`, `@grounded/embeddings`, `@grounded/llm`, `@grounded/logger`, `@grounded/queue`, `@grounded/shared`, `@grounded/vector-store` | Ingestion job orchestration and embeddings. | Unassigned |
| `apps/scraper-worker` | `@grounded/crawl-state`, `@grounded/db`, `@grounded/logger`, `@grounded/queue`, `@grounded/shared` | Page fetch orchestration; Playwright runtime. | Unassigned |
| `apps/web` | None (workspace dependencies) | Frontend uses external libraries and API endpoints. | Unassigned |
| `packages/db` | None (workspace dependencies) | Drizzle schema and RLS helpers; shared across API/workers. | Unassigned |
| `packages/logger` | None (workspace dependencies) | Wide-event logging and job middleware. | Unassigned |
| `packages/queue` | `@grounded/shared` | BullMQ queues and job helpers. | Unassigned |
| `packages/shared` | None (workspace dependencies) | Shared types, constants, settings client, errors. | Unassigned |
| `packages/ai-providers` | None (workspace dependencies) | Provider registry and client wrappers. | Unassigned |
| `packages/vector-store` | `@grounded/db` | pgvector client and vector operations. | Unassigned |
| `packages/widget` | None (workspace dependencies) | Embeddable widget bundle served by API. | Unassigned |

## External service dependencies

| Service | Primary consumers | Notes | Owner |
| --- | --- | --- | --- |
| PostgreSQL 16 | API, ingestion worker, scraper worker, `@grounded/db` | Main transactional store with RLS policies. | Unassigned |
| PostgreSQL 16 + pgvector | API, ingestion worker, `@grounded/vector-store` | Embedding storage and retrieval. | Unassigned |
| Redis 7 | API, ingestion worker, scraper worker, `@grounded/queue` | BullMQ queues, crawl state, fetched HTML staging. | Unassigned |
| AI model providers | API, ingestion worker, `@grounded/ai-providers` | OpenAI, Anthropic, Google, OpenAI-compatible providers. | Unassigned |
| SMTP server | API | Email alerts and test emails. | Unassigned |
| Firecrawl API | Scraper worker | Optional fetch mode for page content. | Unassigned |
| Playwright Chromium | Scraper worker | Local browser runtime for fetch mode. | Unassigned |

## Ownership notes
- Owners are unassigned; update when module boundaries are finalized in Phase 1.
- Add specific owners for AI providers, vector store, and worker settings when assigned.
