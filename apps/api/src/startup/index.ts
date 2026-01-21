import { initializeVectorStore, isVectorStoreConfigured } from "@grounded/vector-store";
import { log } from "@grounded/logger";
import { runMigrations } from "./run-migrations";
import { seedSystemAdmin } from "./seed-admin";
import { startTestSuiteScheduler, stopTestSuiteScheduler } from "../services/test-suite-scheduler";
import { recoverOrphanedLocks, startPeriodicRecovery, stopPeriodicRecovery } from "../services/test-suite-lock-recovery";

export async function runStartupTasks(): Promise<void> {
  try {
    await runMigrations();
    await seedSystemAdmin();

    if (isVectorStoreConfigured()) {
      await initializeVectorStore();
      log.info("api", "Vector store initialized successfully");
    } else {
      log.warn("api", "Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.");
    }

    await recoverOrphanedLocks();
    startPeriodicRecovery();
    await startTestSuiteScheduler();
  } catch (error) {
    log.error("api", "Startup tasks failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function stopStartupTasks(): void {
  stopTestSuiteScheduler();
  stopPeriodicRecovery();
}

export function registerShutdownHandlers(): void {
  process.on("SIGTERM", stopStartupTasks);
  process.on("SIGINT", stopStartupTasks);
}
