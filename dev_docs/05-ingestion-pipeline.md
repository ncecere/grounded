# Ingestion Pipeline

The ingestion pipeline transforms raw content (web pages, uploaded documents) into searchable, embeddable knowledge chunks. This document covers every stage, the services involved, the scrape mode differences, the file upload flow, and the stage transition mechanism.

## Pipeline Overview

```
DISCOVER → FETCH → EXTRACT → CHUNK → EMBED → INDEX → FINALIZE
```

Two distinct paths enter the pipeline:
- **Web sources** — Full pipeline from DISCOVER through FINALIZE
- **File uploads** — Enter at EXTRACT (text already extracted at upload time)

---

## Source Configuration

All source behavior is driven by `SourceConfig` (defined in `packages/shared/src/types/index.ts`):

```typescript
type SourceConfig = {
  mode: "single" | "list" | "sitemap" | "domain";
  url?: string;          // For single, sitemap, domain modes
  urls?: string[];       // For list mode
  depth: number;         // Max crawl depth for domain mode (1-10, default: 3)
  includePatterns: string[];   // Glob patterns for URL inclusion
  excludePatterns: string[];   // Glob patterns for URL exclusion
  includeSubdomains: boolean;  // Follow links to subdomains
  schedule: "daily" | "weekly" | null;
  firecrawlEnabled: boolean;
  respectRobotsTxt: boolean;   // Default: true
};

type FetchMode = "auto" | "html" | "headless" | "firecrawl";
```

---

## Web Scraping: The Four Modes

### Single Page Mode (`mode: "single"`)

Simplest mode — scrapes exactly one URL.

**Discovery:** Enqueues the single `config.url`.  
**Use case:** FAQ pages, specific articles, landing pages.

### List Mode (`mode: "list"`)

Scrapes a curated list of URLs.

**Discovery:** Enqueues all URLs from `config.urls` array.  
**Use case:** Hand-picked pages across different sections of a site.

### Sitemap Mode (`mode: "sitemap"`)

Discovers pages from XML sitemaps.

**Discovery flow:**
1. Fetches `config.url` (expected to be a sitemap XML)
2. Parses `<loc>` tags to extract URLs
3. Recursively follows nested sitemaps (URLs ending in `.xml`)
4. Enqueues all discovered URLs

**Service:** `processSourceDiscover()` in `apps/ingestion-worker/src/jobs/source-discover.ts`  
**Parser:** Simple regex-based `<loc>` extraction (not a full XML parser)  
**Use case:** Well-structured sites with maintained sitemaps.

### Domain Crawl Mode (`mode: "domain"`)

Discovers pages by following links starting from a seed URL.

**Discovery flow:**
1. Enqueues only the seed `config.url`
2. During FETCH stage, each page's links are extracted and filtered
3. New URLs are discovered dynamically as pages are fetched
4. Crawling respects `config.depth` (0-based depth counter per page)

**Key difference from other modes:** Discovery is continuous — new URLs are found during scraping, not all upfront.

**Link discovery pipeline** (`apps/scraper-worker/src/services/link-extractor.ts`):
```
extractLinksFromHTML(html, pageUrl)
  → filterLinksByDomain(links, seedUrl, includeSubdomains)
    → filterLinksByPatterns(links, includePatterns, excludePatterns)
      → crawlState.queueUrls(newLinks)  // Redis deduplication
        → addPageFetchJob(url, depth + 1)
```

**Link extraction details:**
- Uses `cheerio` to parse HTML `<a href>` tags
- Resolves relative URLs against the page URL
- Strips fragments (`#section`)
- Skips non-HTTP protocols (`mailto:`, `javascript:`, etc.)
- Skips non-page file extensions (`.png`, `.pdf`, `.css`, `.js`, etc. — 40+ extensions)
- Domain filtering: only follows links to `seedUrl` hostname (or subdomains if enabled)

