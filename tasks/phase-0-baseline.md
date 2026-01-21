# Phase 0: Baseline and Inventory

## Objectives
- Build a shared understanding of current architecture, flows, and hotspots.
- Capture constraints and expectations before moving code.
- Define the validation baseline for later phases.

## Scope
- API, ingestion worker, scraper worker, and web app entrypoints.
- RAG ingestion pipeline flow and data stores.
- Existing tests, smoke checks, and build commands.

## Out of Scope
- Code changes or refactors.
- API behavior changes.
- Database schema or migration updates.

## Refactor Constraints
- Preserve API response shapes, SSE event payloads, and queue payload schemas; no field additions/removals without explicit contract review.
- Keep database schema, migrations, and RLS policies unchanged; do not modify enum values or table definitions.
- Maintain route paths, auth gating, and tenant scoping rules as-is (including internal/admin mounts).
- Retain logging keys, error codes, and metrics fields to protect dashboards and alerts.
- Keep worker settings refresh cadence and default concurrency semantics unchanged unless approved.

## Dependencies
- None (information gathering only).

## Phase Dependencies and Potential Blockers

### Phase dependencies
- Phase 1 (API structure) depends on the Phase 0 baseline inventory, contract baselines, and refactor constraints being reviewed and accepted.
- Phase 2 (ingestion worker) depends on Phase 1 module boundaries, startup assembly, and error/logging guidance.
- Phase 3 (scraper worker) depends on Phase 2 ingestion worker structure to keep shared queue/job contracts aligned.
- Phase 4 (web app) depends on Phase 1 API module boundaries and any shared type decisions to avoid churn.
- Phase 5 (shared packages & docs) depends on Phase 4 web API type split sequencing and Phase 1/2 module ownership notes.

### Potential blockers
- Baseline deliverables pending review (dependency map, test matrix, migration log template) can delay Phase 1 kickoff.
- Contract/observability drift risk if API or worker behavior changes before baselines are locked.
- Limited worker-specific automated tests may slow refactor validation; plan time for new unit tests and smoke runs.
- Cross-team agreement needed on shared types ownership to prevent duplicate moves during Phases 4-5.

## Runtime Entrypoints and Startup Sequence

### API (apps/api)
- Start (dev): `bun run dev:api` (root) or `bun run --filter @grounded/api dev`
- Start (prod): `bun run --filter @grounded/api start`
- Entry file: `apps/api/src/index.ts`
- Startup sequence:
  - Run database migrations, then seed the system admin user.
  - Initialize the vector store when configured; warn when missing.
  - Recover orphaned test suite locks, start periodic lock recovery, start the test suite scheduler.
  - Register global middleware and v1 routes, then start the Hono server on `PORT` (default 3000).

### Web App (apps/web)
- Start (dev): `bun run dev:web` (root) or `bun run --filter @grounded/web dev`
- Build/preview: `bun run --filter @grounded/web build` then `bun run --filter @grounded/web preview`
- Entry file: `apps/web/src/main.tsx`
- Startup sequence:
  - Vite boots the app and loads `main.tsx`.
  - Create the React Query `QueryClient` with default query settings.
  - Render `App` inside `QueryClientProvider` and `ThemeProvider` into `#root`.

### Ingestion Worker (apps/ingestion-worker)
- Start (dev): `bun run dev:ingestion` (root) or `bun run --filter @grounded/ingestion-worker dev`
- Start (prod): `bun run --filter @grounded/ingestion-worker start`
- Entry file: `apps/ingestion-worker/src/index.ts`
- Startup sequence:
  - Initialize worker logger, sampling config, and settings client (with concurrency tracking).
  - Initialize the vector store when configured.
  - Fetch worker settings from the API and start periodic refresh.
  - Register BullMQ workers for source-run, page processing, indexing, embedding, enrichment, deletion, and reindex queues.
  - Listen for SIGTERM/SIGINT to stop refresh and close workers cleanly.

### Scraper Worker (apps/scraper-worker)
- Start (dev): `bun run dev:scraper` (root) or `bun run --filter @grounded/scraper-worker dev`
- Start (prod): `bun run --filter @grounded/scraper-worker start`
- Entry file: `apps/scraper-worker/src/index.ts`
- Startup sequence:
  - Initialize worker logger, default concurrency, and fairness config.
  - Fetch worker settings from the API, update fairness config, and start periodic refresh.
  - Create the page-fetch BullMQ worker and lazily launch Playwright browser instances as needed.
  - Listen for SIGTERM/SIGINT to stop refresh, close the worker, and shut down the browser.

## Environment Variables and Settings Precedence

### API (apps/api)
- Required:
  - `DATABASE_URL`
  - `SESSION_SECRET` (JWT signing, 32+ chars)
