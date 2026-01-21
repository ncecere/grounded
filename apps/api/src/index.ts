import { getEnvNumber } from "@grounded/shared";
import { log } from "@grounded/logger";
import { registerShutdownHandlers, runStartupTasks } from "./startup";
import { createApiApp } from "./app";

const app = createApiApp();

// Run startup tasks
void runStartupTasks();
registerShutdownHandlers();

// ============================================================================
// Start Server
// ============================================================================

const port = getEnvNumber("PORT", 3000);

log.info("api", `Starting API server on port ${port}...`);

export default {
  port,
  fetch: app.fetch,
};