**Depth tracking:**
- Seed URL starts at depth 0
- Each discovered child URL gets `depth + 1`
- When `depth >= config.depth`, link discovery is skipped for that page
- Example: `depth: 3` means seed → child → grandchild → great-grandchild (4 levels total)

**CrawlState** (`packages/crawl-state/`):
- Redis-backed state machine per run
- Tracks URLs: queued → fetched | failed
- Atomic deduplication via `SADD` (prevents duplicate fetches)
- Bounded at 10,000 URLs per run (safety limit)

---

## Stage 1: DISCOVER

**Worker:** Ingestion Worker  
**Queue:** `source-run`  
**Handler:** `apps/ingestion-worker/src/jobs/source-discover.ts`

**Flow:**
1. Load `sourceRun` and `source` from database
2. Initialize `CrawlState` in Redis for the run
3. Discover URLs based on `source.config.mode` (see above)
4. Apply include/exclude patterns via glob matching (`matchPattern()`)
5. Filter through robots.txt rules (`filterUrlsByRobotsRules()`)
6. Queue filtered URLs in CrawlState (Redis `SADD` for dedup)
7. Update `sourceRuns.stats.pagesSeen`
8. Initialize stage progress in Redis
9. Trigger `STAGE_TRANSITION` job → transitions to SCRAPING

**Pattern matching** (used in both discovery and link extraction):
```
*   → matches any character except /
**  → matches anything (including /)
?   → matches single character
```
Converted to regex at runtime.

**Robots.txt handling** (`apps/ingestion-worker/src/services/robots.ts`):
- Fetches and parses `robots.txt` for each domain
- Filters URLs based on `User-agent: *` rules
- Can be overridden via `config.respectRobotsTxt: false`
- Logs blocked URLs and override usage

---

## Stage 2: FETCH

**Worker:** Scraper Worker  
**Queue:** `page-fetch`  
**Handler:** `apps/scraper-worker/src/processors/page-fetch.ts`

**Flow per page:**
1. Acquire fairness slot (`withFairnessSlotOrThrow`) — see [Workers & Fairness](./15-workers-and-fairness.md)
2. Check if run is canceled
3. Select and execute fetch strategy
4. Mark URL as fetched in CrawlState
5. Store HTML in Redis (`storeFetchedHtml`) for PROCESSING stage
6. For domain mode: discover links → queue new `page-fetch` jobs
7. Increment stage progress
8. If stage complete: trigger transition to PROCESSING

### Fetch Strategy Selection

**Service:** `apps/scraper-worker/src/fetch/selection.ts`

Decision tree:
```
fetchMode === "firecrawl"                          → firecrawl.ts
fetchMode === "auto" && source.firecrawlEnabled    → firecrawl.ts
fetchMode === "headless"                           → playwright.ts
fetchMode === "auto" || "html"                     → http.ts first
    ├─ HTTP succeeds + needsJsRendering() → true   → playwright.ts (fallback)
    ├─ HTTP fails                                   → playwright.ts (fallback)
    └─ HTTP succeeds + content OK                   → use HTTP result
```

### Fetch Implementations

| Strategy | File | Method | When Used |
|----------|------|--------|-----------|
| **HTTP** | `fetch/http.ts` | `fetchWithHttp()` | Simple GET request. Fastest. |
| **Playwright** | `fetch/playwright.ts` | `fetchWithPlaywright()` | Full Chromium rendering. For JS-heavy sites. |
| **Firecrawl** | `fetch/firecrawl.ts` | `fetchWithFirecrawl()` | External API service. For complex sites. |

### JS Rendering Detection

**Service:** `apps/scraper-worker/src/services/content-validation.ts`

`needsJsRendering(html)` checks if HTTP-fetched HTML is a JS shell:
- Body text length < `MIN_BODY_TEXT_LENGTH` (threshold for "too little content")
- Presence of JS framework indicators (React root divs, Vue app mounts, Angular app tags, etc.)
- If detected: domain is cached in an in-memory LRU map (500 entries). Subsequent pages from the same domain skip HTTP and go directly to Playwright.

