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

## Folder Layout

The ingestion worker will be reorganized into the following structure. This layout separates concerns across bootstrap, queue registration, job handlers, stage management, and reusable services.

```text
apps/ingestion-worker/src/
├── index.ts                    # Slim entrypoint: imports bootstrap, registers queues
├── bootstrap/
│   ├── index.ts                # Exports init(), shutdown(), and settings client
│   ├── settings.ts             # Settings client init, refresh, and concurrency tracking
│   ├── vector-store.ts         # Vector store initialization
│   └── shutdown.ts             # Graceful shutdown helper for all workers
├── queues/
│   ├── index.ts                # Registers all BullMQ Workers, exports worker instances
│   ├── source-run.ts           # Worker for SOURCE_RUN queue (start, discover, finalize, stage-transition)
│   ├── page-process.ts         # Worker for PAGE_PROCESS queue
│   ├── page-index.ts           # Worker for PAGE_INDEX queue
│   ├── embed-chunks.ts         # Worker for EMBED_CHUNKS queue
│   ├── enrich-page.ts          # Worker for ENRICH_PAGE queue
│   ├── deletion.ts             # Worker for DELETION queue
│   └── kb-reindex.ts           # Worker for KB_REINDEX queue
├── jobs/
│   ├── index.ts                # Barrel export of all job handlers
│   ├── source-run-start.ts     # Handler for source run start
│   ├── source-discover.ts      # Handler for URL discovery
│   ├── source-finalize.ts      # Handler for run finalization
│   ├── stage-transition.ts     # Handler for stage transitions
│   ├── page-process.ts         # Handler for page processing
│   ├── page-index.ts           # Handler for page indexing/chunking
│   ├── embed-chunks.ts         # Handler for chunk embedding
│   ├── enrich-page.ts          # Handler for page enrichment
│   ├── hard-delete.ts          # Handler for hard deletion
│   └── kb-reindex.ts           # Handler for KB reindex
├── stage/
│   ├── index.ts                # Barrel export of stage management
│   ├── config.ts               # Stage manager configuration (batch size, rate limits)
│   ├── progress.ts             # Stage progress tracking (init, increment, query)
│   ├── transitions.ts          # Stage ordering and transition logic
│   ├── cleanup.ts              # Redis state cleanup after run completion
│   ├── priority.ts             # Job priority calculation based on run size
│   ├── queue-scraping.ts       # Queues page-fetch jobs for SCRAPING stage
│   ├── queue-processing.ts     # Queues page-process jobs for PROCESSING stage
│   ├── queue-indexing.ts       # Queues page-index jobs for INDEXING stage
│   └── queue-embedding.ts      # Queues embed jobs for EMBEDDING stage
└── services/
    ├── index.ts                # Barrel export of services
    ├── robots.ts               # Robots.txt fetching, parsing, caching, and URL filtering
    └── extraction.ts           # HTML content extraction and heading parsing
```

### File Mapping from Current to Proposed