- Optional runtime/env config:
  - `PORT` (default 3000)
  - `CORS_ORIGINS` (comma-separated)
  - `APP_URL` (used for alerts/test suite links)
  - `SKIP_MIGRATIONS` (true to skip startup migrations)
  - `ADMIN_EMAIL`, `ADMIN_PASSWORD` (seed system admin)
  - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_AUDIENCE`
  - `INTERNAL_API_KEY` (protect internal worker endpoints)
  - `REDIS_URL`
  - Vector store: `VECTOR_DB_URL` or `VECTOR_DB_HOST`, `VECTOR_DB_PORT`, `VECTOR_DB_USER`, `VECTOR_DB_PASSWORD`, `VECTOR_DB_NAME`, `VECTOR_DB_TYPE`, `VECTOR_DB_SSL`
  - Test suite retention fallbacks: `TEST_SUITES_RETENTION_CLEANUP_TIME`, `TEST_SUITES_RETENTION_DAYS`, `TEST_SUITES_RETENTION_RUNS`
  - Logging: `LOG_LEVEL`, `LOG_SAMPLE_RATE`, `LOG_SLOW_THRESHOLD_MS`, `LOG_ALWAYS_ERRORS`, `LOG_ALWAYS_OPERATIONS`, `SERVICE_VERSION`
- Settings precedence:
  - Auth/server runtime config uses environment variables only.
  - System settings (auth flags, quotas, email, alerts, workers, test suites) are stored in `system_settings` and default to metadata; test suite retention uses DB value first, then env fallback, then defaults.
  - Internal worker settings are exposed via `/api/v1/internal/workers/settings` for workers to poll.

### Web App (apps/web)
- No runtime environment variables referenced in code; dev proxy targets `/api` via Vite config.
- UI settings (auth, quotas, workers, etc.) come from the API/admin settings stored in the database.

### Ingestion Worker (apps/ingestion-worker)
- Settings client:
  - `API_URL` (API base for internal settings fetch)
  - `INTERNAL_API_KEY` (optional for internal auth)
  - `SETTINGS_REFRESH_INTERVAL_MS` (default 60000)
- Concurrency fallbacks:
  - `WORKER_CONCURRENCY`, `INDEX_WORKER_CONCURRENCY`, `EMBED_WORKER_CONCURRENCY`
- Pipeline controls:
  - `STAGE_BATCH_SIZE`, `JOBS_PER_SECOND_PER_RUN`
  - `EMBEDDING_BATCH_SIZE`, `EMBEDDING_PARALLEL_BATCHES`
  - `EMBED_COMPLETION_GATING_DISABLED`, `EMBED_COMPLETION_WAIT_MS`, `EMBED_COMPLETION_CHECK_INTERVAL_MS`
- Shared dependencies:
  - `REDIS_URL`
  - Vector store env vars (same as API)
  - Logging env vars (same as API)
- Settings precedence:
  - Fetch worker settings from the internal API on startup and refresh on interval.
  - On failure, fall back to env vars and hard-coded defaults; changes require worker restart to apply concurrency.

### Scraper Worker (apps/scraper-worker)
- Settings client:
  - `API_URL`, `INTERNAL_API_KEY`, `SETTINGS_REFRESH_INTERVAL_MS`
- Concurrency and browser:
  - `WORKER_CONCURRENCY`, `PLAYWRIGHT_HEADLESS`
- Fairness scheduler fallbacks:
  - `FAIRNESS_DISABLED`, `FAIRNESS_TOTAL_SLOTS`, `FAIRNESS_MIN_SLOTS_PER_RUN`, `FAIRNESS_MAX_SLOTS_PER_RUN`, `FAIRNESS_RETRY_DELAY_MS`
- Fetch integrations:
  - `FIRECRAWL_API_KEY`, `FIRECRAWL_API_URL`
- Shared dependencies:
  - `REDIS_URL`
  - Logging env vars (same as API)
- Settings precedence:
  - Worker settings are fetched from the internal API and refreshed periodically.
  - Env vars provide fallbacks when API settings are unavailable; fairness defaults are computed from `WORKER_CONCURRENCY`.

## Startup Environment/Config Dependencies

### API (apps/api)
- Required:
  - Environment provides `DATABASE_URL` and `SESSION_SECRET` (see env section above).
  - Migrations directory is reachable at runtime; `runMigrations` searches `migrations/` in repo root, `../../migrations` from `apps/api`, or relative to `apps/api/src/startup/run-migrations.ts`.
- Optional:
  - `SKIP_MIGRATIONS=true` disables migration lookup/application.
  - `packages/widget/dist/published-chat.js` for hosted chat asset serving at `/published-chat.js`; if missing, the API starts but returns 404 for the asset.
  - `ADMIN_EMAIL`/`ADMIN_PASSWORD` to seed an initial system admin.

### Web App (apps/web)
- Required:
  - Vite expects `apps/web/index.html` and `apps/web/src/main.tsx` to be present for dev and build startup.
- Optional:
  - None; runtime configuration is fetched from the API after load.

### Ingestion Worker (apps/ingestion-worker)
- Required:
  - Redis connection configured via `REDIS_URL` (queue connection in `packages/queue`).
  - Internal API reachable at `API_URL` (defaults to `http://localhost:3001`) to fetch worker settings; worker starts with env defaults if unreachable.
- Optional:
  - Vector store configuration via `VECTOR_DB_URL` or `VECTOR_DB_*` when embeddings are enabled.
  - `INTERNAL_API_KEY` when the internal API is protected.

### Scraper Worker (apps/scraper-worker)
- Required:
  - Redis connection configured via `REDIS_URL` (queue connection in `packages/queue`).
  - Internal API reachable at `API_URL` (defaults to `http://localhost:3001`) to fetch worker settings; worker starts with env defaults if unreachable.
  - Playwright Chromium binaries available for `chromium.launch`.
- Optional:
  - `PLAYWRIGHT_HEADLESS` to control browser mode.
  - `FIRECRAWL_API_KEY`/`FIRECRAWL_API_URL` for Firecrawl fetch mode.

## External Service Dependencies

### Core data stores
- PostgreSQL 16 (primary app database) via `@grounded/db` for API, ingestion worker, and scraper worker data access.
- Redis 7 for BullMQ queues and crawl state (`@grounded/queue`, `@grounded/crawl-state`).
- Vector store via `@grounded/vector-store` (pgvector today, configured by `VECTOR_DB_URL` or `VECTOR_DB_*`); used by the API and ingestion worker for embedding writes/reads.

### AI model providers
- `packages/ai-providers/src/registry.ts` initializes OpenAI, Anthropic, Google Generative AI, and OpenAI-compatible providers.
- Provider credentials and base URLs are stored in `model_providers`; model configs live in `model_configurations` and are loaded at runtime for chat and embedding.

### Authentication and identity
- Optional OIDC identity provider (issuer/client) configured via `OIDC_*` env vars and used by API auth routes.

### Email and alert delivery
- SMTP server configured in system settings (`email.smtp_*`, `email.from_*`) and used by `apps/api/src/services/email.ts` for alerts and test emails.

### Scraper fetch integrations
- Firecrawl API (optional) via `FIRECRAWL_API_KEY`/`FIRECRAWL_API_URL` for scraper worker fetch mode.
- Playwright Chromium binaries are required locally for browser-based fetches (no hosted dependency).

### Upload storage
- Upload metadata and extracted text live in Postgres `uploads`; no external object storage dependency today.

## Ingestion Pipeline Flow

### End-to-End Stage Order
- Stage order is sequential: DISCOVERING → SCRAPING → PROCESSING → INDEXING → EMBEDDING → COMPLETED (defined in `apps/ingestion-worker/src/stage-manager.ts`).
- Stage transitions are driven by `stage-transition` jobs on the `source-run` queue (BullMQ) and queue jobs for the next stage via `apps/ingestion-worker/src/stage-job-queuer.ts`.

### Flow Steps, Queues, and Owners
- Trigger and start: API `queueSourceRunJob` in `apps/api/src/services/source-helpers.ts` queues a `start` job on `source-run` (`addSourceRunStartJob`). Ingestion worker handles it in `apps/ingestion-worker/src/processors/source-run-start.ts` and queues the `discover` job.
- Discovery (DISCOVERING): `discover` job on `source-run` handled by `apps/ingestion-worker/src/processors/source-discover.ts`. It discovers URLs, applies robots.txt rules, stores crawl state in Redis via `@grounded/crawl-state`, initializes stage progress, and queues `stage-transition`.
- Stage transition: `stage-transition` job on `source-run` handled by `apps/ingestion-worker/src/processors/stage-transition.ts`. It calls `transitionToNextStage` in `apps/ingestion-worker/src/stage-manager.ts` and queues the next stage's jobs via `queueJobsForStage`.
- Scraping (SCRAPING): `queueScrapingJobs` in `apps/ingestion-worker/src/stage-job-queuer.ts` queues `page-fetch` jobs on the `page-fetch` queue. Scraper worker `apps/scraper-worker/src/processors/page-fetch.ts` fetches HTML, stores it in Redis (`storeFetchedHtml`), updates stage progress, and triggers a `stage-transition` when complete.
- Processing (PROCESSING): `queueProcessingJobs` queues `page-process` jobs on the `page-process` queue. Ingestion worker `apps/ingestion-worker/src/processors/page-process.ts` loads HTML from Redis (or upload data), extracts content, writes `source_run_pages` + `source_run_page_contents`, updates stage progress, and triggers `stage-transition` to INDEXING.
- Indexing (INDEXING): `queueIndexingJobs` queues `page-index` jobs on the `page-index` queue. Ingestion worker `apps/ingestion-worker/src/processors/page-index.ts` chunks content into `kb_chunks`, updates run chunk counters, optionally queues `enrich-page` jobs on `enrich-page`, updates stage progress, and triggers `stage-transition` to EMBEDDING.
- Embedding (EMBEDDING): `queueEmbeddingJobs` queues batch `embed-chunks` jobs on the `embed-chunks` queue and initializes chunk embed statuses. Ingestion worker `apps/ingestion-worker/src/processors/embed-chunks.ts` generates embeddings, upserts vectors, updates embed status + stage progress, and triggers `stage-transition` to COMPLETED.
- Completion: `transitionToNextStage` in `apps/ingestion-worker/src/stage-manager.ts` finalizes the run when EMBEDDING completes (updates status/stats and cleans Redis state). `apps/ingestion-worker/src/processors/source-finalize.ts` handles `finalize` jobs on `source-run` when explicitly queued.

