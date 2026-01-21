/**
 * Bootstrap Module
 *
 * Centralized initialization, shutdown, and helper functions for the ingestion worker.
 * This module is the first to be imported and provides shared utilities.
 */

// Logging and error handling helpers
export {
  // Logger
  getWorkerLogger,
  createJobLogger,
  ingestLog,
  type WorkerLogger,
  // Sampling
  workerSamplingConfig,
  shouldSample,
  // Error classes
  IngestionError,
  NotFoundError,
  ConfigurationError,
  ProcessingError,
  EmbeddingError,
  EmbeddingDimensionMismatchError,
  StageTransitionError,
  // Error utilities
  normalizeError,
  getErrorMessage,
  isRetriableError,
  withErrorLogging,
} from "./helpers";

export {
  DEFAULT_CONCURRENCY,
  DEFAULT_INDEX_CONCURRENCY,
  DEFAULT_EMBED_CONCURRENCY,
  settingsClient,
  initializeSettings,
  stopSettingsRefresh,
  getCurrentConcurrency,
  getCurrentEmbedConcurrency,
} from "./settings";

export { initVectorStore } from "./vector-store";