| Current Location | Proposed Location |
|-----------------|-------------------|
| `index.ts` (worker registration) | `queues/*.ts` |
| `index.ts` (settings init) | `bootstrap/settings.ts` |
| `index.ts` (vector store init) | `bootstrap/vector-store.ts` |
| `index.ts` (shutdown handler) | `bootstrap/shutdown.ts` |
| `processors/source-run-start.ts` | `jobs/source-run-start.ts` |
| `processors/source-discover.ts` | `jobs/source-discover.ts` |
| `processors/source-finalize.ts` | `jobs/source-finalize.ts` |
| `processors/stage-transition.ts` | `jobs/stage-transition.ts` |
| `processors/page-process.ts` | `jobs/page-process.ts` |
| `processors/page-index.ts` | `jobs/page-index.ts` |
| `processors/embed-chunks.ts` | `jobs/embed-chunks.ts` |
| `processors/enrich-page.ts` | `jobs/enrich-page.ts` |
| `processors/hard-delete.ts` | `jobs/hard-delete.ts` |
| `processors/kb-reindex.ts` | `jobs/kb-reindex.ts` |
| `stage-manager.ts` (config section) | `stage/config.ts` |
| `stage-manager.ts` (progress section) | `stage/progress.ts` |
| `stage-manager.ts` (transitions section) | `stage/transitions.ts` |
| `stage-manager.ts` (cleanup section) | `stage/cleanup.ts` |
| `stage-manager.ts` (priority section) | `stage/priority.ts` |
| `stage-job-queuer.ts` (queueScrapingJobs) | `stage/queue-scraping.ts` |
| `stage-job-queuer.ts` (queueProcessingJobs) | `stage/queue-processing.ts` |
| `stage-job-queuer.ts` (queueIndexingJobs) | `stage/queue-indexing.ts` |
| `stage-job-queuer.ts` (queueEmbeddingJobs) | `stage/queue-embedding.ts` |
| `processors/source-discover.ts` (robots logic) | `services/robots.ts` |
| `processors/page-process.ts` (extractContent) | `services/extraction.ts` |

### Module Responsibilities

**bootstrap/**
- `settings.ts`: Initialize settings client, register `onSettingsUpdate` callback, track concurrency changes, start/stop periodic refresh.
- `vector-store.ts`: Check if vector store is configured and call `initializeVectorStore()`.
- `shutdown.ts`: Export `shutdown()` that stops settings refresh and closes all workers.
- `index.ts`: Combine init steps into a single `initBootstrap()` and export `shutdown()`.

**queues/**
- Each file creates a `Worker` instance for a specific queue.
- Worker callbacks import job handlers from `jobs/` and dispatch by job name.
- Concurrency values come from `bootstrap/settings.ts`.
- `index.ts` exports all worker instances and a `registerAllWorkers()` helper if needed.

**jobs/**
- Pure handler functions that receive job data and perform processing.
- No BullMQ Worker creation; only processing logic.
- Each file mirrors a processor from the current `processors/` folder.
- `index.ts` re-exports all handlers for easy import by queue modules.

**stage/**
- `config.ts`: `StageManagerConfig` type, `getStageManagerConfig()`, `setStageManagerConfig()`.
- `progress.ts`: `StageProgress` type, `getStageProgress()`, `initializeStage()`, `markStageItemComplete()`, `incrementStageCompleted()`.
- `transitions.ts`: `STAGE_ORDER`, `getNextStage()`, `getStageIndex()`, `getTotalStages()`, `transitionToNextStage()`, `isRunCanceled()`, `finalizeRun()`.
- `cleanup.ts`: `cleanupRunRedisState()`.
- `priority.ts`: `calculatePriority()`, `getRunSize()`.
- `queue-scraping.ts`: `queueScrapingJobs()`.
- `queue-processing.ts`: `queueProcessingJobs()`.
- `queue-indexing.ts`: `queueIndexingJobs()`.
- `queue-embedding.ts`: `queueEmbeddingJobs()`, `EMBED_BATCH_SIZE`.
- `index.ts`: Re-exports all stage helpers and `queueJobsForStage()` dispatcher.

**services/**
- `robots.ts`: `fetchRobotsTxt()`, `cacheRobotsTxt()`, `filterUrlsByRobotsRules()`, `RobotsFilterResult` type.
- `extraction.ts`: `extractContent()`, `buildHeadingPath()`, `Heading` type.
- `index.ts`: Re-exports robots and extraction helpers.

### Slim Entrypoint (apps/ingestion-worker/src/index.ts)

After refactoring, the entrypoint should look approximately like:

```typescript
import { initBootstrap, shutdown, getWorkerLogger } from "./bootstrap";
import { registerAllWorkers } from "./queues";

const logger = getWorkerLogger();

(async () => {
  await initBootstrap();
  registerAllWorkers();
  logger.info("Ingestion Worker started successfully");
})();

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

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
