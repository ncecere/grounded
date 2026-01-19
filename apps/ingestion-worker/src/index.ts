import { Worker, Job, connection, QUEUE_NAMES } from "@grounded/queue";
import { getEnvNumber, initSettingsClient, type WorkerSettings } from "@grounded/shared";
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

// Default concurrency from environment (used as fallback)
const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
const DEFAULT_INDEX_CONCURRENCY = getEnvNumber("INDEX_WORKER_CONCURRENCY", 5);
const DEFAULT_EMBED_CONCURRENCY = getEnvNumber("EMBED_WORKER_CONCURRENCY", 4);

// Current concurrency values (may be updated from API settings)
let currentConcurrency = DEFAULT_CONCURRENCY;
let currentEmbedConcurrency = DEFAULT_EMBED_CONCURRENCY;

// Initialize settings client with callback to track concurrency changes
const settingsClient = initSettingsClient({
  onSettingsUpdate: (settings: WorkerSettings) => {
    logger.info({ 
      ingestionConcurrency: settings.ingestion.concurrency,
      embedConcurrency: settings.embed.concurrency,
    }, "Settings updated from API");
    
    // Track concurrency changes (worker restart required to apply)
    if (settings.ingestion.concurrency !== currentConcurrency) {
      logger.warn({
        oldConcurrency: currentConcurrency,
        newConcurrency: settings.ingestion.concurrency,
      }, "Ingestion concurrency changed in settings - restart worker to apply");
    }
    if (settings.embed.concurrency !== currentEmbedConcurrency) {
      logger.warn({
        oldConcurrency: currentEmbedConcurrency,
        newConcurrency: settings.embed.concurrency,
      }, "Embed concurrency changed in settings - restart worker to apply");
    }
  },
});

logger.info({ 
  concurrency: DEFAULT_CONCURRENCY, 
  indexConcurrency: DEFAULT_INDEX_CONCURRENCY, 
  embedConcurrency: DEFAULT_EMBED_CONCURRENCY 
}, "Starting Ingestion Worker...");

// Initialize vector store and settings on startup
(async () => {
  // Initialize vector store
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
  
  // Load settings from API
  try {
    const settings = await settingsClient.fetchSettings();
    logger.info({ 
      ingestionConcurrency: settings.ingestion.concurrency,
      embedConcurrency: settings.embed.concurrency,
    }, "Loaded settings from API");
    
    // Update current concurrency values for tracking
    currentConcurrency = settings.ingestion.concurrency;
    currentEmbedConcurrency = settings.embed.concurrency;
    
    // Start periodic refresh
    settingsClient.startPeriodicRefresh();
  } catch (error) {
    logger.warn({ error }, "Failed to load settings from API, using environment defaults");
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
    concurrency: DEFAULT_CONCURRENCY,
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
    concurrency: DEFAULT_CONCURRENCY,
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
    concurrency: DEFAULT_INDEX_CONCURRENCY,
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
    concurrency: DEFAULT_EMBED_CONCURRENCY,
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
    concurrency: Math.max(1, Math.floor(DEFAULT_CONCURRENCY / 2)),
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

async function shutdown() {
  logger.info("Shutting down...");
  
  // Stop settings refresh
  settingsClient.stopPeriodicRefresh();
  
  await sourceRunWorker.close();
  await pageProcessWorker.close();
  await pageIndexWorker.close();
  await embedChunksWorker.close();
  await enrichPageWorker.close();
  await deletionWorker.close();
  await kbReindexWorker.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

logger.info("Ingestion Worker started successfully");