### Data Stores and State
- Redis: crawl state (`@grounded/crawl-state`), fetched HTML staging (`storeFetchedHtml`/`getFetchedHtml`), and stage progress counters (`initializeStageProgress`, `incrementStageProgress`).
- Postgres: run + page state (`source_runs`, `source_run_pages`, `source_run_page_contents`) and chunk storage (`kb_chunks`).
- Vector store (pgvector): embedding upserts from `apps/ingestion-worker/src/processors/embed-chunks.ts` via `@grounded/vector-store`.

## Queue Names, Payloads, and Processors

### source-run (ingestion worker)
- Job names: `start`, `discover`, `finalize`, `stage-transition`.
- Payloads:
  - `SourceRunStartJob`: `tenantId`, `sourceId`, `runId` (+ optional `requestId`, `traceId`).
  - `SourceDiscoverUrlsJob`: `tenantId`, `runId` (+ optional `requestId`, `traceId`).
  - `SourceRunFinalizeJob`: `tenantId`, `runId` (+ optional `requestId`, `traceId`).
  - `StageTransitionJob`: `tenantId`, `runId`, `completedStage` (+ optional `requestId`, `traceId`).
- Processors: `apps/ingestion-worker/src/processors/source-run-start.ts`, `apps/ingestion-worker/src/processors/source-discover.ts`, `apps/ingestion-worker/src/processors/source-finalize.ts`, `apps/ingestion-worker/src/processors/stage-transition.ts`.

### page-fetch (scraper worker)
- Job name: `fetch`.
- Payload: `PageFetchJob` with `tenantId`, `runId`, `url`, `fetchMode`, `depth` (+ optional `requestId`, `traceId`).
- Processor: `apps/scraper-worker/src/processors/page-fetch.ts`.

### page-process (ingestion worker)
- Job name: `process`.
- Payload: `PageProcessJob` with `tenantId`, `runId`, `url`, `html`, `title`, `depth`, optional `sourceType` + `uploadMetadata` (+ optional `requestId`, `traceId`).
- Processor: `apps/ingestion-worker/src/processors/page-process.ts`.

### page-index (ingestion worker)
- Job name: `index`.
- Payload: `PageIndexJob` with `tenantId`, `runId`, `pageId`, `contentId`, optional `sourceType` + `uploadMetadata` (+ optional `requestId`, `traceId`).
- Processor: `apps/ingestion-worker/src/processors/page-index.ts`.

### embed-chunks (ingestion worker)
- Job name: `embed`.
- Payload: `EmbedChunksBatchJob` with `tenantId`, `kbId`, `chunkIds`, optional `runId` (+ optional `requestId`, `traceId`).
- Processor: `apps/ingestion-worker/src/processors/embed-chunks.ts`.

### enrich-page (ingestion worker)
- Job name: `enrich`.
- Payload: `EnrichPageJob` with `tenantId`, `kbId`, `chunkIds` (+ optional `requestId`, `traceId`).
- Processor: `apps/ingestion-worker/src/processors/enrich-page.ts`.

### deletion (ingestion worker)
- Job name: `delete`.
- Payload: `HardDeleteObjectJob` with `tenantId`, `objectType`, `objectId` (+ optional `requestId`, `traceId`).
- Processor: `apps/ingestion-worker/src/processors/hard-delete.ts`.

### kb-reindex (ingestion worker)
- Job name: `reindex`.
- Payload: `KbReindexJob` with `tenantId`, `kbId`, `newEmbeddingModelId`, `newEmbeddingDimensions` (+ optional `requestId`, `traceId`).
- Processor: `apps/ingestion-worker/src/processors/kb-reindex.ts`.

## Contract Baselines (API, SSE, Queue Payloads)

### API Response Contracts
- Local auth register/login (`POST /api/v1/auth/register`, `POST /api/v1/auth/login`):
  - `{ user: { id, email }, token, token_type }`
  - `token_type` is the literal string `"Bearer"`.
- Current user (`GET /api/v1/auth/me`):
  - `{ id, email, name, avatarUrl, tenantId, role, isSystemAdmin }`
  - `name` and `avatarUrl` are `null` today because the users table does not store them yet.
- Tenant list (`GET /api/v1/auth/tenants`):
  - `{ tenants: [{ id, name, slug, role }] }`
- Widget config (`GET /api/v1/widget/:token/config`):
  - `{ agentName, description, welcomeMessage, logoUrl, theme, isPublic, ragType, showReasoningSteps }`

### SSE Stream Contracts (Chat + Widget)
- All chat streams emit SSE events where `data` is JSON and includes a `type` field.
- Simple RAG stream event types (`apps/api/src/services/simple-rag.ts`):
  - `status`: `{ type, status, message, sourceCount? }`
  - `text`: `{ type, content }` (streamed chunks)
  - `sources`: `{ type, sources: [{ id, title, url?, snippet, index }] }`
  - `done`: `{ type, conversationId }`
  - `error`: `{ type, message }`
- Advanced RAG stream event types (`apps/api/src/services/advanced-rag.ts`):
  - All Simple RAG events, plus `reasoning` events with `{ type, step }`.
  - `step` payload: `{ id, type, title, summary, status, details? }` where `type` is one of `rewrite`, `plan`, `search`, `merge`, `generate` and `status` is `pending | in_progress | completed | error`.
- Ordering invariants:
  - `status` event is emitted before response text streaming for both modes.
  - `sources` is emitted after streaming completes, followed by `done` with the `conversationId`.

### Queue Payload Invariants
- All queue payloads include `tenantId` plus job-specific identifiers (see queue section above).
- Optional tracing fields are `requestId` and `traceId` across ingestion queues.
- Job names and payload keys are stable and should not change without updating baseline docs.

## API Route Inventory

### Top-level (non `/api/v1`)
- GET `/health` -> `apps/api/src/index.ts`
- GET `/chat/:token` -> `apps/api/src/index.ts`
- GET `/published-chat.js` -> `apps/api/src/index.ts`

### Public routes (no auth middleware)

