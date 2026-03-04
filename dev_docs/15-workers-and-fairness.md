# Workers & Fairness Scheduler (Developer Reference)

This document covers the worker architecture, job flow, settings management, and the fairness scheduler implementation in detail.

## Worker Architecture

Grounded has two worker processes, each running as a separate Bun process:

### Scraper Worker (`apps/scraper-worker/`)

Handles page fetching using HTTP or headless Playwright browser.

**Single queue:**
- `page_fetch` — Downloads web pages

**Key modules:**
| Module | Path | Purpose |
|--------|------|---------|
| `index.ts` | Entry point | Creates BullMQ Worker, handles lifecycle |
| `bootstrap/settings.ts` | Settings management | Fetches from API, refreshes every 60s |
| `browser/pool.ts` | Playwright pool | Lazy browser initialization, shared instance |
| `processors/page-fetch.ts` | Job handler | Fetch logic (HTTP, headless, firecrawl, auto) |
| `services/fairness-slots.ts` | Fairness wrapper | Acquire/release slots with logging |
| `jobs/index.ts` | Job dispatcher | Routes jobs to handlers |

**Startup sequence:**
```
1. Import bootstrap (reads env vars for defaults)
2. Initialize browser pool (lazy — no browser launched yet)
3. Create BullMQ Worker on page_fetch queue
4. initializeSettings() → fetch from API → update fairness config → start 60s refresh
5. Ready to process jobs
```

### Ingestion Worker (`apps/ingestion-worker/`)

Handles everything except page fetching: content extraction, chunking, embedding, indexing, deletion.

**Seven queues:**
| Queue | Worker Module | Purpose |
|-------|--------------|---------|
| `source_run` | `queues/source-run.ts` | Source run lifecycle (discover, start) |
| `page_process` | `queues/page-process.ts` | Content extraction from HTML |
| `page_index` | `queues/page-index.ts` | Chunking and DB storage |
| `embed_chunks` | `queues/embed-chunks.ts` | Vector embedding generation |
| `enrich_page` | `queues/enrich-page.ts` | Optional AI enrichment |
| `deletion` | `queues/deletion.ts` | Hard delete processing |
| `kb_reindex` | `queues/kb-reindex.ts` | Re-embedding on model change |

**Key modules:**
| Module | Path | Purpose |
|--------|------|---------|
| `bootstrap/index.ts` | Settings, vector store init | Unified bootstrap |
| `stage/queue-scraping.ts` | Scraping queue | Registers runs with fairness scheduler |
| `jobs/stage-transition.ts` | Stage transitions | Manages run stage progression |
| `jobs/*.ts` | Job handlers | One handler per job type |

---

## Job Flow: End to End

### Web Source Ingestion

```
API (user clicks "Run Now")
  │
  ├─ Creates sourceRun record (status: pending)
  ├─ Queues "source.discover" to source_run queue
  │
  ▼
Ingestion Worker: source_run queue
  │
  ├─ Discovers URLs (single/list/sitemap/domain mode)
  ├─ Creates sourceRunPages records
  ├─ Registers run with fairness scheduler: registerRun(runId)
  ├─ Queues "page_fetch" jobs for each URL
  │
  ▼
Scraper Worker: page_fetch queue
  │
  ├─ acquireSlot(runId) ─── denied? → moveToDelayed() → retry after delay
  │                          granted? ↓
  ├─ Fetch page (HTTP/headless/firecrawl/auto)
  ├─ Content hash comparison (skip if unchanged)
  ├─ Domain mode: extract links → queue child page_fetch jobs
  ├─ releaseSlot(runId) [in finally block]
  ├─ Queue "page_process" job with raw HTML
  │
  ▼
Ingestion Worker: page_process queue
  │
  ├─ Parse HTML → extract main content
  ├─ Build heading hierarchy
  ├─ Store in sourceRunPageContents
  ├─ Queue "page_index" job
  │
  ▼
Ingestion Worker: page_index queue
  │
  ├─ Split content into chunks (800 tokens, 120 overlap)
  ├─ Create/update kbChunks records
  ├─ Generate tsvector for full-text search
  ├─ Queue "embed_chunks" batch job
  │
  ▼
Ingestion Worker: embed_chunks queue
  │
  ├─ Fetch chunk content from DB
  ├─ Call embedding API (batched: 100 per call, 3 parallel)
  ├─ Upsert vectors in pgvector
  ├─ Update sourceRun progress counters
  │
  ▼
Stage Transition
  │
  ├─ unregisterRun(runId) from fairness scheduler
  ├─ Compute final stats (pages seen/indexed/failed)
  ├─ Set sourceRun status: succeeded | partial | failed
  └─ Done
```

