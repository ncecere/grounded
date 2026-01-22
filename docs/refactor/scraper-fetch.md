## Purpose

- Document the scraper worker fetch flow and strategy decision rules.
- Provide references to the fetch modules that implement each strategy.

## Fetch Flow

1. `page-fetch` queue receives the `fetch` job (handler: `apps/scraper-worker/src/jobs/page-fetch.ts`).
2. The worker supplies a Playwright browser instance from `apps/scraper-worker/src/browser/pool.ts`.
3. `processPageFetch` acquires a fairness slot via `withFairnessSlotOrThrow` to balance concurrent runs.
4. `selectAndFetch` chooses the fetch strategy using the job `fetchMode` and source config.
5. The fetch strategy returns `{ html, title }` and crawl state is updated in Redis.
6. HTML is staged in Redis via `storeFetchedHtml` for the ingestion processing stage.
7. Stage progress is incremented; when scraping completes, a `StageTransitionJob` is queued.

## Fetch Payload Invariants

**Job payload (`PageFetchJob`)**
- `tenantId` is a UUID or `null` for global runs.
- `runId` is a required UUID for the source run.
- `url` is a required absolute URL.
- `fetchMode` is one of `auto`, `html`, `headless`, or `firecrawl`.
- `depth` is an optional integer `>= 0` describing crawl depth.
- `parentUrl` is an optional absolute URL for crawl graph context.
- `requestId`/`traceId` are optional correlation fields for logs.

**Fetch output constraints**
- HTML responses are required when `isContentTypeEnforcementEnabled()` is true (`text/html` or `application/xhtml+xml`).
- `Content-Length` and streamed body sizes must be `<= MAX_PAGE_SIZE_BYTES` (10 MB).
- Pages that exceed size limits or fail content-type checks are rejected before storage.

## Decision Rules

**Fetch mode selection**
- `fetchMode = firecrawl` uses Firecrawl immediately.
- `fetchMode = auto` with `source.config.firecrawlEnabled = true` uses Firecrawl.
- `fetchMode = headless` uses Playwright.
- `fetchMode = auto` or `html` uses HTTP first, with Playwright fallback enabled.

**HTTP fallback behavior**
- If the HTTP fetch throws an error, fall back to Playwright.
- If the HTTP fetch succeeds but `needsJsRendering(html)` is true, fall back to Playwright.
- If fallback is not allowed, the HTTP error is re-thrown.

**JS rendering heuristics**
- `needsJsRendering` checks body text length and framework indicators.
- Pages with `< 500` characters of body text trigger JS rendering.
- Pages with framework indicators and `< 1000` characters of text trigger JS rendering.
- Framework indicators include `data-reactroot`, `__NEXT_DATA__`, `__NUXT__`, `id="root"`, and `id="app"`.

## Strategy Details

**HTTP fetch (`apps/scraper-worker/src/fetch/http.ts`)**
- Uses `SCRAPE_TIMEOUT_MS` (30s) with an AbortController.
- Sends a fixed user agent plus `Accept: text/html` headers.
- Enforces HTML content types when `isContentTypeEnforcementEnabled()` is true.
- Validates `Content-Length` against `MAX_PAGE_SIZE_BYTES` (10 MB).
- Extracts the page title from the `<title>` tag.

**Playwright fetch (`apps/scraper-worker/src/fetch/playwright.ts`)**
- Uses the shared browser pool and a per-request context.
- Waits for `networkidle` and then an additional 1s for dynamic content.
- Honors `isPlaywrightDownloadsDisabled()` and logs blocked downloads when enabled.
- Uses `SCRAPE_TIMEOUT_MS` for the navigation timeout.

**Firecrawl fetch (`apps/scraper-worker/src/fetch/firecrawl.ts`)**
- Requires `FIRECRAWL_API_KEY` and uses `FIRECRAWL_API_URL`.
- Sends `POST /v1/scrape` with `{ formats: ["html"], waitFor: 2000 }`.
- Returns HTML plus optional metadata title.