#### `apps/api/src/routes/auth.ts`
- POST `/api/v1/auth/register`
- POST `/api/v1/auth/login`
- GET `/api/v1/auth/oidc/login`
- GET `/api/v1/auth/oidc/callback`

#### `apps/api/src/routes/widget.ts`
- GET `/api/v1/widget/:token/config`
- POST `/api/v1/widget/:token/chat`
- POST `/api/v1/widget/:token/chat/stream`

#### `apps/api/src/routes/chat-endpoint.ts`
- GET `/api/v1/c/:token/config`
- GET `/api/v1/c/:token`
- POST `/api/v1/c/:token/chat`
- POST `/api/v1/c/:token/chat/stream`

### Authenticated routes

#### `apps/api/src/routes/auth.ts`
- POST `/api/v1/auth/change-password`
- GET `/api/v1/auth/me`
- GET `/api/v1/auth/tenants`

#### `apps/api/src/routes/tenants.ts`
- GET `/api/v1/tenants`
- POST `/api/v1/tenants`
- GET `/api/v1/tenants/:tenantId`
- PATCH `/api/v1/tenants/:tenantId`
- DELETE `/api/v1/tenants/:tenantId`
- GET `/api/v1/tenants/:tenantId/members`
- POST `/api/v1/tenants/:tenantId/members`
- PATCH `/api/v1/tenants/:tenantId/members/:userId`
- DELETE `/api/v1/tenants/:tenantId/members/:userId`
- GET `/api/v1/tenants/:tenantId/alert-settings`
- PUT `/api/v1/tenants/:tenantId/alert-settings`
- GET `/api/v1/tenants/:tenantId/api-keys`
- POST `/api/v1/tenants/:tenantId/api-keys`
- DELETE `/api/v1/tenants/:tenantId/api-keys/:keyId`

#### `apps/api/src/routes/knowledge-bases.ts`
- GET `/api/v1/knowledge-bases`
- POST `/api/v1/knowledge-bases`
- GET `/api/v1/knowledge-bases/:kbId`
- PATCH `/api/v1/knowledge-bases/:kbId`
- POST `/api/v1/knowledge-bases/:kbId/reindex`
- POST `/api/v1/knowledge-bases/:kbId/reindex/cancel`
- DELETE `/api/v1/knowledge-bases/:kbId`
- GET `/api/v1/knowledge-bases/global`
- POST `/api/v1/knowledge-bases/global`
- POST `/api/v1/knowledge-bases/:kbId/publish`
- POST `/api/v1/knowledge-bases/:kbId/unpublish`
- POST `/api/v1/knowledge-bases/:kbId/subscribe`
- POST `/api/v1/knowledge-bases/:kbId/unsubscribe`
- Alias mount: all of the above are also available under `/api/v1/global-knowledge-bases/*`.

#### `apps/api/src/routes/sources.ts`
- GET `/api/v1/sources/kb/:kbId`
- POST `/api/v1/sources`
- GET `/api/v1/sources/:sourceId`
- PATCH `/api/v1/sources/:sourceId`
- DELETE `/api/v1/sources/:sourceId`
- POST `/api/v1/sources/:sourceId/runs`
- GET `/api/v1/sources/:sourceId/runs`
- GET `/api/v1/sources/runs/:runId`
- POST `/api/v1/sources/runs/:runId/cancel`
- GET `/api/v1/sources/runs/:runId/progress`
- GET `/api/v1/sources/:sourceId/stats`

#### `apps/api/src/routes/agents.ts`
- GET `/api/v1/agents/models`
- GET `/api/v1/agents`
- POST `/api/v1/agents`
- GET `/api/v1/agents/:agentId`
- PATCH `/api/v1/agents/:agentId`
- DELETE `/api/v1/agents/:agentId`
- GET `/api/v1/agents/:agentId/kbs`
- PUT `/api/v1/agents/:agentId/kbs`
- GET `/api/v1/agents/:agentId/retrieval-config`
- PUT `/api/v1/agents/:agentId/retrieval-config`
- GET `/api/v1/agents/:agentId/widget`
- PUT `/api/v1/agents/:agentId/widget`
- GET `/api/v1/agents/:agentId/widget-token`
- POST `/api/v1/agents/:agentId/widget/tokens`
- DELETE `/api/v1/agents/:agentId/widget/tokens/:tokenId`
- GET `/api/v1/agents/:agentId/chat-endpoints`
- POST `/api/v1/agents/:agentId/chat-endpoints`
- DELETE `/api/v1/agents/:agentId/chat-endpoints/:endpointId`

#### `apps/api/src/routes/chat.ts`
- POST `/api/v1/chat/simple/:agentId`

#### `apps/api/src/routes/analytics.ts`
- GET `/api/v1/analytics`
- GET `/api/v1/analytics/agents/:agentId`
- GET `/api/v1/analytics/tenant`
- GET `/api/v1/analytics/test-suites`

#### `apps/api/src/routes/uploads.ts`
- GET `/api/v1/uploads/kb/:kbId`
- POST `/api/v1/uploads/kb/:kbId`

#### `apps/api/src/routes/tools.ts`
- GET `/api/v1/tools/builtin`
- GET `/api/v1/tools`
- GET `/api/v1/tools/:toolId`
- POST `/api/v1/tools`
- PATCH `/api/v1/tools/:toolId`
- DELETE `/api/v1/tools/:toolId`
- GET `/api/v1/tools/agents/:agentId/capabilities`
- PUT `/api/v1/tools/agents/:agentId/capabilities`
- GET `/api/v1/tools/agents/:agentId/tools`
- POST `/api/v1/tools/agents/:agentId/tools`
- DELETE `/api/v1/tools/agents/:agentId/tools/:toolId`

#### `apps/api/src/routes/test-suites.ts`
- GET `/api/v1/agents/:agentId/test-suites`
- POST `/api/v1/agents/:agentId/test-suites`
- GET `/api/v1/test-suites/:suiteId`
- PATCH `/api/v1/test-suites/:suiteId`
- DELETE `/api/v1/test-suites/:suiteId`
- GET `/api/v1/test-suites/:suiteId/cases`
- POST `/api/v1/test-suites/:suiteId/import`
- GET `/api/v1/test-suites/:suiteId/export`
- POST `/api/v1/test-suites/:suiteId/cases`
- POST `/api/v1/test-suites/:suiteId/cases/reorder`
- GET `/api/v1/test-suites/:suiteId/runs`
- POST `/api/v1/test-suites/:suiteId/runs`
- POST `/api/v1/test-suites/:suiteId/experiment`
- GET `/api/v1/test-suites/:suiteId/analytics`
- GET `/api/v1/test-suites/:suiteId/experiments`
- GET `/api/v1/test-suites/:suiteId/latest-analysis`
- GET `/api/v1/test-suites/:suiteId/analyses`
- GET `/api/v1/test-cases/:caseId`
- PATCH `/api/v1/test-cases/:caseId`
- DELETE `/api/v1/test-cases/:caseId`
- GET `/api/v1/test-runs/:runId`
- DELETE `/api/v1/test-runs/:runId`
- GET `/api/v1/test-runs/:runId/analysis`
- POST `/api/v1/test-runs/:runId/analysis`
- POST `/api/v1/test-runs/:runId/analysis/apply`
- POST `/api/v1/test-runs/:runId/analysis/apply-to-agent`
- GET `/api/v1/experiments/:experimentId`
- POST `/api/v1/experiments/:experimentId/apply`

