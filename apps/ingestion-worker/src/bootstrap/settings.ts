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

// Current concurrency values (active in worker, from environment)
let currentConcurrency = DEFAULT_CONCURRENCY;
let currentEmbedConcurrency = DEFAULT_EMBED_CONCURRENCY;
let lastIngestionSetting: number | null = null;
let lastEmbedSetting: number | null = null;

export const settingsClient = initSettingsClient({
  onSettingsUpdate: (settings: WorkerSettings) => {
    const ingestionConcurrency = settings.ingestion.concurrency;
    const embedConcurrency = settings.embed.concurrency;
    logger.info(
      {
        ingestionConcurrency,
        embedConcurrency,
      },
      "Settings updated from API"
    );

    // Track concurrency changes (worker restart required to apply)
    const previousIngestion = lastIngestionSetting ?? currentConcurrency;
    if (ingestionConcurrency !== previousIngestion) {
      logger.warn(
        {
          oldConcurrency: previousIngestion,
          newConcurrency: ingestionConcurrency,
        },
        "Ingestion concurrency changed in settings - restart worker to apply"
      );
    }
    const previousEmbed = lastEmbedSetting ?? currentEmbedConcurrency;
    if (embedConcurrency !== previousEmbed) {
      logger.warn(
        {
          oldConcurrency: previousEmbed,
          newConcurrency: embedConcurrency,
        },
        "Embed concurrency changed in settings - restart worker to apply"
      );
    }

    lastIngestionSetting = ingestionConcurrency;
    lastEmbedSetting = embedConcurrency;
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
    return settings;
  } catch (error) {
    logger.warn({ error }, "Failed to load settings from API, using environment defaults");
    return null;
  } finally {
    // Start periodic refresh even if initial fetch fails
    settingsClient.startPeriodicRefresh();
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