### Domain Crawl Link Discovery (during FETCH)

In `processPageFetch()`, after fetching a domain-mode page:
1. Call `discoverLinks()` from `services/link-extractor.ts`
2. Filter by domain, patterns, depth
3. Deduplicate via `crawlState.queueUrls()` (returns only truly new URLs)
4. **Critical:** `incrementStageProgressTotal()` BEFORE queuing new jobs (prevents premature stage completion)
5. Queue `page-fetch` jobs at `depth + 1`

### Redis HTML Staging

Fetched HTML is stored temporarily in Redis (not the database) to avoid bloating PostgreSQL:
- `storeFetchedHtml(runId, url, html, title)` — stores with TTL
- `getFetchedHtml(runId, url)` — retrieved during PROCESSING
- `deleteFetchedHtml(runId, url)` — cleaned up after processing

---

## Stage 3: EXTRACT (Processing)

**Worker:** Ingestion Worker  
**Queue:** `page-process`  
**Handler:** `apps/ingestion-worker/src/jobs/page-process.ts`

**Flow per page:**
1. Get HTML from Redis (web sources) or from job data (uploads)
2. Extract content using `extractContent()` service
3. Compute content hash for deduplication
4. **Skip-if-unchanged:** If content hash matches previous run AND chunks exist → skip
5. Create `sourceRunPages` record (status: succeeded)
6. Store extracted content in `sourceRunPageContents` table
7. Clean up HTML from Redis
8. Increment stage progress → trigger transition to INDEXING when complete

**Content Extraction** (`apps/ingestion-worker/src/services/extraction.ts`):
```typescript
extractContent(html) → { mainContent: string, headings: Heading[] }
```
- Strips `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<aside>` tags
- Extracts headings (`h1-h6`) with nesting paths (e.g., "Getting Started > Installation")
- Converts remaining HTML to plain text
- Sanitizes null bytes (`\u0000`)

**Heading hierarchy example:**
```
<h1>Product Guide</h1>           → "Product Guide"
  <h2>Getting Started</h2>       → "Product Guide > Getting Started"
    <h3>Installation</h3>        → "Product Guide > Getting Started > Installation"
  <h2>API Reference</h2>         → "Product Guide > API Reference"
```

---

## Stage 4: CHUNK (Indexing)

**Worker:** Ingestion Worker  
**Queue:** `page-index`  
**Handler:** `apps/ingestion-worker/src/jobs/page-index.ts`

**Flow per page:**
1. Read staged content from `sourceRunPageContents`
2. Soft-delete old chunks for this URL (from previous runs)
3. Split content into overlapping chunks
4. Insert new `kbChunks` records with:
   - Content text
   - Content hash
   - Heading and section path (from nearest heading)
   - Chunk index (position within page)
   - tsvector for PostgreSQL full-text search
5. Queue enrichment job if `source.enrichmentEnabled` (optional)
6. Clean up staged content from `sourceRunPageContents`
7. Increment stage progress → trigger transition to EMBEDDING when complete

**Chunking algorithm** (`chunkText()` in `page-index.ts`):
- **Chunk size:** 800 tokens × ~4 chars/token = ~3,200 characters
- **Overlap:** 120 tokens × ~4 chars/token = ~480 characters
- Sentence boundary detection: searches ±200 chars around the split point for `.!? ` patterns
- Configurable via `CHUNK_SIZE_TOKENS` and `CHUNK_OVERLAP_TOKENS` constants

**Chunk → Heading assignment:**
- Estimates chunk position as `chunkIndex / totalChunks`
- Maps to the most recent heading before that estimated position
- Assigns heading text and full path (e.g., "Product Guide > Getting Started")

---

## Stage 5: EMBED

**Worker:** Ingestion Worker  
**Queue:** `embed-chunks`  
**Handler:** `apps/ingestion-worker/src/jobs/embed-chunks.ts`