### System admin routes (`/api/v1/admin`)

#### `apps/api/src/routes/admin/dashboard.ts`
- GET `/api/v1/admin/dashboard/health`
- GET `/api/v1/admin/dashboard/stats`

#### `apps/api/src/routes/admin/settings.ts`
- GET `/api/v1/admin/settings`
- GET `/api/v1/admin/settings/:key`
- PUT `/api/v1/admin/settings/:key`
- PUT `/api/v1/admin/settings`
- GET `/api/v1/admin/settings/schema/all`
- POST `/api/v1/admin/settings/email/verify`
- POST `/api/v1/admin/settings/email/test`
- GET `/api/v1/admin/settings/email/status`
- GET `/api/v1/admin/settings/alerts/status`
- POST `/api/v1/admin/settings/alerts/check`
- POST `/api/v1/admin/settings/alerts/start`
- POST `/api/v1/admin/settings/alerts/stop`
- GET `/api/v1/admin/settings/test-scheduler/status`
- POST `/api/v1/admin/settings/test-scheduler/restart`
- GET `/api/v1/admin/settings/workers/fairness/metrics`
- POST `/api/v1/admin/settings/workers/fairness/reset`

#### `apps/api/src/routes/admin/models.ts`
- GET `/api/v1/admin/models/providers`
- GET `/api/v1/admin/models/providers/:id`
- POST `/api/v1/admin/models/providers`
- PATCH `/api/v1/admin/models/providers/:id`
- DELETE `/api/v1/admin/models/providers/:id`
- POST `/api/v1/admin/models/providers/:id/test`
- GET `/api/v1/admin/models/models`
- GET `/api/v1/admin/models/models/:id`
- POST `/api/v1/admin/models/models`
- PATCH `/api/v1/admin/models/models/:id`
- DELETE `/api/v1/admin/models/models/:id`
- POST `/api/v1/admin/models/models/:id/set-default`
- GET `/api/v1/admin/models/status`
- POST `/api/v1/admin/models/refresh`

#### `apps/api/src/routes/admin/users.ts`
- GET `/api/v1/admin/users`
- GET `/api/v1/admin/users/:id`
- POST `/api/v1/admin/users`
- PATCH `/api/v1/admin/users/:id`
- DELETE `/api/v1/admin/users/:id`
- POST `/api/v1/admin/users/:id/reset-password`

#### `apps/api/src/routes/admin/shared-kbs.ts`
- GET `/api/v1/admin/shared-kbs`
- POST `/api/v1/admin/shared-kbs`
- GET `/api/v1/admin/shared-kbs/:kbId`
- PATCH `/api/v1/admin/shared-kbs/:kbId`
- DELETE `/api/v1/admin/shared-kbs/:kbId`
- POST `/api/v1/admin/shared-kbs/:kbId/publish`
- POST `/api/v1/admin/shared-kbs/:kbId/unpublish`
- POST `/api/v1/admin/shared-kbs/:kbId/shares`
- DELETE `/api/v1/admin/shared-kbs/:kbId/shares/:tenantId`
- GET `/api/v1/admin/shared-kbs/:kbId/available-tenants`
- GET `/api/v1/admin/shared-kbs/:kbId/sources`
- POST `/api/v1/admin/shared-kbs/:kbId/sources`
- POST `/api/v1/admin/shared-kbs/:kbId/uploads`
- GET `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId`
- PATCH `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId`
- DELETE `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId`
- POST `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId/runs`
- GET `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId/runs`
- POST `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId/runs/:runId/cancel`
- GET `/api/v1/admin/shared-kbs/:kbId/sources/:sourceId/stats`

#### `apps/api/src/routes/admin/analytics.ts`
- GET `/api/v1/admin/analytics/overview`
- GET `/api/v1/admin/analytics/tenants`
- GET `/api/v1/admin/analytics/tenants/:tenantId`
- GET `/api/v1/admin/analytics/export/overview`
- GET `/api/v1/admin/analytics/export/tenants`

#### `apps/api/src/routes/admin/tokens.ts`
- GET `/api/v1/admin/tokens`
- POST `/api/v1/admin/tokens`
- DELETE `/api/v1/admin/tokens/:id`

#### `apps/api/src/routes/admin/audit.ts`
- GET `/api/v1/admin/audit`
- GET `/api/v1/admin/audit/:id`
- GET `/api/v1/admin/audit/resource/:resourceType/:resourceId`
- GET `/api/v1/admin/audit/summary/:tenantId`
- GET `/api/v1/admin/audit/filters/options`

### Internal worker routes

#### `apps/api/src/routes/internal/workers.ts`
- GET `/api/v1/internal/workers/settings`
- GET `/api/v1/internal/workers/settings/fairness`

## Web App Page Inventory and Navigation Flows

### Workspace pages (tenant required)
- `kbs` (Knowledge Bases) -> `apps/web/src/pages/KnowledgeBases.tsx`
- `agents` (Agents) -> `apps/web/src/pages/Agents.tsx`
- `analytics` (Analytics) -> `apps/web/src/pages/Analytics.tsx`
- `tenant-settings` (Settings, tenant owner/admin only) -> `apps/web/src/pages/TenantSettings.tsx`

### Workspace detail flows (not in sidebar)
- `sources` (Sources) -> `apps/web/src/pages/Sources.tsx`
- `shared-kb-detail` (Shared Knowledge Base) -> `apps/web/src/pages/SharedKbDetail.tsx`
- `chat` (Chat) -> `apps/web/src/pages/Chat.tsx`
- `test-suites` (Test Suites) -> `apps/web/src/pages/AgentTestSuites.tsx`
- `test-suite-detail` (Test Suite) -> `apps/web/src/pages/AgentTestSuiteDetail.tsx`

### Administration pages (system admin)
- `dashboard` (Dashboard) -> `apps/web/src/pages/AdminDashboard.tsx`
- `admin-analytics` (Analytics) -> `apps/web/src/pages/AdminAnalytics.tsx`
- `tenants` (Tenants) -> `apps/web/src/pages/AdminTenants.tsx`
- `users` (Users) -> `apps/web/src/pages/AdminUsers.tsx`
- `shared-kbs` (Shared KBs) -> `apps/web/src/pages/AdminSharedKBs.tsx`
- `shared-kb-sources` (Shared KB Sources) -> `apps/web/src/pages/AdminSharedKbSources.tsx`
- `models` (AI Models) -> `apps/web/src/pages/AdminModels.tsx`
- `settings` (Settings) -> `apps/web/src/pages/AdminSettings.tsx`
- `admin-audit-logs` (Audit Logs) -> `apps/web/src/pages/AdminAuditLogs.tsx`

### Authentication and empty states
- `Login` is rendered when no token is present -> `apps/web/src/pages/Login.tsx`.
- No-tenant state: non-admin users see the "No Access" empty state; admins see the "No Tenants Yet" prompt.

