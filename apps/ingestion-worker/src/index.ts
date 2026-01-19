import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { getEnvNumber } from "@grounded/shared";
import { initializeVectorStore, isVectorStoreConfigured } from "@grounded/vector-store";
import { createWorkerLogger, createJobLogger } from "@grounded/logger/worker";
import { shouldSample, createSamplingConfig } from "@grounded/logger";
import { processSourceRunStart } from "./processors/source-run-start";
import { processSourceDiscover } from "./processors/source-discover";
import { processSourceFinalize } from "./processors/source-finalize";
import { processStageTransition } from "./processors/stage-transition";
import { processPageProcess } from "./processors/page-process";
import { processPageIndex } from "./processors/page-index";
import { processEmbedChunks } from "./processors/embed-chunks";
import { processEnrichPage } from "./processors/enrich-page";
import { processHardDelete } from "./processors/hard-delete";
import { processKbReindex } from "./processors/kb-reindex";

const logger = createWorkerLogger("ingestion-worker");

// Sampling config from environment variables with worker-specific defaults
// Workers log 100% by default (can reduce with LOG_SAMPLE_RATE env var)
const samplingConfig = createSamplingConfig({
  baseSampleRate: 1.0,  // Log all jobs by default
  slowRequestThresholdMs: 30000, // 30s is slow for a job
});

const CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
const INDEX_CONCURRENCY = getEnvNumber("INDEX_WORKER_CONCURRENCY", 5);
const EMBED_CONCURRENCY = getEnvNumber("EMBED_WORKER_CONCURRENCY", 4);

logger.info({ concurrency: CONCURRENCY, indexConcurrency: INDEX_CONCURRENCY, embedConcurrency: EMBED_CONCURRENCY }, "Starting Ingestion Worker...");

// Initialize vector store on startup
(async () => {
  if (isVectorStoreConfigured()) {
    try {
      await initializeVectorStore();
      logger.info("Vector store initialized successfully");
    } catch (error) {
      logger.error({ error }, "Failed to initialize vector store");
    }
  } else {
    logger.warn("Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.");
  }
})();

// ============================================================================
// Source Run Worker
// ============================================================================

const sourceRunWorker = new Worker(
  QUEUE_NAMES.SOURCE_RUN,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.SOURCE_RUN },
      job
    );
    event.setOperation(job.name);

    try {
      switch (job.name) {
        case "start":
          await processSourceRunStart(job.data);
          break;
        case "discover":
          await processSourceDiscover(job.data);
          break;
        case "finalize":
          await processSourceFinalize(job.data);
          break;
        case "stage-transition":
          await processStageTransition(job.data);
          break;
        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

// ============================================================================
// Page Process Worker
// ============================================================================

const pageProcessWorker = new Worker(
  QUEUE_NAMES.PAGE_PROCESS,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.PAGE_PROCESS },
      job
    );
    event.setOperation("page_process");
    event.addFields({ url: job.data.url, depth: job.data.depth });

    try {
      await processPageProcess(job.data);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

// ============================================================================
// Page Index Worker
// ============================================================================

const pageIndexWorker = new Worker(
  QUEUE_NAMES.PAGE_INDEX,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.PAGE_INDEX },
      job
    );
    event.setOperation("page_index");
    event.addFields({ pageId: job.data.pageId, contentId: job.data.contentId });

    try {
      await processPageIndex(job.data);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: INDEX_CONCURRENCY,
  }
);

// ============================================================================
// Embed Chunks Worker
// ============================================================================

const embedChunksWorker = new Worker(
  QUEUE_NAMES.EMBED_CHUNKS,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.EMBED_CHUNKS },
      job
    );
    event.setOperation("embed_chunks");
    event.addFields({ chunkCount: job.data.chunkIds?.length });

    try {
      await processEmbedChunks(job.data);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: EMBED_CONCURRENCY,
  }
);

// ============================================================================
// Enrich Page Worker
// ============================================================================

const enrichPageWorker = new Worker(
  QUEUE_NAMES.ENRICH_PAGE,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.ENRICH_PAGE },
      job
    );
    event.setOperation("enrich_page");
    event.addFields({ chunkCount: job.data.chunkIds?.length });

    try {
      await processEnrichPage(job.data);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)),
  }
);

// ============================================================================
// Deletion Worker
// ============================================================================

const deletionWorker = new Worker(
  QUEUE_NAMES.DELETION,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.DELETION },
      job
    );
    event.setOperation("hard_delete");
    event.addFields({ objectType: job.data.objectType, objectId: job.data.objectId });

    try {
      await processHardDelete(job.data);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

// ============================================================================
// KB Reindex Worker
// ============================================================================

const kbReindexWorker = new Worker(
  QUEUE_NAMES.KB_REINDEX,
  async (job: Job) => {
    const event = createJobLogger(
      { service: "ingestion-worker", queue: QUEUE_NAMES.KB_REINDEX },
      job
    );
    event.setOperation("kb_reindex");

    try {
      await processKbReindex(job.data);
      event.success();
    } catch (error) {
      if (error instanceof Error) {
        event.setError(error);
      } else {
        event.setError({ type: "UnknownError", message: String(error) });
      }
      throw error;
    } finally {
      if (shouldSample(event.getEvent(), samplingConfig)) {
        event.emit();
      }
    }
  },
  {
    connection,
    concurrency: 1, // Only one reindex at a time to avoid resource contention
  }
);

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down...");
  await sourceRunWorker.close();
  await pageProcessWorker.close();
  await pageIndexWorker.close();
  await embedChunksWorker.close();
  await enrichPageWorker.close();
  await deletionWorker.close();
  await kbReindexWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down...");
  await sourceRunWorker.close();
  await pageProcessWorker.close();
  await pageIndexWorker.close();
  await embedChunksWorker.close();
  await enrichPageWorker.close();
  await deletionWorker.close();
  await kbReindexWorker.close();
  process.exit(0);
});

logger.info("Ingestion Worker started successfully");
