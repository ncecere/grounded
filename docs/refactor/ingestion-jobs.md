## Purpose

- Document the ingestion worker job and queue mapping after Phase 2 refactoring.
- Provide a quick reference for job handlers, owning queues, and worker ownership.

## Job/Queue Map

| Queue | Job Name | Payload Type | Handler | Queue Worker | Owner | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `source-run` | `start` | `SourceRunStartJob` | `apps/ingestion-worker/src/jobs/source-run-start.ts` | `apps/ingestion-worker/src/queues/source-run.ts` | `ingestion-worker` | Initializes a source run and queues discovery. |
| `source-run` | `discover` | `SourceDiscoverUrlsJob` | `apps/ingestion-worker/src/jobs/source-discover.ts` | `apps/ingestion-worker/src/queues/source-run.ts` | `ingestion-worker` | Discovers URLs for scraping or upload processing. |
| `source-run` | `finalize` | `SourceRunFinalizeJob` | `apps/ingestion-worker/src/jobs/source-finalize.ts` | `apps/ingestion-worker/src/queues/source-run.ts` | `ingestion-worker` | Finalizes run status and cleanup. |
| `source-run` | `stage-transition` | `StageTransitionJob` | `apps/ingestion-worker/src/jobs/stage-transition.ts` | `apps/ingestion-worker/src/queues/source-run.ts` | `ingestion-worker` | Moves the run to the next pipeline stage. |
| `page-process` | `process` | `PageProcessJob` | `apps/ingestion-worker/src/jobs/page-process.ts` | `apps/ingestion-worker/src/queues/page-process.ts` | `ingestion-worker` | Extracts content and writes page records. |
| `page-index` | `index` | `PageIndexJob` | `apps/ingestion-worker/src/jobs/page-index.ts` | `apps/ingestion-worker/src/queues/page-index.ts` | `ingestion-worker` | Chunks content and prepares embeddings. |
| `embed-chunks` | `embed` | `EmbedChunksBatchJob` | `apps/ingestion-worker/src/jobs/embed-chunks.ts` | `apps/ingestion-worker/src/queues/embed-chunks.ts` | `ingestion-worker` | Generates embeddings for chunk batches. |
| `enrich-page` | `enrich` | `EnrichPageJob` | `apps/ingestion-worker/src/jobs/enrich-page.ts` | `apps/ingestion-worker/src/queues/enrich-page.ts` | `ingestion-worker` | Adds AI enrichment metadata for pages. |
| `deletion` | `hard-delete` | `HardDeleteObjectJob` | `apps/ingestion-worker/src/jobs/hard-delete.ts` | `apps/ingestion-worker/src/queues/deletion.ts` | `ingestion-worker` | Permanently deletes objects and related data. |
| `kb-reindex` | `reindex` | `KbReindexJob` | `apps/ingestion-worker/src/jobs/kb-reindex.ts` | `apps/ingestion-worker/src/queues/kb-reindex.ts` | `ingestion-worker` | Reindexes knowledge base chunks. |

## Payload Invariants

**Common fields**
- `tenantId` is nullable; required for tenant-scoped jobs except `objectType=tenant` deletion.
- `requestId`/`traceId` are optional and used for log correlation across API/workers.
- IDs (`sourceId`, `runId`, `pageId`, `contentId`, `kbId`, `uploadId`) are UUIDs per shared payload schemas.

**Source-run jobs**
- `SourceRunStartJob`: `sourceId` + `runId` required; `sourceConfig` handled on the run.
- `SourceDiscoverUrlsJob`: `runId` required; crawl config is read from the run/source.
- `StageTransitionJob`: `completedStage` must be a `SourceRunStage` value.
- `SourceRunFinalizeJob`: `runId` required; `sourceType` optional for web/upload-specific cleanup.

**Processing/indexing jobs**
- `PageProcessJob`: `url` is canonical URL or `upload://` URI; `html` is required for upload jobs and may be empty for web jobs (HTML is staged in Redis); `title` nullable.
- `PageProcessJob` upload metadata (`uploadId`, `filename`, `mimeType`, `sizeBytes`) is required when `sourceType=upload`.
- `PageIndexJob`: `pageId` + `contentId` required; upload metadata required when `sourceType=upload`.
- `EmbedChunksBatchJob`: `chunkIds` must be non-empty; `runId` is optional (reindex runs omit it).

**Enrichment/deletion/reindex jobs**
- `EnrichPageJob`: `chunkIds` must be non-empty; `kbId` required.
- `HardDeleteObjectJob`: `objectType` is one of `kb`, `source`, `agent`, `tenant`; `tenantId` required unless deleting a tenant.
- `KbReindexJob`: `kbId`, `newEmbeddingModelId`, and `newEmbeddingDimensions` required; `tenantId` is nullable for global KBs.

## Retry and Idempotency Rules

**Retry defaults**
- All ingestion queues except `kb-reindex` use `JOB_RETRY_ATTEMPTS=3` with `JOB_BACKOFF_TYPE=exponential` and `JOB_RETRY_DELAY_MS=5000`.
- `kb-reindex` jobs are not retried automatically (`attempts=1`) and must be restarted manually if needed.

**Job ID deduping**
- Source-run jobs are idempotent by `runId`: `source-run-start-${runId}`, `source-discover-${runId}`, `source-run-finalize-${runId}`.
- Stage transitions are idempotent per stage: `stage-transition-${runId}-${completedStage}`.
- Page processing uses URL-based IDs: `page-process-${runId}-${base64url(url)}`.
- Page indexing uses page IDs: `page-index-${runId}-${pageId}`.
- Embed batches use deterministic IDs from `kbId + chunkIds` (dedupes repeated batches).
- Hard deletes use `delete-${objectType}-${objectId}` to prevent duplicate deletes.
- `kb-reindex` uses `kb-reindex-${kbId}` to ensure a single reindex per KB.
- Enrichment jobs use a timestamped ID (`enrich-${kbId}-${Date.now()}`) and are not deduped.

## Related Worker Dependencies

- `page-fetch` queue jobs are owned by the scraper worker (see Phase 3 docs) and feed `page-process` jobs via staged HTML in Redis.
