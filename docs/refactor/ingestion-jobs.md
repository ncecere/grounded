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

## Related Worker Dependencies

- `page-fetch` queue jobs are owned by the scraper worker (see Phase 3 docs) and feed `page-process` jobs via staged HTML in Redis.
