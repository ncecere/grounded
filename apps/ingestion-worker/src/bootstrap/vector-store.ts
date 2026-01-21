/**
 * Vector store initialization for the ingestion worker.
 */

import { initializeVectorStore, isVectorStoreConfigured } from "@grounded/vector-store";
import { getWorkerLogger, type WorkerLogger } from "./helpers";

type VectorStoreInitOptions = {
  logger?: WorkerLogger;
  isConfigured?: () => boolean;
  initialize?: () => Promise<void>;
};

export async function initVectorStore(options: VectorStoreInitOptions = {}): Promise<boolean> {
  const logger = options.logger ?? getWorkerLogger();
  const isConfigured = options.isConfigured ?? isVectorStoreConfigured;
  const initialize = options.initialize ?? initializeVectorStore;

  if (isConfigured()) {
    try {
      await initialize();
      logger.info("Vector store initialized successfully");
      return true;
    } catch (error) {
      logger.error({ error }, "Failed to initialize vector store");
      return false;
    }
  }

  logger.warn("Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.");
  return false;
}
