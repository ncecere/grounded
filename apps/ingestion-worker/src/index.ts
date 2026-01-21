import {
  getWorkerLogger,
  DEFAULT_CONCURRENCY,
  DEFAULT_INDEX_CONCURRENCY,
  DEFAULT_EMBED_CONCURRENCY,
  initializeSettings,
  initVectorStore,
  createShutdownHandler,
  registerShutdownSignals,
} from "./bootstrap";
import { allWorkers, registerAllWorkers } from "./queues";

const logger = getWorkerLogger();

logger.info({ 
  concurrency: DEFAULT_CONCURRENCY, 
  indexConcurrency: DEFAULT_INDEX_CONCURRENCY, 
  embedConcurrency: DEFAULT_EMBED_CONCURRENCY 
}, "Starting Ingestion Worker...");

// Initialize vector store and settings on startup
(async () => {
  await initVectorStore();
  await initializeSettings();
})();

registerAllWorkers();

// ============================================================================
// Graceful Shutdown
// ============================================================================

const shutdown = createShutdownHandler({
  workers: allWorkers,
});

registerShutdownSignals(shutdown);

logger.info("Ingestion Worker started successfully");
