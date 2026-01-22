/**
 * Browser Pool Helper
 * 
 * Manages Playwright browser lifecycle and reuse for the scraper worker.
 * 
 * Current implementation uses a single shared browser instance with lazy
 * initialization. This pattern:
 * - Creates browser on first use (not at startup)
 * - Reuses the same browser across all concurrent workers
 * - Handles reconnection if browser disconnects
 * - Provides graceful shutdown
 * 
 * The pool abstraction allows future enhancements (multiple browsers,
 * recycling, health checks) without changing consumer code.
 */

import { chromium, type Browser } from "playwright";
import { createWorkerLogger } from "@grounded/logger/worker";

const logger = createWorkerLogger("scraper-worker");

// ============================================================================
// Configuration
// ============================================================================

export interface BrowserPoolConfig {
  /** Run browser in headless mode (default: true) */
  headless: boolean;
  /** Additional Chrome launch arguments */
  launchArgs?: string[];
}

/** Default Chrome arguments for containerized environments */
const DEFAULT_LAUNCH_ARGS = [
  "--disable-dev-shm-usage", // Prevents /dev/shm issues in Docker
  "--disable-setuid-sandbox", // Container compatibility
  "--no-sandbox", // Required in unprivileged containers
] as const;

// ============================================================================
// Pool State
// ============================================================================

/** The single browser instance (lazy initialized) */
let browser: Browser | null = null;

/** Pool configuration (set via initialize) */
let poolConfig: BrowserPoolConfig | null = null;

/** Whether shutdown has been initiated */
let isShuttingDown = false;

// ============================================================================
// Browser Lifecycle
// ============================================================================

/**
 * Initializes the browser pool with configuration.
 * 
 * Must be called before getBrowser(). Configuration is stored for
 * lazy browser launch.
 */
export function initializeBrowserPool(config: BrowserPoolConfig): void {
  if (browser) {
    logger.warn("Browser pool already has active browser, config change will apply on next launch");
  }
  poolConfig = config;
  isShuttingDown = false;
  logger.info({ headless: config.headless }, "Browser pool initialized");
}

/**
 * Gets or creates the shared browser instance.
 * 
 * - Lazily launches browser on first call
 * - Reconnects if browser is disconnected
 * - Returns the same browser for concurrent requests
 * 
 * @throws Error if pool not initialized or shutdown in progress
 */
export async function getBrowser(): Promise<Browser> {
  if (!poolConfig) {
    throw new Error("Browser pool not initialized. Call initializeBrowserPool() first.");
  }

  if (isShuttingDown) {
    throw new Error("Browser pool is shutting down, cannot acquire browser");
  }

  // Check if we need to launch or reconnect
  if (!browser || !browser.isConnected()) {
    logger.info("Launching browser...");
    
    const launchArgs = poolConfig.launchArgs ?? [...DEFAULT_LAUNCH_ARGS];
    
    browser = await chromium.launch({
      headless: poolConfig.headless,
      args: launchArgs,
    });
    
    logger.info("Browser launched");
  }

  return browser;
}

/**
 * Checks if the browser pool has an active browser.
 */
export function hasBrowser(): boolean {
  return browser !== null && browser.isConnected();
}

/**
 * Checks if the pool has been initialized.
 */
export function isInitialized(): boolean {
  return poolConfig !== null;
}

/**
 * Checks if shutdown has been initiated.
 */
export function isPoolShuttingDown(): boolean {
  return isShuttingDown;
}

// ============================================================================
// Shutdown
// ============================================================================

/**
 * Gracefully shuts down the browser pool.
 * 
 * - Marks pool as shutting down (blocks new acquisitions)
 * - Closes the browser if active
 * - Safe to call multiple times
 * 
 * Note: This does not wait for in-flight pages to complete.
 * The worker should close jobs first before calling this.
 */
export async function shutdownBrowserPool(): Promise<void> {
  if (isShuttingDown) {
    logger.debug("Browser pool shutdown already in progress");
    return;
  }

  isShuttingDown = true;
  logger.info("Shutting down browser pool...");

  if (browser) {
    try {
      await browser.close();
      logger.info("Browser closed");
    } catch (error) {
      // Browser may already be closed or crashed
      logger.warn({ error }, "Error closing browser (may already be closed)");
    }
    browser = null;
  }

  logger.info("Browser pool shutdown complete");
}

/**
 * Resets the pool state for testing purposes.
 * 
 * WARNING: Only use in tests. In production, use shutdownBrowserPool().
 */
export async function resetBrowserPool(): Promise<void> {
  if (browser && browser.isConnected()) {
    await browser.close();
  }
  browser = null;
  poolConfig = null;
  isShuttingDown = false;
}

// ============================================================================
// Statistics
// ============================================================================

export interface BrowserPoolStats {
  /** Whether pool has been initialized */
  initialized: boolean;
  /** Whether browser is currently active */
  browserActive: boolean;
  /** Whether shutdown has been initiated */
  shuttingDown: boolean;
  /** Current pool configuration */
  config: BrowserPoolConfig | null;
}

/**
 * Returns current pool statistics for monitoring/debugging.
 */
export function getBrowserPoolStats(): BrowserPoolStats {
  return {
    initialized: poolConfig !== null,
    browserActive: browser !== null && browser.isConnected(),
    shuttingDown: isShuttingDown,
    config: poolConfig,
  };
}
