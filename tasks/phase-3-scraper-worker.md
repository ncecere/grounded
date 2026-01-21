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