### File Upload Ingestion

```
API (user uploads file)
  │
  ├─ Extract text from file (PDF/DOCX/TXT/HTML)
  ├─ Store upload record with extracted text
  ├─ Create sourceRun record
  ├─ Queue "page_process" job with extracted text
  │
  ▼
[Follows same path: page_process → page_index → embed_chunks]
```

---

## Settings Management

### Settings Flow

```
Admin UI (Settings → Workers)
    ↓ saves to
PostgreSQL (system_settings table)
    ↓ served via
API: GET /api/v1/internal/workers/settings
    ↓ fetched by
Workers (at startup + every 60 seconds)
    ↓ applied to
Fairness config (immediate) + Concurrency (restart required)
```

### Internal Workers API

`apps/api/src/routes/internal/workers.ts`

```
GET /api/v1/internal/workers/settings
```

Returns:
```json
{
  "scraper": { "concurrency": 5 },
  "ingestion": { "concurrency": 5 },
  "embed": { "concurrency": 4, "batchSize": 100, "parallelBatches": 3 },
  "fairness": {
    "enabled": true,
    "totalSlots": 10,
    "minSlotsPerRun": 1,
    "maxSlotsPerRun": 10,
    "retryDelayMs": 500
  }
}
```

**Security:** In production, secured with `INTERNAL_API_KEY` header. In dev, open if no key configured.

### Settings Client (`packages/shared/src/settings/`)

```typescript
// Worker-side usage
const client = initSettingsClient({
  onSettingsUpdate: (settings: WorkerSettings) => {
    updateFairnessConfigFromSettings(settings.fairness);
  }
});

// Fetch once at startup
await client.fetchSettings();

// Start periodic refresh (every 60s)
client.startPeriodicRefresh();

// On shutdown
client.stopPeriodicRefresh();
```

### What's Immediately Updatable vs. Restart Required

| Setting | Live Update | Notes |
|---------|:-:|-------|
| Fairness enabled | ✅ | Takes effect on next slot acquisition |
| Fairness total slots | ✅ | Changes fair share calculation immediately |
| Fairness min/max per run | ✅ | Affects next acquisition |
| Fairness retry delay | ✅ | Affects next retry |
| Scraper concurrency | ❌ | BullMQ Worker concurrency set at construction |
| Ingestion concurrency | ❌ | Same — requires restart |
| Embed concurrency | ❌ | Same |
| Embed batch size | ✅ | Read at job execution time |
| Embed parallel batches | ✅ | Read at job execution time |

---

## Fairness Scheduler Deep Dive

### Module: `packages/queue/src/fairness-scheduler.ts`

The fairness scheduler uses Redis to coordinate slot allocation across worker processes.

### Data Structures in Redis

| Key | Type | Purpose | TTL |
|-----|------|---------|-----|
| `fairness:active_runs` | Set | All currently active run IDs | None (manually managed) |
| `fairness:slots:{runId}` | String (counter) | Current slot count for a run | 300s (safety TTL) |
| `fairness:last_served:{runId}` | String (timestamp) | When run was last served | 300s |

