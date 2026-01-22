import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  initializeBrowserPool,
  getBrowser,
  hasBrowser,
  isInitialized,
  isPoolShuttingDown,
  shutdownBrowserPool,
  resetBrowserPool,
  getBrowserPoolStats,
} from "./pool";

// Mock chromium to avoid actually launching browsers in tests
const mockBrowser = {
  isConnected: mock(() => true),
  close: mock(async () => {}),
};

mock.module("playwright", () => ({
  chromium: {
    launch: mock(async () => mockBrowser),
  },
}));

describe("Browser Pool", () => {
  beforeEach(async () => {
    // Reset pool state before each test
    await resetBrowserPool();
    mockBrowser.isConnected.mockImplementation(() => true);
    mockBrowser.close.mockClear();
  });

  afterEach(async () => {
    // Clean up after each test
    await resetBrowserPool();
  });

  describe("initializeBrowserPool", () => {
    it("initializes pool with configuration", () => {
      initializeBrowserPool({ headless: true });

      expect(isInitialized()).toBe(true);
      expect(isPoolShuttingDown()).toBe(false);
    });

    it("stores headless configuration", () => {
      initializeBrowserPool({ headless: false });

      const stats = getBrowserPoolStats();
      expect(stats.initialized).toBe(true);
      expect(stats.config?.headless).toBe(false);
    });

    it("allows re-initialization with different config", () => {
      initializeBrowserPool({ headless: true });
      initializeBrowserPool({ headless: false });

      const stats = getBrowserPoolStats();
      expect(stats.config?.headless).toBe(false);
    });

    it("accepts custom launch args", () => {
      const customArgs = ["--custom-arg"];
      initializeBrowserPool({ headless: true, launchArgs: customArgs });

      const stats = getBrowserPoolStats();
      expect(stats.config?.launchArgs).toEqual(customArgs);
    });
  });

  describe("getBrowser", () => {
    it("throws if pool not initialized", async () => {
      await expect(getBrowser()).rejects.toThrow(
        "Browser pool not initialized. Call initializeBrowserPool() first."
      );
    });

    it("returns browser after initialization", async () => {
      initializeBrowserPool({ headless: true });

      const browser = await getBrowser();

      expect(browser).toBeDefined();
      expect(browser.isConnected()).toBe(true);
    });

    it("reuses the same browser instance", async () => {
      initializeBrowserPool({ headless: true });

      const browser1 = await getBrowser();
      const browser2 = await getBrowser();

      expect(browser1).toBe(browser2);
    });

    it("reconnects if browser is disconnected", async () => {
      initializeBrowserPool({ headless: true });

      // First call - browser is connected
      const browser1 = await getBrowser();
      
      // Simulate browser disconnect
      mockBrowser.isConnected.mockImplementation(() => false);
      
      // Second call should create new browser
      const browser2 = await getBrowser();

      // Both should be mock browser (same object reference from mock)
      expect(browser1).toBe(browser2);
      // isConnected was checked
      expect(mockBrowser.isConnected).toHaveBeenCalled();
    });

    it("throws if pool is shutting down", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser(); // Start browser
      await shutdownBrowserPool(); // Initiate shutdown

      await expect(getBrowser()).rejects.toThrow(
        "Browser pool is shutting down, cannot acquire browser"
      );
    });
  });

  describe("hasBrowser", () => {
    it("returns false when pool not initialized", () => {
      expect(hasBrowser()).toBe(false);
    });

    it("returns false before first getBrowser call", () => {
      initializeBrowserPool({ headless: true });
      expect(hasBrowser()).toBe(false);
    });

    it("returns true after browser is acquired", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();

      expect(hasBrowser()).toBe(true);
    });

    it("returns false after shutdown", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();
      await shutdownBrowserPool();

      expect(hasBrowser()).toBe(false);
    });
  });

  describe("isInitialized", () => {
    it("returns false before initialization", () => {
      expect(isInitialized()).toBe(false);
    });

    it("returns true after initialization", () => {
      initializeBrowserPool({ headless: true });
      expect(isInitialized()).toBe(true);
    });

    it("returns false after reset", async () => {
      initializeBrowserPool({ headless: true });
      await resetBrowserPool();

      expect(isInitialized()).toBe(false);
    });
  });

  describe("isPoolShuttingDown", () => {
    it("returns false initially", () => {
      expect(isPoolShuttingDown()).toBe(false);
    });

    it("returns false after initialization", () => {
      initializeBrowserPool({ headless: true });
      expect(isPoolShuttingDown()).toBe(false);
    });

    it("returns true after shutdown starts", async () => {
      initializeBrowserPool({ headless: true });
      await shutdownBrowserPool();

      expect(isPoolShuttingDown()).toBe(true);
    });

    it("returns false after re-initialization", async () => {
      initializeBrowserPool({ headless: true });
      await shutdownBrowserPool();
      initializeBrowserPool({ headless: true }); // Re-init resets shutdown flag

      expect(isPoolShuttingDown()).toBe(false);
    });
  });

  describe("shutdownBrowserPool", () => {
    it("closes browser if active", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();
      await shutdownBrowserPool();

      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("is safe to call without browser", async () => {
      initializeBrowserPool({ headless: true });
      // Don't acquire browser
      await shutdownBrowserPool();

      // Should not throw
      expect(mockBrowser.close).not.toHaveBeenCalled();
    });

    it("is safe to call multiple times", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();

      await shutdownBrowserPool();
      await shutdownBrowserPool();

      // close() only called once
      expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    });

    it("marks pool as shutting down", async () => {
      initializeBrowserPool({ headless: true });
      
      expect(isPoolShuttingDown()).toBe(false);
      await shutdownBrowserPool();
      expect(isPoolShuttingDown()).toBe(true);
    });
  });

  describe("resetBrowserPool", () => {
    it("clears all state", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();
      await resetBrowserPool();

      expect(isInitialized()).toBe(false);
      expect(hasBrowser()).toBe(false);
      expect(isPoolShuttingDown()).toBe(false);
    });

    it("closes browser before reset", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();
      await resetBrowserPool();

      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe("getBrowserPoolStats", () => {
    it("returns uninitialized state", () => {
      const stats = getBrowserPoolStats();

      expect(stats).toEqual({
        initialized: false,
        browserActive: false,
        shuttingDown: false,
        config: null,
      });
    });

    it("returns initialized state", () => {
      initializeBrowserPool({ headless: true });
      const stats = getBrowserPoolStats();

      expect(stats.initialized).toBe(true);
      expect(stats.browserActive).toBe(false);
      expect(stats.shuttingDown).toBe(false);
      expect(stats.config).toEqual({ headless: true });
    });

    it("returns active browser state", async () => {
      initializeBrowserPool({ headless: true });
      await getBrowser();
      const stats = getBrowserPoolStats();

      expect(stats.browserActive).toBe(true);
    });

    it("returns shutdown state", async () => {
      initializeBrowserPool({ headless: true });
      await shutdownBrowserPool();
      const stats = getBrowserPoolStats();

      expect(stats.shuttingDown).toBe(true);
      expect(stats.browserActive).toBe(false);
    });
  });

  describe("Playwright fetcher integration", () => {
    it("browser from pool works with Playwright context pattern", async () => {
      // This test verifies the browser object structure matches what Playwright expects
      initializeBrowserPool({ headless: true });
      const browser = await getBrowser();

      // Browser should have isConnected method
      expect(typeof browser.isConnected).toBe("function");
      expect(browser.isConnected()).toBe(true);
    });
  });
});
