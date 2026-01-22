/**
 * Scraper worker bootstrap module.
 *
 * Provides startup initialization for settings, fairness config, and other
 * worker-level concerns.
 */

export {
  // Settings
  settingsClient,
  initializeSettings,
  stopSettingsRefresh,
  getCurrentConcurrency,
  getHeadlessMode,
  // Defaults
  DEFAULT_CONCURRENCY,
  DEFAULT_HEADLESS,
} from "./settings";