### Core Algorithm (Lua Script)

The slot acquisition uses an **atomic Lua script** executed in Redis to prevent race conditions:

```lua
-- Pseudocode for ACQUIRE_SLOT_SCRIPT
function acquireSlot(runId, totalSlots, minPerRun, maxPerRun):
    if runId NOT IN active_runs:
        return DENIED (not_registered)

    activeRunCount = COUNT(active_runs)
    fairShare = floor(totalSlots / activeRunCount)
    fairShare = CLAMP(fairShare, minPerRun, maxPerRun)

    currentSlots = GET slots:{runId}

    if currentSlots < fairShare:
        INCR slots:{runId}
        SET EXPIRE slots:{runId} 300s
        return GRANTED
    else:
        return DENIED (at_limit)
```

**Why Lua?** The check-and-increment must be atomic. Without Lua, two workers could simultaneously check the count, both see room, and both increment — exceeding the fair share.

### Lifecycle

```
Source run starts scraping stage
    │
    ├─ registerRun(runId)     → SADD fairness:active_runs runId
    │
    │  ┌─ For each page fetch job ────────────────────────┐
    │  │                                                    │
    │  │  acquireSlot(runId) ─── DENIED                    │
    │  │      │                    │                        │
    │  │      │ GRANTED            └─ moveToDelayed(500ms)  │
    │  │      ↓                       (retry later)         │
    │  │  Process page                                      │
    │  │      │                                             │
    │  │  releaseSlot(runId)  → DECR fairness:slots:runId  │
    │  └────────────────────────────────────────────────────┘
    │
    ├─ unregisterRun(runId)   → SREM + DEL slots + DEL last_served
    │
    Done
```

### Fairness Slot Error Handling (Scraper Worker)

In `apps/scraper-worker/src/index.ts`, fairness denials are handled specially:

```typescript
// In the worker processor:
if (isFairnessSlotError(error)) {
    // Move job to delayed state — will be retried after delay
    // This does NOT count against the retry limit
    await job.moveToDelayed(Date.now() + error.retryDelayMs, job.token);

    // Tell BullMQ we already handled the job state
    throw new DelayedError();
}
```

**Key design decisions:**
1. **`moveToDelayed` not retry** — Fairness delays don't increment the BullMQ retry counter
2. **`DelayedError`** — Special BullMQ error that tells the framework the job was already moved
3. **Graceful degradation** — If Redis fails, `acquireSlot` returns `acquired: true` so jobs aren't blocked

### Helper: `withFairnessSlot`

The scraper worker uses `services/fairness-slots.ts` for convenience:

```typescript
// Recommended usage:
const result = await withFairnessSlot(runId, async () => {
    return await fetchPage(url, browser);
});

if (!result.acquired) {
    throw new FairnessSlotUnavailableError(runId, result.slotResult);
}

// Or: throw automatically on denial
await withFairnessSlotOrThrow(runId, async () => {
    return await fetchPage(url, browser);
});
```

`withFairnessSlot` wraps:
1. `acquireSlot(runId)` — before work
2. The actual work function
3. `releaseSlot(runId)` — in `finally` block (always runs)

### Configuration Resolution

```typescript
// packages/shared/src/constants/index.ts
function resolveFairnessConfig(getEnv, defaultTotalSlots):
    1. Check env vars (FAIRNESS_ENABLED, FAIRNESS_TOTAL_SLOTS, etc.)
    2. Fall back to function defaults
    3. Return FairnessConfig object

// packages/queue/src/fairness-scheduler.ts
function updateFairnessConfigFromSettings(settings):
    1. Map API settings to FairnessConfig
    2. Log any changes
    3. Replace cached config
```

**Priority chain:** Admin UI settings → Environment variables → Code defaults

### Metrics

