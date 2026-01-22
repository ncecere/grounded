# Phase 3: Scraper Worker Modularization

## Objectives
- Separate fetch strategies from orchestration logic.
- Make browser lifecycle and settings handling reusable.
- Simplify the page fetch processor and error paths.

## Scope
- `apps/scraper-worker/src/index.ts`.
- `apps/scraper-worker/src/processors/page-fetch.ts`.

## Out of Scope
- Queue or fairness behavior changes.
- Ingestion worker changes.
- Scraping behavior changes beyond refactor.

## Dependencies
- Phase 0 baseline inventory complete.

## Folder Layout
Proposed structure for `apps/scraper-worker/src/`:

```
apps/scraper-worker/src/
  index.ts
  bootstrap/
    index.ts
    settings.ts
  jobs/
    index.ts
    page-fetch.ts
  fetch/
    index.ts
    http.ts
    playwright.ts
    firecrawl.ts
    selection.ts
  browser/
    pool.ts
  services/
    content-validation.ts
    fairness-slots.ts
```

### File Mapping from Current to Proposed

| Current Location | Proposed Location | Notes |
| --- | --- | --- |
| `index.ts` (settings init + refresh) | `bootstrap/settings.ts` | Own settings fetch, fairness config updates. |
| `index.ts` (startup + shutdown wiring) | `bootstrap/index.ts` | Initialize settings, register shutdown handlers. |
| `index.ts` (browser lifecycle) | `browser/pool.ts` | Centralized Playwright reuse + teardown. |
| `index.ts` (page fetch worker) | `jobs/page-fetch.ts` | Job orchestration and error handling. |
| `processors/page-fetch.ts` | `jobs/page-fetch.ts` + `fetch/*` + `services/content-validation.ts` | Split fetch strategy + validation helpers. |

### Module Responsibilities
- **bootstrap/**: Initialize settings client, fairness config refresh, startup/shutdown wiring.
- **jobs/**: BullMQ handlers that orchestrate fetch selection and page processing.
- **fetch/**: Strategy-specific fetch implementations with shared request interface.
- **browser/**: Playwright browser pool lifecycle and reuse policies.
- **services/**: Shared helpers (fairness slots, content validation) used by jobs.

## Browser Pool Shutdown Expectations

When the scraper worker receives `SIGTERM`/`SIGINT`, the shutdown handler follows this sequence for in-flight pages:

### Shutdown Sequence

1. **Stop settings refresh** - Prevents new settings pulls during shutdown.
2. **Close BullMQ worker** - Calls `worker.close()` which:
   - Stops fetching new jobs from the queue.
   - Waits for currently active job handlers to complete.
   - In-flight pages continue processing until finished.
3. **Shutdown browser pool** - Calls `shutdownBrowserPool()` which:
   - Marks pool as shutting down (blocks new `getBrowser()` calls).
   - Closes the Playwright browser instance.
   - Any pages open in the browser are terminated.
4. **Exit process** - Exit with code 0 on successful shutdown.

### In-Flight Page Handling

- **Active jobs wait to complete**: BullMQ's `worker.close()` waits for active handlers. If a page fetch is in progress, it will complete normally before shutdown continues.
- **Browser pool blocks new acquisitions**: Once `shutdownBrowserPool()` is called, `getBrowser()` throws an error. However, this only affects new jobs; active jobs already have their browser reference.
- **Pages terminated with browser**: If the process is forcefully killed (e.g., `SIGKILL` or timeout), the browser closes immediately and any in-flight pages are lost. BullMQ handles retries using the job's attempt configuration.
- **No orphaned browser processes**: The pool ensures the browser is closed on shutdown. If browser close fails, the error is logged but shutdown continues.

### Fairness Slot Cleanup

- Fairness slots are managed in Redis by the `@grounded/queue` package.
- When a job completes (success or failure), slots are released automatically.
- On worker shutdown, BullMQ's stalled job detection ensures slots are eventually released for jobs that didn't complete.

### Timeout Behavior

- **Graceful shutdown timeout**: Kubernetes/Docker may impose a termination grace period (default 30s in Kubernetes).
- **BullMQ close timeout**: The `worker.close()` method waits for active jobs. If jobs take longer than the grace period, the process may be killed before jobs complete.
- **Recommendation**: Set the termination grace period higher than expected page fetch duration (e.g., 60s+) to allow in-flight fetches to complete.

### Error Handling During Shutdown

- Browser close errors are caught and logged but don't prevent shutdown.
- Multiple shutdown calls are idempotent (safe to call repeatedly).
- Re-initializing the pool after shutdown resets the shutdown flag.

## Task List
- [ ] Define folder layout: `bootstrap/`, `jobs/`, `fetch/`, `browser/`, `services/`.
- [ ] Extract fetch strategies into `fetch/http.ts`, `fetch/playwright.ts`, and `fetch/firecrawl.ts`.
- [ ] Add a fetch selection helper that keeps existing decision rules.
- [ ] Create a browser pool helper in `browser/pool.ts` with lifecycle management.
- [ ] Define browser pool shutdown expectations for in-flight pages.
- [ ] Add a fairness slot helper to wrap acquire/release behavior.
- [ ] Preserve fairness scheduling behavior and settings refresh semantics.
- [ ] Move content-type checks and size limits into `services/content-validation.ts`.
- [ ] Update page fetch job handler to orchestrate modules and reduce size.
- [ ] Centralize settings initialization in `bootstrap/` and reuse across jobs.
- [ ] Preserve logging/metric keys and error codes used today.
- [ ] Add `jobs/index.ts` to register worker handlers.
- [ ] Update imports and ensure job wiring remains unchanged.
- [ ] Add or update targeted tests for fetch selection and validation helpers.
- [ ] Create `docs/refactor/scraper-fetch.md` with fetch flow and decision rules.
- [ ] Document fetch payload invariants in `docs/refactor/scraper-fetch.md`.

## Deliverables
- Modular scraper worker structure with isolated fetch logic.
- Simplified page fetch processor.
- Reusable browser pool utility.
- Fetch flow doc in `docs/refactor/scraper-fetch.md` (includes payload invariants).

## Validation and Exit Criteria
- [ ] `bun run --filter @grounded/scraper-worker typecheck` passes.
- [ ] `bun run --filter @grounded/scraper-worker test` passes (if configured).
- [ ] Worker starts locally without errors.
- [ ] Trigger a scraping run and confirm expected fetch behavior.
- [ ] Fairness slots, settings refresh cadence, and logging keys unchanged.
