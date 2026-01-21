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

## Dependencies
- None (information gathering only).

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

## Task List
- [x] Document runtime entrypoints and startup sequence per app.
- [x] Document environment variables and settings precedence per app (including dynamic settings fetch).
- [ ] Map the ingestion pipeline flow with owning modules and queues.
- [ ] Map queue names to job payloads and owning processors.
- [ ] Capture contract baselines for API responses, SSE events, and queue payloads.
- [ ] Capture observability keys (log fields, error codes, metrics) by app.
- [ ] Inventory API routes and their owning files.
- [ ] Inventory web pages and navigation flows.
- [ ] Identify the largest files and repeated patterns in each app.
- [ ] Capture cross-cutting helpers (auth, audit, RLS, logging, settings).
- [ ] Map tenant boundary/RLS enforcement touchpoints.
- [ ] Inventory shared packages and their consumers (shared, queue, logger, db).
- [ ] Record current environment/config dependencies for startup.
- [ ] Record external service dependencies (AI providers, vector store, storage).
- [ ] Record baseline throughput and performance metrics for ingestion and scraper queues.
- [ ] Build a critical workflow checklist with expected outputs (auth, chat SSE, ingestion, scrape).
- [ ] List existing tests and smoke checks used today.
- [ ] Build a test/smoke matrix by app and workflow.
- [ ] Define refactor constraints (no API response changes, no schema changes).
- [ ] Note phase dependencies and potential blockers.
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
