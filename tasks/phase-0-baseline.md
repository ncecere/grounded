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

## Task List
- [x] Document runtime entrypoints and startup sequence per app.
- [ ] Document environment variables and settings precedence per app (including dynamic settings fetch).
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
