import type { Worker } from "@grounded/queue";
import { getWorkerLogger } from "./helpers";
import { stopSettingsRefresh } from "./settings";

export type ShutdownOptions = {
  workers: Worker[];
  exitCode?: number;
  onShutdown?: () => Promise<void> | void;
};

export type ShutdownHandler = (signal?: NodeJS.Signals) => Promise<void>;

export function createShutdownHandler({
  workers,
  exitCode = 0,
  onShutdown,
}: ShutdownOptions): ShutdownHandler {
  const logger = getWorkerLogger();
  let isShuttingDown = false;

  return async (signal?: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    logger.info("Shutting down...");

    stopSettingsRefresh();

    if (onShutdown) {
      await onShutdown();
    }

    for (const worker of workers) {
      await worker.close();
    }

    process.exit(exitCode);
  };
}

export function registerShutdownSignals(shutdown: ShutdownHandler): void {
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