### Navigation flow notes
- `apps/web/src/App.tsx` owns `currentPage` state and uses `pageNames` for breadcrumb labels.
- `apps/web/src/components/app-sidebar.tsx` renders workspace vs administration groups and routes by page id.
- Knowledge Bases -> Sources or Shared Knowledge Base detail depending on `isShared` selection.
- Agents -> Chat; Agents -> Test Suites -> Test Suite Detail.
- Shared KBs (admin) -> Shared KB Sources.
- Tenant switcher resets navigation to Knowledge Bases and clears selected KB/agent IDs.

## Largest Files and Repeated Patterns

### API (apps/api)
- Largest files (by LOC snapshot):
  - `apps/api/src/services/advanced-rag.test.ts` (~3754 LOC)
  - `apps/api/src/routes/test-suites.ts` (~1477 LOC)
  - `apps/api/src/routes/admin/shared-kbs.ts` (~1097 LOC)
  - `apps/api/src/services/test-runner.ts` (~1096 LOC)
  - `apps/api/src/routes/chat-integration.test.ts` (~1094 LOC)
  - `apps/api/src/services/prompt-analysis.ts` (~1088 LOC)
- Repeated patterns:
  - Large route files start with extensive Zod schemas, then Hono handlers wired with `auth()`, `requireTenant()`, `requireRole()`, and `withRequestRLS`.
  - Service/test files repeat suite setup for agents, runs, and prompt analysis workflows with similar helper usage.

### Web App (apps/web)
- Largest files (by LOC snapshot):
  - `apps/web/public/widget.js` (~1811 LOC)
  - `apps/web/public/published-chat.js` (~1811 LOC)
  - `apps/web/src/components/ai-elements/prompt-input.tsx` (~1419 LOC)
  - `apps/web/src/pages/SourcesManager.tsx` (~1183 LOC)
  - `apps/web/src/components/ai-elements/reasoning-steps.test.ts` (~1149 LOC)
- Repeated patterns:
  - Large page components combine query hooks, forms, tables, and mutations in single modules (notably `SourcesManager`).
  - AI elements components co-locate interaction state, keyboard handling, and rendering in monolithic files.
  - Public widget assets are prebuilt bundles; treat them as generated outputs.

### Ingestion Worker (apps/ingestion-worker)
- Largest files (by LOC snapshot):
  - `apps/ingestion-worker/src/processors/source-discover.ts` (~476 LOC)
  - `apps/ingestion-worker/src/stage-manager.ts` (~445 LOC)
  - `apps/ingestion-worker/src/index.ts` (~386 LOC)
  - `apps/ingestion-worker/src/processors/page-index.ts` (~368 LOC)
  - `apps/ingestion-worker/src/processors/page-process.ts` (~365 LOC)
- Repeated patterns:
  - Processor files share job data extraction, logger creation, stage progress updates, and next-stage queueing.
  - Stage manager + job queuer centralize stage transition rules with repeated guard logic.

### Scraper Worker (apps/scraper-worker)
- Largest files (by LOC snapshot):
  - `apps/scraper-worker/src/processors/page-fetch.ts` (~421 LOC)
  - `apps/scraper-worker/src/index.ts` (~196 LOC)
- Repeated patterns:
  - `page-fetch` orchestrates fetch mode branching, fairness slot handling, and error mapping in one file.
  - Entrypoint mirrors ingestion worker setup (settings refresh + graceful shutdown wiring).

## Cross-Cutting Helpers (Auth, Audit, RLS, Logging, Settings)

### Auth and RBAC
- `apps/api/src/middleware/auth/index.ts` re-exports auth middleware entry points and helper functions.
- `apps/api/src/middleware/auth/middleware.ts` provides `auth()`, `requireRole()`, `requireTenant()`, and `requireSystemAdmin()`; it sets `rlsContext` on the request.
- `apps/api/src/middleware/auth/helpers.ts` implements `withRequestRLS`, tenant membership resolution, and OIDC user creation helpers.

### Audit Logging
- `apps/api/src/services/audit.ts` defines `auditService`, `calculateChanges`, and `extractIpAddress` for consistent audit logging.
- Audit logging is called from `apps/api/src/routes/auth.ts`, `apps/api/src/routes/agents.ts`, and `apps/api/src/routes/tools.ts` for create/update/delete events.
- `apps/api/src/routes/admin/audit.ts` exposes admin queries and summaries; storage lives in `packages/db/src/schema/audit.ts`.

### RLS Enforcement
- `packages/db/src/client.ts` defines `withRLSContext`, `withTenantContext`, and `withSystemAdminContext` to apply `SET LOCAL` tenant/user context in transactions.
- `apps/api/src/middleware/auth/helpers.ts` exposes `withRequestRLS` to run route queries using request-scoped RLS context.
- `apps/api/src/middleware/auth/middleware.ts` is the primary point where `rlsContext` is populated for authenticated requests.
- Public routes that need system-level access use `withRLSContext` directly (e.g., `apps/api/src/routes/widget.ts`, `apps/api/src/routes/chat-endpoint.ts`).

### Logging Helpers
- `packages/logger/src/logger.ts` provides `createLogger`, `WideEventBuilder`, and sampling via `shouldSample`.
- `packages/logger/src/middleware/hono.ts` exports `wideEventMiddleware` for API request logging (wired in `apps/api/src/index.ts`).
- `packages/logger/src/worker/job-logger.ts` exposes `createJobLogger`/`withJobLogging` for ingestion and scraper workers.

### Settings Helpers
- `packages/shared/src/settings/index.ts` implements the worker settings client (`WorkerSettingsClient`, `initSettingsClient`).
- Internal API settings endpoints live in `apps/api/src/routes/internal/workers.ts` and admin settings in `apps/api/src/routes/admin/settings.ts`.
- Workers consume settings via `initSettingsClient` in `apps/ingestion-worker/src/index.ts` and `apps/scraper-worker/src/index.ts`.

## Shared Packages and Consumers

### `@grounded/shared` (packages/shared)
- Responsibilities: shared types, constants, utilities, error taxonomies, and worker settings client.
- Key exports: `packages/shared/src/types`, `packages/shared/src/constants`, `packages/shared/src/utils`, `packages/shared/src/errors`, `packages/shared/src/settings`.
- Consumers: `apps/api`, `apps/ingestion-worker`, `apps/scraper-worker`, `packages/queue`.

### `@grounded/queue` (packages/queue)
- Responsibilities: BullMQ queue instances, job helpers, Redis connection wiring, rate limiting, concurrency and embed backpressure helpers.
- Key exports: queue definitions (`sourceRunQueue`, `pageFetchQueue`, etc.), job add/remove helpers, Redis utilities, concurrency/backpressure helpers, queue constants re-exported from shared.
- Consumers: `apps/api` (enqueue/cancel), `apps/ingestion-worker` (job orchestration), `apps/scraper-worker` (page fetch worker).

