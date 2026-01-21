import { getEnvNumber } from "@grounded/shared";
import { initializeVectorStore, isVectorStoreConfigured } from "@grounded/vector-store";
import { log } from "@grounded/logger";
import { runMigrations } from "./startup/run-migrations";
import { seedSystemAdmin } from "./startup/seed-admin";
import { startTestSuiteScheduler, stopTestSuiteScheduler } from "./services/test-suite-scheduler";
import { recoverOrphanedLocks, startPeriodicRecovery, stopPeriodicRecovery } from "./services/test-suite-lock-recovery";
import { createApiApp } from "./app";

const app = createApiApp();

// Run startup tasks
(async () => {
  try {
    // Run database migrations first
    await runMigrations();
    // Then seed admin user
    await seedSystemAdmin();
    // Initialize vector store (optional - may not be configured)
    if (isVectorStoreConfigured()) {
      await initializeVectorStore();
      log.info("api", "Vector store initialized successfully");
    } else {
      log.warn("api", "Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.");
    }

    // Recover any orphaned locks from previous runs/crashes
    await recoverOrphanedLocks();

    // Start periodic recovery for stuck experiments/locks
    startPeriodicRecovery();

    await startTestSuiteScheduler();
  } catch (error) {
    log.error("api", "Startup tasks failed", { error: error instanceof Error ? error.message : String(error) });
  }
})();

process.on("SIGTERM", () => {
  stopTestSuiteScheduler();
  stopPeriodicRecovery();
});

process.on("SIGINT", () => {
  stopTestSuiteScheduler();
  stopPeriodicRecovery();
});

// ============================================================================
// Start Server
// ============================================================================

const port = getEnvNumber("PORT", 3000);

log.info("api", `Starting API server on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
