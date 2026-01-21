/**
 * Ingestion worker settings initialization.
 */

import { getEnvNumber, initSettingsClient, type WorkerSettings } from "@grounded/shared";
import { getWorkerLogger } from "./helpers";

const logger = getWorkerLogger();

// Default concurrency from environment (used as fallback)
export const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);
export const DEFAULT_INDEX_CONCURRENCY = getEnvNumber("INDEX_WORKER_CONCURRENCY", 5);
export const DEFAULT_EMBED_CONCURRENCY = getEnvNumber("EMBED_WORKER_CONCURRENCY", 4);

// Current concurrency values (may be updated from API settings)
let currentConcurrency = DEFAULT_CONCURRENCY;
let currentEmbedConcurrency = DEFAULT_EMBED_CONCURRENCY;

export const settingsClient = initSettingsClient({
  onSettingsUpdate: (settings: WorkerSettings) => {
    logger.info(
      {
        ingestionConcurrency: settings.ingestion.concurrency,
        embedConcurrency: settings.embed.concurrency,
      },
      "Settings updated from API"
    );

    // Track concurrency changes (worker restart required to apply)
    if (settings.ingestion.concurrency !== currentConcurrency) {
      logger.warn(
        {
          oldConcurrency: currentConcurrency,
          newConcurrency: settings.ingestion.concurrency,
        },
        "Ingestion concurrency changed in settings - restart worker to apply"
      );
    }
    if (settings.embed.concurrency !== currentEmbedConcurrency) {
      logger.warn(
        {
          oldConcurrency: currentEmbedConcurrency,
          newConcurrency: settings.embed.concurrency,
        },
        "Embed concurrency changed in settings - restart worker to apply"
      );
    }
  },
});

export async function initializeSettings(): Promise<WorkerSettings | null> {
  try {
    const settings = await settingsClient.fetchSettings();
    logger.info(
      {
        ingestionConcurrency: settings.ingestion.concurrency,
        embedConcurrency: settings.embed.concurrency,
      },
      "Loaded settings from API"
    );

    // Update current concurrency values for tracking
    currentConcurrency = settings.ingestion.concurrency;
    currentEmbedConcurrency = settings.embed.concurrency;

    // Start periodic refresh
    settingsClient.startPeriodicRefresh();
    return settings;
  } catch (error) {
    logger.warn({ error }, "Failed to load settings from API, using environment defaults");
    return null;
  }
}

export function stopSettingsRefresh(): void {
  settingsClient.stopPeriodicRefresh();
}

export function getCurrentConcurrency(): number {
  return currentConcurrency;
}

export function getCurrentEmbedConcurrency(): number {
  return currentEmbedConcurrency;
}
