/**
 * Browser Pool Module
 *
 * Central export point for browser pool management utilities.
 * This module provides Playwright browser lifecycle management with:
 * - Lazy initialization (browser launched on first use)
 * - Automatic reconnection handling
 * - Graceful shutdown support
 *
 * Usage:
 * ```typescript
 * import {
 *   initializeBrowserPool,
 *   getBrowser,
 *   shutdownBrowserPool,
 * } from "./browser";
 *
 * // Initialize pool with configuration
 * initializeBrowserPool({ headless: true });
 *
 * // Get browser instance for page fetch
 * const browser = await getBrowser();
 *
 * // Shutdown pool on process exit
 * await shutdownBrowserPool();
 * ```
 */

export {
  // Lifecycle management
  initializeBrowserPool,
  getBrowser,
  shutdownBrowserPool,
  // State queries
  hasBrowser,
  isInitialized,
  isPoolShuttingDown,
  // Testing utilities
  resetBrowserPool,
  getBrowserPoolStats,
  // Types
  type BrowserPoolConfig,
  type BrowserPoolStats,
} from "./pool";