**Flow per batch:**
1. Receive batch of chunk IDs (batch size: 50 chunks per job)
2. Fetch chunk content from `kbChunks`
3. Look up KB's embedding model via `embeddingModelId`
4. Call embedding API:
   - **Batch size per API call:** 100 texts (`EMBEDDING_BATCH_SIZE`)
   - **Parallel API calls:** 3 concurrent (`EMBEDDING_PARALLEL_BATCHES`)
5. Upsert vectors in pgvector (`packages/vector-store/`)
6. Update `sourceRuns.chunksEmbedded` counter
7. Increment stage progress → trigger transition when complete

**Deduplication:** Job IDs are deterministic hashes of chunk IDs, so re-queuing the same batch is a no-op.

**Backpressure:** Monitors embed queue depth and pauses if overwhelmed.

---

## Stage 6: INDEX (Finalization)

After all embedding jobs complete, `transitionToNextStage()` reaches `COMPLETED`:

**Handler:** `finalizeRun()` in `apps/ingestion-worker/src/stage/transitions.ts`

1. Query all `sourceRunPages` for the run
2. Compute final stats:
   - `succeeded` = pages with successful processing
   - `failed` = pages that failed at any stage
   - `skipped` = pages skipped (unchanged content or non-HTML)
3. Determine final status:
   - All succeeded → `succeeded`
   - Some failed, some succeeded → `partial`
   - All failed → `failed`
4. Update `sourceRuns` with final status, stats, and `finishedAt`
5. Update linked `uploads` records
6. Cleanup Redis state (CrawlState, stage progress, staged HTML)

---

## File Upload Flow

File uploads follow a different entry path but merge into the same pipeline at PROCESSING.

### Upload Route

**Endpoint:** `POST /api/v1/uploads` (tenant) or `POST /api/v1/admin/shared-kbs/:kbId/uploads` (global)  
**Handler:** `apps/api/src/routes/uploads.ts`

**Flow:**
1. Validate file type and size (max 15 MB)
2. MIME type detection: checks `Content-Type` header, falls back to file extension mapping
3. Create or find existing upload source (type: `upload`)
4. Extract text from file immediately (synchronous, in the API process)
5. Create `uploads` record with extracted text
6. Create `sourceRun` record (status: running)
7. Queue `page-process` job with extracted text as `html` field

### Text Extraction

**Service:** `apps/api/src/services/upload-helpers.ts` — `extractTextFromUpload(content, mimeType, filename)`

| File Type | MIME Type | Library | Extraction Method |
|-----------|----------|---------|-------------------|
| **PDF** | `application/pdf` | `pdf-parse` | Text extraction from all pages |
| **Word (.docx)** | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `mammoth` | Raw text extraction with structure |
| **Excel (.xlsx)** | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `ExcelJS` | Sheet name + row values (max 1,000 rows/sheet) |
| **PowerPoint (.pptx)** | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `JSZip` + regex | Slide-by-slide text nodes (`<a:t>` tags, max 200 slides) |
| **CSV** | `text/csv` | `csv-parse` | Column headers + row key-value pairs (max 1,000 rows) |
| **Plain text** | `text/plain`, `text/markdown` | Built-in | Direct UTF-8 decode |
| **HTML** | `text/html` | Built-in | Strip tags, decode entities |
| **JSON** | `application/json` | Built-in | Pretty-printed JSON |
| **XML** | `application/xml` | Built-in | Strip tags, decode CDATA |

**Safety limits:**
- PPTX: max 3,000 zip entries, max 200 slides, max 2 MB per slide XML, max 1M chars total
- Excel: max 1,000 rows per sheet
- CSV: max 1,000 rows displayed
- All: null bytes stripped (`\u0000`)

**Legacy format handling:**
- `.doc` → Error: "Please convert to .docx"
- `.xls` → Error: "Please convert to .xlsx"
- `.ppt` → Error: "Please convert to .pptx or .pdf"

### Upload URL Scheme

Uploaded files use `upload://` URIs instead of HTTP URLs:
```
upload://{uploadId}/{filename}
```

