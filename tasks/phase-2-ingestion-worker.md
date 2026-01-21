# Phase 2: Ingestion Worker Modularization

## Objectives
- Reduce complexity in the worker entrypoint.
- Modularize stage management and job orchestration.
- Isolate helpers (robots, extraction) for reuse and testability.

## Scope
- `apps/ingestion-worker/src/index.ts`.
- `apps/ingestion-worker/src/stage-manager.ts` and `apps/ingestion-worker/src/stage-job-queuer.ts`.
- All ingestion processors under `apps/ingestion-worker/src/processors/`.

## Out of Scope
- Queue name changes or behavior changes.
- Changes to data model or schema.
- Scraper worker changes.

## Dependencies
- Phase 0 baseline inventory complete.

## Task List
- [ ] Define folder layout: `bootstrap/`, `queues/`, `jobs/`, `stage/`, `services/`.
- [ ] Add a worker helper for consistent logging and error handling.
- [ ] Preserve logging/metric keys and error codes used today.
- [ ] Move processor functions into `jobs/` and keep `queues/` for Worker registration.
- [ ] Add `jobs/index.ts` (or equivalent) to register all job handlers.
- [ ] Split stage manager into `stage/config.ts`, `stage/progress.ts`, `stage/transitions.ts`, `stage/cleanup.ts`, `stage/priority.ts`.
- [ ] Split stage job queuer into `stage/queue-scraping.ts`, `stage/queue-processing.ts`, `stage/queue-indexing.ts`, `stage/queue-embedding.ts`.
- [ ] Extract robots handling into `services/robots.ts`.
- [ ] Extract HTML content parsing into `services/extraction.ts`.
- [ ] Centralize settings and vector store initialization in `bootstrap/`.
- [ ] Preserve settings refresh behavior and concurrency semantics.
- [ ] Add `bootstrap/shutdown.ts` to standardize graceful shutdown.
- [ ] Define graceful shutdown expectations for in-flight jobs.
- [ ] Update imports and ensure the job wiring remains unchanged.
- [ ] Add or update targeted unit tests for stage transitions and queueing helpers.
- [ ] Create `docs/refactor/ingestion-jobs.md` with job and queue mapping.
- [ ] Document job payload invariants and retry/idempotency rules in `docs/refactor/ingestion-jobs.md`.

## Deliverables
- Modular ingestion worker structure with clear job and stage boundaries.
- Reduced size of `apps/ingestion-worker/src/index.ts`.
- Shared helper modules for robots and extraction.
- Job/queue mapping and payload invariants in `docs/refactor/ingestion-jobs.md`.

## Validation and Exit Criteria
- [ ] `bun run --filter @grounded/ingestion-worker typecheck` passes.
- [ ] `bun run --filter @grounded/ingestion-worker test` passes (if configured).
- [ ] Worker starts locally without errors.
- [ ] Trigger a source run and verify stage transitions (discover -> scrape -> process -> index -> embed).
- [ ] Logging/metric keys and settings refresh cadence unchanged.
