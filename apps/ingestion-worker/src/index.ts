import { Worker, Job, connection, QUEUE_NAMES } from "@kcb/queue";
import { getEnvNumber } from "@kcb/shared";
import { initializeVectorStore, isVectorStoreConfigured } from "@kcb/vector-store";
import { processSourceRunStart } from "./processors/source-run-start";
import { processSourceDiscover } from "./processors/source-discover";
import { processSourceFinalize } from "./processors/source-finalize";
import { processPageProcess } from "./processors/page-process";
import { processEmbedChunks } from "./processors/embed-chunks";
import { processEnrichPage } from "./processors/enrich-page";
import { processHardDelete } from "./processors/hard-delete";

const CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);

console.log("Starting Ingestion Worker...");
console.log(`Concurrency: ${CONCURRENCY}`);

// Initialize vector store on startup
(async () => {
  if (isVectorStoreConfigured()) {
    try {
      await initializeVectorStore();
      console.log("[Worker] Vector store initialized successfully");
    } catch (error) {
      console.error("[Worker] Failed to initialize vector store:", error);
    }
  } else {
    console.warn("[Worker] Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.");
  }
})();

// ============================================================================
// Source Run Worker
// ============================================================================

const sourceRunWorker = new Worker(
  QUEUE_NAMES.SOURCE_RUN,
  async (job: Job) => {
    console.log(`Processing job ${job.id} (${job.name})`);

    switch (job.name) {
      case "start":
        return processSourceRunStart(job.data);
      case "discover":
        return processSourceDiscover(job.data);
      case "finalize":
        return processSourceFinalize(job.data);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

sourceRunWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

sourceRunWorker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err);
});

// ============================================================================
// Page Process Worker
// ============================================================================

const pageProcessWorker = new Worker(
  QUEUE_NAMES.PAGE_PROCESS,
  async (job: Job) => {
    console.log(`Processing page ${job.id}`);
    return processPageProcess(job.data);
  },
  {
    connection,
    concurrency: CONCURRENCY,
  }
);

pageProcessWorker.on("completed", (job) => {
  console.log(`Page process ${job.id} completed`);
});

pageProcessWorker.on("failed", (job, err) => {
  console.error(`Page process ${job?.id} failed:`, err);
});

// ============================================================================
// Embed Chunks Worker
// ============================================================================

const embedChunksWorker = new Worker(
  QUEUE_NAMES.EMBED_CHUNKS,
  async (job: Job) => {
    console.log(`Embedding chunks ${job.id}`);
    return processEmbedChunks(job.data);
  },
  {
    connection,
    concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)), // Lower concurrency for embedding calls
  }
);

embedChunksWorker.on("completed", (job) => {
  console.log(`Embed chunks ${job.id} completed`);
});

embedChunksWorker.on("failed", (job, err) => {
  console.error(`Embed chunks ${job?.id} failed:`, err);
});

// ============================================================================
// Enrich Page Worker
// ============================================================================

const enrichPageWorker = new Worker(
  QUEUE_NAMES.ENRICH_PAGE,
  async (job: Job) => {
    console.log(`Enriching page ${job.id}`);
    return processEnrichPage(job.data);
  },
  {
    connection,
    concurrency: Math.max(1, Math.floor(CONCURRENCY / 2)),
  }
);

enrichPageWorker.on("completed", (job) => {
  console.log(`Enrich page ${job.id} completed`);
});

enrichPageWorker.on("failed", (job, err) => {
  console.error(`Enrich page ${job?.id} failed:`, err);
});

// ============================================================================
// Deletion Worker
// ============================================================================

const deletionWorker = new Worker(
  QUEUE_NAMES.DELETION,
  async (job: Job) => {
    console.log(`Processing deletion ${job.id}`);
    return processHardDelete(job.data);
  },
  {
    connection,
    concurrency: 2,
  }
);

deletionWorker.on("completed", (job) => {
  console.log(`Deletion ${job.id} completed`);
});

deletionWorker.on("failed", (job, err) => {
  console.error(`Deletion ${job?.id} failed:`, err);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on("SIGTERM", async () => {
  console.log("Received SIGTERM, shutting down...");
  await sourceRunWorker.close();
  await pageProcessWorker.close();
  await embedChunksWorker.close();
  await enrichPageWorker.close();
  await deletionWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("Received SIGINT, shutting down...");
  await sourceRunWorker.close();
  await pageProcessWorker.close();
  await embedChunksWorker.close();
  await enrichPageWorker.close();
  await deletionWorker.close();
  process.exit(0);
});

console.log("Ingestion Worker started successfully");