This URI is used as the page URL throughout the pipeline and appears in `kbChunks.normalizedUrl`.

### Batch Upload Mode

The upload route supports batch mode for multi-file uploads:
1. Upload files individually with `batch=true` and shared `sourceRunId`
2. Call `POST /uploads/finalize` with the `sourceRunId`
3. All files are queued as `page-process` jobs simultaneously

---

## Stage Transition Mechanism

The stage transition system orchestrates the pipeline's sequential execution across distributed workers.

**Module:** `apps/ingestion-worker/src/stage/transitions.ts`

### Stage Order

```typescript
const STAGE_ORDER = [
  DISCOVERING, SCRAPING, PROCESSING, INDEXING, EMBEDDING, COMPLETED
];
```

### How Transitions Work

Each stage uses Redis-based progress counters (total, completed, failed):

1. When a job finishes, it calls `incrementStageProgress(runId, isFailed)`
2. The counter returns `{ completed, failed, total, isComplete }`
3. `isComplete` = `(completed + failed) >= total`
4. When complete, the finishing job queues a `STAGE_TRANSITION` job
5. The transition handler calls `transitionToNextStage(runId)`:
   a. Gets `nextStage` from `STAGE_ORDER`
   b. Counts items for next stage (`getItemCountForStage()`)
   c. If 0 items → **skip** to the following stage (recursive)
   d. If items > 0 → initialize stage, queue jobs for all items

### Item Count per Stage

| Stage | Source of Items |
|-------|----------------|
| SCRAPING | URLs queued in CrawlState (Redis) |
| PROCESSING | URLs with fetched HTML in Redis |
| INDEXING | Pages with `currentStage = "extract"` and `status = "succeeded"` |
| EMBEDDING | Chunks ÷ batch size (50) = number of embed jobs |

### Stage Job Queuing

**Module:** `apps/ingestion-worker/src/stage/` (queue-scraping, queue-processing, queue-indexing, queue-embedding)

Each stage has a dedicated queue function that:
1. Reads the items for that stage
2. Creates BullMQ jobs for each item
3. For SCRAPING: registers the run with the fairness scheduler

### Race Condition Prevention

**Domain crawl stage total updates:**
When new URLs are discovered during domain crawling:
1. `incrementStageProgressTotal()` is called BEFORE queuing new jobs
2. This prevents: worker A finishes last known job → stage appears complete → transition fires → but worker B just discovered 50 more URLs

**Why the last job triggers transition:**
Only the job that makes `completed + failed >= total` queues the transition. This is safe because `incrementStageProgress` is atomic (Redis INCR).

---

## Queue Configuration

All queues use BullMQ with shared defaults:

| Setting | Value |
|---------|-------|
| Retry attempts | 3 |
| Backoff type | Exponential |
| Initial retry delay | 5,000 ms |
| Completed job retention | 1,000 jobs |
| Failed job retention | 5,000 jobs |

**Queue names** (in `packages/queue/src/index.ts`):

| Queue | Worker | Purpose |
|-------|--------|---------|
| `source-run` | Ingestion | Source run lifecycle (start, discover) |
| `page-fetch` | Scraper | URL fetching |
| `page-process` | Ingestion | Content extraction |
| `page-index` | Ingestion | Chunking and DB storage |
| `embed-chunks` | Ingestion | Embedding generation |
| `enrich-page` | Ingestion | Optional AI enrichment |
| `stage-transition` | Ingestion | Stage progression coordinator |
| `deletion` | Ingestion | Hard delete processing |
| `kb-reindex` | Ingestion | Re-embedding on model change |

---

## Enrichment (Optional)

When `source.enrichmentEnabled` is true, after chunking an additional `enrich-page` job is queued.

**Handler:** `apps/ingestion-worker/src/jobs/enrich-page.ts`

The LLM extracts metadata per chunk:
- `tags` — Topic tags
- `entities` — Named entities (people, places, products)
- `keywords` — Search keywords
- `summary` — Brief chunk summary