### `@grounded/logger` (packages/logger)
- Responsibilities: wide event logging, tracing helpers, sampling config, worker/job logging middleware.
- Key exports: `createLogger`, `WideEventBuilder`, tracing helpers, log types; worker/job logging lives under `packages/logger/src/worker` and API middleware under `packages/logger/src/middleware`.
- Consumers: `apps/api`, `apps/ingestion-worker`, `apps/scraper-worker`.

### `@grounded/db` (packages/db)
- Responsibilities: Drizzle schema definitions and Postgres client helpers with RLS contexts.
- Key exports: `packages/db/src/schema`, `packages/db/src/client` (`withRLSContext`, `withTenantContext`, `withSystemAdminContext`).
- Consumers: `apps/api`, `apps/ingestion-worker`, `apps/scraper-worker`.

## Tenant Boundary and RLS Enforcement Touchpoints

### RLS Policy Sources
- Core tenant isolation policies live in `migrations/0002_rls_policies.sql` for tenant-owned tables (`tenants`, `tenant_memberships`, `knowledge_bases`, `tenant_kb_subscriptions`, `sources`, `source_runs`, `source_run_pages`, `kb_chunks`, `uploads`, `agents`, `agent_kbs`, `agent_widget_configs`, `retrieval_configs`, `widget_tokens`, `chat_events`, `api_keys`, `tenant_quotas`, `tenant_usage`, `deletion_jobs`).
- Global KB read exceptions are defined in `migrations/0024_fix_global_kb_rls_policies.sql` for `kb_chunks`, `sources`, `source_runs`, `source_run_pages`, and `uploads` when `tenant_id` is NULL and the KB is published.
- Prompt analysis A/B testing tables enforce tenant isolation in `migrations/0026_prompt_analysis_ab_testing.sql` (`test_run_experiments`, `test_run_prompt_analyses`).

### DB Context and Enforcement
- `packages/db/src/client.ts` defines `withRLSContext`, `withTenantContext`, and `withSystemAdminContext` to run transactions with `SET LOCAL app.tenant_id`, `app.user_id`, and `app.is_system_admin` for PostgreSQL RLS.
- All RLS policies reference `current_setting('app.tenant_id', true)` and `current_setting('app.is_system_admin', true)` to enforce tenant scoping or system admin bypass.

### API Middleware and Route Usage
- `apps/api/src/middleware/auth/middleware.ts` resolves tenant context from auth and `X-Tenant-ID`, then stores `rlsContext` on the request.
- `apps/api/src/middleware/auth/helpers.ts` exposes `withRequestRLS` to wrap route queries in an RLS-aware transaction.
- Tenant-scoped routes use `withRequestRLS` across modules such as `apps/api/src/routes/knowledge-bases.ts`, `apps/api/src/routes/sources.ts`, `apps/api/src/routes/agents.ts`, `apps/api/src/routes/analytics.ts`, `apps/api/src/routes/test-suites.ts`, and `apps/api/src/routes/uploads.ts`.

### System-Level Access Paths
- Public token-based routes use `withRLSContext({ isSystemAdmin: true })` to bypass tenant scoping when looking up widget/chat tokens (`apps/api/src/routes/widget.ts`, `apps/api/src/routes/chat-endpoint.ts`, `apps/api/src/services/widget-chat-helpers.ts`).
- Auth bootstrap flows (`apps/api/src/routes/auth.ts`) also run system-level RLS context for initial user creation and login.

## Observability Baseline (Logs, Error Codes, Metrics)

### Shared Logging Schema (Wide Events)
- Logger package defines a canonical wide event (`packages/logger/src/types.ts`) emitted per request/job.
- Core fields: `requestId`, `traceId`, `spanId`, `timestamp`, `service`, `env`, `version`, `deploymentId`.
- Context fields: `tenant`, `user`, `http` (`method`, `path`, `statusCode`, `userAgent`, `ip`), `job` (`id`, `name`, `queue`, `attempt`, `maxAttempts`).
- Business fields: `knowledgeBase`, `source`, `sourceRun`, `agent`, `operation`, `outcome`.
- Error fields: `error.type`, `error.code`, `error.message`, `error.stack`, `error.retriable`.

### API (apps/api)
- Request logging uses `wideEventMiddleware` in `apps/api/src/index.ts` to emit one wide event per HTTP request.
- Error codes:
  - 5xx responses set `error.code` to the HTTP status string (e.g., `"500"`).
  - 4xx responses are logged as `httpError` with outcome `success` (client error).
  - RAG services also include `errorCode` fields when streaming fails (`apps/api/src/services/simple-rag.ts`, `advanced-rag.ts`).
- Sampling controls via env: `LOG_SAMPLE_RATE`, `LOG_SLOW_THRESHOLD_MS`, `LOG_ALWAYS_ERRORS`, `LOG_ALWAYS_OPERATIONS`.

### Ingestion Worker (apps/ingestion-worker)
- Job logging uses `createJobLogger` in `apps/ingestion-worker/src/index.ts` for each BullMQ job.
- Job context fields include queue name, job name, attempt counters, plus `tenantId`, `kbId`, `sourceId`, `runId` from job data.
- Error codes follow the ingestion taxonomy in `packages/shared/src/errors/index.ts`.

### Scraper Worker (apps/scraper-worker)
- Job logging uses `createJobLogger` in `apps/scraper-worker/src/index.ts` for page fetch jobs.
- Error codes rely on the same ingestion taxonomy (notably content and network errors) for `page-fetch` failures.

### Error Code Taxonomy (shared ingestion errors)
- Network: `NETWORK_TIMEOUT`, `NETWORK_CONNECTION_REFUSED`, `NETWORK_DNS_FAILURE`, `NETWORK_RESET`, `NETWORK_SSL_ERROR`.
- Service: `SERVICE_UNAVAILABLE`, `SERVICE_RATE_LIMITED`, `SERVICE_TIMEOUT`, `SERVICE_BAD_GATEWAY`, `SERVICE_GATEWAY_TIMEOUT`, `SERVICE_OVERLOADED`, `SERVICE_API_ERROR`.
- Content: `CONTENT_TOO_LARGE`, `CONTENT_INVALID_FORMAT`, `CONTENT_EMPTY`, `CONTENT_UNSUPPORTED_TYPE`, `CONTENT_PARSE_FAILED`, `CONTENT_ENCODING_ERROR`.
- Config: `CONFIG_MISSING`, `CONFIG_INVALID`, `CONFIG_API_KEY_MISSING`, `CONFIG_MODEL_MISMATCH`, `CONFIG_DIMENSION_MISMATCH`.
- Not found: `NOT_FOUND_RESOURCE`, `NOT_FOUND_URL`, `NOT_FOUND_KB`, `NOT_FOUND_SOURCE`, `NOT_FOUND_RUN`, `NOT_FOUND_CHUNK`.
- Validation: `VALIDATION_SCHEMA`, `VALIDATION_URL_INVALID`, `VALIDATION_CONSTRAINT`, `VALIDATION_PAYLOAD`.
- Auth: `AUTH_FORBIDDEN`, `AUTH_UNAUTHORIZED`, `AUTH_BLOCKED`.
- System/unknown: `SYSTEM_OUT_OF_MEMORY`, `SYSTEM_DISK_FULL`, `SYSTEM_INTERNAL`, `SYSTEM_DATABASE_ERROR`, `UNKNOWN_ERROR`.