```typescript
// Get current fairness metrics (for monitoring):
const metrics = await getFairnessMetrics();
// Returns:
{
    activeRunCount: 3,
    totalSlotsInUse: 8,
    totalSlotsAvailable: 10,
    runSlots: { "run-a": 3, "run-b": 3, "run-c": 2 },
    fairSharePerRun: 3,
    timestamp: "2024-01-15T10:30:00.000Z"
}
```

---

## Queue Configuration

All queues are defined in `packages/queue/src/index.ts` using BullMQ:

### Queue Names

```typescript
export const QUEUE_NAMES = {
    SOURCE_RUN: "source-run",
    PAGE_FETCH: "page-fetch",
    PAGE_PROCESS: "page-process",
    PAGE_INDEX: "page-index",
    EMBED_CHUNKS: "embed-chunks",
    ENRICH_PAGE: "enrich-page",
    DELETION: "deletion",
    KB_REINDEX: "kb-reindex",
    STAGE_TRANSITION: "stage-transition",
};
```

### Default Job Options

| Setting | Value | Purpose |
|---------|-------|---------|
| Retry attempts | 3 | Total retries before marking failed |
| Backoff type | Exponential | 5s → 10s → 20s |
| Initial delay | 5,000 ms | First retry delay |
| Completed retention | 1,000 jobs | Keep last N completed jobs |
| Failed retention | 5,000 jobs | Keep last N failed jobs |

### Job Deduplication

Embedding jobs use **deterministic job IDs** to prevent duplicate work:

```typescript
// Job ID = hash of chunk IDs being embedded
const jobId = `embed-${hashChunkIds(chunkIds)}`;

// BullMQ skips the job if one with the same ID is already queued/active
await embedQueue.add("embed-chunks-batch", data, { jobId });
```

---

## Recovery: Stuck Run Detection

`apps/api/src/services/source-run-recovery.ts`

Handles runs that get stuck (e.g., worker crashes mid-job):

1. Periodic check for runs in `running` status beyond a threshold
2. Compares expected progress vs. actual
3. If stuck, marks as `failed` with error message
4. Unregisters from fairness scheduler to free slots

---

## Development

### Running Workers Locally

```bash
bun run dev:scraper      # Start scraper worker with hot reload
bun run dev:ingestion    # Start ingestion worker with hot reload
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CONCURRENCY` | 5 | Scraper worker concurrency |
| `INGESTION_CONCURRENCY` | 5 | Ingestion worker concurrency |
| `EMBED_CONCURRENCY` | 4 | Embedding worker concurrency |
| `FAIRNESS_ENABLED` | true | Enable fairness scheduler |
| `FAIRNESS_TOTAL_SLOTS` | 5 | Total fairness slots |
| `FAIRNESS_MIN_SLOTS_PER_RUN` | 1 | Minimum slots per run |
| `FAIRNESS_MAX_SLOTS_PER_RUN` | 10 | Maximum slots per run |
| `FAIRNESS_RETRY_DELAY_MS` | 500 | Delay on slot denial |
| `PLAYWRIGHT_HEADLESS` | true | Headless browser mode |
| `INTERNAL_API_KEY` | *(none)* | Key for worker→API auth |
| `SETTINGS_REFRESH_INTERVAL_MS` | 60000 | Settings refresh interval |

### Testing Fairness

```bash
# Run fairness-specific tests
cd apps/scraper-worker
bun test src/services/fairness-slots.test.ts
bun test src/bootstrap/settings.test.ts

# Run with debug logging
FAIRNESS_DEBUG=true bun run dev:scraper
```

### Debugging Tips

- **Check Redis** for fairness state: `redis-cli SMEMBERS fairness:active_runs`
- **Check slot counts**: `redis-cli GET fairness:slots:{runId}`
- **Reset stuck fairness state**: Call `resetFairnessState()` or clear Redis keys manually
- **Watch BullMQ queues**: Use `bun run db:studio` (Drizzle) or a Redis GUI to inspect queue state