Stored in the `kbChunks` record for enhanced search and filtering.

---

## Source Run Lifecycle

```
pending → running → [stages] → succeeded | partial | failed | canceled
```

**Status transitions:**
| From | To | When |
|------|----|------|
| `pending` | `running` | First job starts processing |
| `running` | `succeeded` | All pages processed successfully |
| `running` | `partial` | Some pages failed, some succeeded |
| `running` | `failed` | All pages failed or critical error |
| `running` | `canceled` | User clicked Stop Run |

**Stage tracking** (`sourceRuns.stage`):
```
discovering → scraping → processing → indexing → embedding → completed
```

**Per-stage counters:**
- `stageTotal`: Items in current stage
- `stageCompleted`: Items completed
- `stageFailed`: Items failed

---

## Error Handling

- Each stage has independent retry (3 attempts, exponential backoff)
- Stage failures are recorded per page in `sourceRunPages`
- A page failure doesn't block other pages
- `incrementStageProgress(runId, true)` is called in catch blocks to prevent stuck runs
- Stuck run recovery: `apps/api/src/services/source-run-recovery.ts` detects runs stuck beyond a threshold
- Redis HTML staging has TTL to prevent orphaned data

---

## File Map

### Ingestion Worker (`apps/ingestion-worker/src/`)

| File | Purpose |
|------|---------|
| `jobs/source-run-start.ts` | Initializes a source run |
| `jobs/source-discover.ts` | URL discovery (all 4 modes) |
| `jobs/page-process.ts` | Content extraction (PROCESSING stage) |
| `jobs/page-index.ts` | Chunking (INDEXING stage) |
| `jobs/embed-chunks.ts` | Embedding (EMBEDDING stage) |
| `jobs/enrich-page.ts` | Optional AI enrichment |
| `jobs/stage-transition.ts` | Stage transition dispatcher |
| `jobs/source-finalize.ts` | Run finalization |
| `jobs/hard-delete.ts` | Permanent deletion |
| `jobs/kb-reindex.ts` | Re-embedding on model change |
| `services/extraction.ts` | HTML → text + headings |
| `services/robots.ts` | Robots.txt parsing and filtering |
| `stage/transitions.ts` | Stage order, item counting, finalization |
| `stage/progress.ts` | Redis-based progress tracking |
| `stage/queue-scraping.ts` | Queues page-fetch jobs + fairness registration |
| `stage/queue-processing.ts` | Queues page-process jobs |
| `stage/queue-indexing.ts` | Queues page-index jobs |
| `stage/queue-embedding.ts` | Queues embed-chunks jobs |
| `stage/cleanup.ts` | Redis cleanup after run |

### Scraper Worker (`apps/scraper-worker/src/`)

| File | Purpose |
|------|---------|
| `processors/page-fetch.ts` | Main fetch orchestrator (fairness + fetch + links) |
| `fetch/selection.ts` | Fetch strategy selection logic |
| `fetch/http.ts` | Simple HTTP GET fetch |
| `fetch/playwright.ts` | Headless browser fetch |
| `fetch/firecrawl.ts` | Firecrawl API fetch |
| `services/content-validation.ts` | JS rendering detection |
| `services/link-extractor.ts` | HTML link discovery for domain crawls |
| `services/fairness-slots.ts` | Fairness slot acquire/release wrappers |
| `services/url-validation.ts` | URL normalization and validation |
| `browser/pool.ts` | Playwright browser pool management |

### API (`apps/api/src/`)

| File | Purpose |
|------|---------|
| `routes/uploads.ts` | File upload endpoint (tenant) |
| `routes/sources.ts` | Source CRUD + run triggers |
| `routes/admin/shared-kbs.ts` | Global KB upload endpoint |
| `services/upload-helpers.ts` | Text extraction from files (all formats) |
| `services/source-helpers.ts` | Source run creation, stats, soft-delete cascading |
| `services/source-run-recovery.ts` | Stuck run detection and recovery |