### Metrics and Dimensions
- Wide events include measurement fields: `durationMs`, `dbQueries`, `externalCalls`, `cacheHit`, `bytesProcessed`, `itemsProcessed`.
- Dimensions for aggregations: `service`, `operation`, `outcome`, `queue`, `job.name`, `tenant.id`, `sourceRun.id`, `knowledgeBase.id`.
- No separate metrics exporter is configured; dashboards rely on these log fields.

## Baseline Throughput and Performance Snapshot (Queues)

- Snapshot date: 2026-01-21.
- Source: default worker settings in `packages/shared/src/settings/index.ts`, stage manager config in `apps/ingestion-worker/src/stage-manager.ts`, and worker entrypoints in `apps/ingestion-worker/src/index.ts` + `apps/scraper-worker/src/index.ts`.
- Note: Baseline reflects configured concurrency/rate limits (no production telemetry captured yet).

### Ingestion worker queues (source-run, page-process, page-index, embed-chunks)
- `source-run`: default concurrency 5 (`WORKER_CONCURRENCY`), batch size 100 (`STAGE_BATCH_SIZE`), rate limit 10 jobs/sec/run (`JOBS_PER_SECOND_PER_RUN`).
- `page-process`/`page-index`: default concurrency 5 (`WORKER_CONCURRENCY` or `INDEX_WORKER_CONCURRENCY`).
- `embed-chunks`: default concurrency 4 (`EMBED_WORKER_CONCURRENCY`).
- Slow job threshold: 30s (`slowRequestThresholdMs`).
- Throughput baseline: up to 5 concurrent jobs per queue (4 for embed) with 10 jobs/sec/run queued per stage.

### Scraper worker queue (page-fetch)
- `page-fetch`: default concurrency 5 (`WORKER_CONCURRENCY`).
- Fairness scheduler defaults: total slots 5, min 1, max 10, retry delay 500ms (`FAIRNESS_*`).
- Slow job threshold: 30s (`slowRequestThresholdMs`).
- Throughput baseline: up to 5 concurrent fetches gated by fairness slots.

## Critical Workflow Checklist

### Auth and Tenant Access
- Register or login via `/api/v1/auth/register` or `/api/v1/auth/login`.
- Expected outputs:
  - Response includes `{ user, token, token_type }` with `token_type: "Bearer"`.
  - `/api/v1/auth/me` returns `tenantId`, `role`, and `isSystemAdmin` for the session.
  - `/api/v1/auth/tenants` returns at least one tenant for non-system admins.

### Chat SSE (Widget or Chat Endpoint)
- Initiate stream via `/api/v1/widget/:token/chat/stream` or `/api/v1/c/:token/chat/stream`.
- Expected outputs:
  - `status` event emitted before any `text` chunks.
  - `text` events stream incremental content.
  - `sources` event emitted after streaming completes.
  - `done` event includes `conversationId` and ends the stream.

### Ingestion Run (Discover -> Embed)
- Create or trigger a run via `POST /api/v1/sources/:sourceId/runs`.
- Expected outputs:
  - `GET /api/v1/sources/runs/:runId` shows status progressing through stages.
  - `GET /api/v1/sources/runs/:runId/progress` reflects stage counts and transitions.
  - `source_run_pages` and `kb_chunks` records exist for processed pages.

### Scrape Page Fetch
- Enqueue a run with crawl URLs or trigger scraper via ingestion `page-fetch` jobs.
- Expected outputs:
  - `page-fetch` job logs include the requested URL and fetch mode.
  - Redis stores fetched HTML for the run (`storeFetchedHtml`).
  - Stage progress increments and queues a `stage-transition` when complete.

## Existing Tests and Smoke Checks

### Automated tests and checks
- Monorepo: `bun run test` (all workspaces), plus `bun run lint` and `bun run typecheck` for CI-style validation.
- API: `bun run --filter @grounded/api test` (bun test for routes/services).
- Web App: `bun run --filter @grounded/web test` (component/unit tests).
- Ingestion Worker: no `test` script today; run `bun run --filter @grounded/ingestion-worker typecheck` and validate via ingestion smoke runs.
- Scraper Worker: no `test` script today; run `bun run --filter @grounded/scraper-worker typecheck` and validate via page-fetch smoke runs.

### Smoke checks (manual)
- Auth + tenant access: verify register/login, `/api/v1/auth/me`, and tenant list responses.
- Chat SSE streaming: validate `status` -> `text` -> `sources` -> `done` event order for widget/chat endpoints.
- Ingestion run: confirm stage progression, progress counts, and chunk creation through EMBEDDING.
- Scraper page fetch: validate fetch mode selection, Redis HTML storage, and stage transition triggers.

## Task List
- [x] Document runtime entrypoints and startup sequence per app.
- [x] Document environment variables and settings precedence per app (including dynamic settings fetch).
- [ ] Map the ingestion pipeline flow with owning modules and queues.
- [x] Map queue names to job payloads and owning processors.
- [x] Capture contract baselines for API responses, SSE events, and queue payloads.
- [x] Capture observability keys (log fields, error codes, metrics) by app.
- [x] Inventory API routes and their owning files.
- [x] Inventory web pages and navigation flows.
- [ ] Identify the largest files and repeated patterns in each app.
- [x] Capture cross-cutting helpers (auth, audit, RLS, logging, settings).
- [x] Map tenant boundary/RLS enforcement touchpoints.
- [x] Inventory shared packages and their consumers (shared, queue, logger, db).
- [x] Record current environment/config dependencies for startup.
- [x] Record external service dependencies (AI providers, vector store, storage).
- [ ] Record baseline throughput and performance metrics for ingestion and scraper queues.
- [x] Build a critical workflow checklist with expected outputs (auth, chat SSE, ingestion, scrape).
- [x] List existing tests and smoke checks used today.
- [ ] Build a test/smoke matrix by app and workflow.
- [x] Define refactor constraints (no API response changes, no schema changes).
- [x] Note phase dependencies and potential blockers.
- [ ] Create a baseline inventory note in `docs/refactor/baseline.md`.
- [ ] Create `docs/refactor/dependencies.md` with package and service dependencies.
- [ ] Create `docs/refactor/test-matrix.md` with validation expectations.
- [ ] Create `docs/refactor/migration-log.md` to track file moves and decisions.

## Deliverables
- Baseline inventory note in `docs/refactor/baseline.md` (includes config, contracts, observability).
- List of hotspots and repeated patterns by app.
- Agreed refactor constraints and validation baseline.
- Dependency map in `docs/refactor/dependencies.md`.
- Test/smoke matrix in `docs/refactor/test-matrix.md`.
- Baseline performance/throughput snapshot for ingestion and scraper queues.
- Migration log template in `docs/refactor/migration-log.md`.

## Validation and Exit Criteria
- [ ] Baseline note reviewed and agreed.
- [ ] Phase dependencies confirmed.
- [ ] Constraints accepted by stakeholders.
- [ ] Contract and observability baselines reviewed.
