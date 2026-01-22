/**
 * Scraper worker settings initialization.
 *
 * This module encapsulates settings fetching and periodic refresh for the scraper worker.
 * It mirrors the ingestion worker pattern and ensures fairness config updates flow through
 * consistently.
 *
 * Key behaviors preserved:
 * - Settings fetched from API at startup
 * - Periodic refresh every 60 seconds (configurable via SETTINGS_REFRESH_INTERVAL_MS)
 * - Fairness config updated on every settings refresh
 * - Concurrency changes logged as warnings (require restart to apply)
 * - Refresh starts even if initial fetch fails
 */

import { getEnvNumber, getEnvBool, initSettingsClient, type WorkerSettings } from "@grounded/shared";
import { getFairnessConfig, updateFairnessConfigFromSettings } from "@grounded/queue";
import { createWorkerLogger } from "@grounded/logger/worker";

const logger = createWorkerLogger("scraper-worker");

// ============================================================================
// Environment Defaults
// ============================================================================

/** Default scraper concurrency from environment (used as fallback) */
export const DEFAULT_CONCURRENCY = getEnvNumber("WORKER_CONCURRENCY", 5);

/** Default Playwright headless mode from environment */
export const DEFAULT_HEADLESS = getEnvBool("PLAYWRIGHT_HEADLESS", true);

// ============================================================================
// Settings State
// ============================================================================

/** Current active concurrency (from environment, immutable after startup) */
let currentConcurrency = DEFAULT_CONCURRENCY;

/** Last concurrency value seen from API settings (for change detection) */
let lastScraperSetting: number | null = null;

// Initialize fairness config with default worker concurrency
// This will be updated when we fetch settings from API
getFairnessConfig(DEFAULT_CONCURRENCY);

// ============================================================================
// Settings Client
// ============================================================================

/**
 * Settings client with callback to update fairness config on refresh.
 *
 * The onSettingsUpdate callback is invoked:
 * - After successful fetchSettings() call
 * - On every periodic refresh that succeeds
 *
 * This ensures fairness config stays in sync with Admin UI changes.
 */
export const settingsClient = initSettingsClient({
  onSettingsUpdate: (settings: WorkerSettings) => {
    logger.info(
      {
        fairness: settings.fairness,
        scraperConcurrency: settings.scraper.concurrency,
      },
      "Settings updated from API"
    );

    // Update fairness scheduler config immediately
    updateFairnessConfigFromSettings(settings.fairness);

    // Track concurrency changes (worker restart required to apply)
    const previousConcurrency = lastScraperSetting ?? currentConcurrency;
    if (settings.scraper.concurrency !== previousConcurrency) {
      logger.warn(
        {
          oldConcurrency: previousConcurrency,
          newConcurrency: settings.scraper.concurrency,
        },
        "Scraper concurrency changed in settings - restart worker to apply"
      );
    }

    lastScraperSetting = settings.scraper.concurrency;
  },
});

// ============================================================================
// Initialization
// ============================================================================

/**
 * Fetches settings from API and starts periodic refresh.
 *
 * Behavior:
 * - Fetches settings from API
 * - Updates fairness config on success
 * - Logs warning on failure but continues with defaults
 * - Always starts periodic refresh (even if initial fetch fails)
 *
 * This ensures the worker can start with environment defaults and pick up
 * API settings later when the API becomes available.
 *
 * @returns The fetched settings, or null if fetch failed
 */
export async function initializeSettings(): Promise<WorkerSettings | null> {
  try {
    const settings = await settingsClient.fetchSettings();
    logger.info(
      {
        fairness: settings.fairness,
        scraperConcurrency: settings.scraper.concurrency,
      },
      "Loaded settings from API"
    );

    // Update fairness config with API settings
    updateFairnessConfigFromSettings(settings.fairness);

    // Update current concurrency for initial worker setup
    currentConcurrency = settings.scraper.concurrency;
    lastScraperSetting = settings.scraper.concurrency;

    return settings;
  } catch (error) {
    logger.warn({ error }, "Failed to load settings from API, using environment defaults");
    return null;
  } finally {
    // Start periodic refresh even if initial fetch fails
    // This allows picking up API settings when it becomes available
    settingsClient.startPeriodicRefresh();
  }
}

/**
 * Stops periodic settings refresh.
 * Should be called during graceful shutdown.
 */
export function stopSettingsRefresh(): void {
  settingsClient.stopPeriodicRefresh();
}

// ============================================================================
// Accessors
// ============================================================================

/**
 * Gets the current concurrency value.
 * This is the value used when the worker was started.
 */
export function getCurrentConcurrency(): number {
  return currentConcurrency;
}

/**
 * Gets the default headless mode from environment.
 */
export function getHeadlessMode(): boolean {
  return DEFAULT_HEADLESS;
}
