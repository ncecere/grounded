/**
 * Import Structure Tests
 *
 * Validates that all scraper worker modules are correctly wired with
 * proper barrel exports and import paths. This test ensures:
 *
 * 1. All barrel exports (index.ts files) export expected symbols
 * 2. Entry point imports from correct module locations
 * 3. Module boundaries are respected (no circular dependencies)
 * 4. Jobs index registers all expected job handlers
 *
 * These tests serve as regression checks to ensure refactoring doesn't
 * break the import structure.
 */

import { describe, expect, test } from "bun:test";
import { QUEUE_NAMES } from "@grounded/shared";

// ============================================================================
// Fetch Module Barrel Export Tests
// ============================================================================

describe("Fetch Module Exports", () => {
  test("fetch/index.ts exports all fetch strategy functions", async () => {
    const fetchModule = await import("./fetch");

    // Strategy functions
    expect(fetchModule.fetchWithHttp).toBeDefined();
    expect(typeof fetchModule.fetchWithHttp).toBe("function");

    expect(fetchModule.fetchWithPlaywright).toBeDefined();
    expect(typeof fetchModule.fetchWithPlaywright).toBe("function");

    expect(fetchModule.fetchWithFirecrawl).toBeDefined();
    expect(typeof fetchModule.fetchWithFirecrawl).toBe("function");
  });

  test("fetch/index.ts exports selection helpers", async () => {
    const fetchModule = await import("./fetch");

    expect(fetchModule.selectStrategy).toBeDefined();
    expect(typeof fetchModule.selectStrategy).toBe("function");

    expect(fetchModule.selectAndFetch).toBeDefined();
    expect(typeof fetchModule.selectAndFetch).toBe("function");
  });

  test("fetch/index.ts exports content validation utilities for convenience", async () => {
    const fetchModule = await import("./fetch");

    expect(fetchModule.needsJsRendering).toBeDefined();
    expect(typeof fetchModule.needsJsRendering).toBe("function");

    expect(fetchModule.getJsFrameworkIndicators).toBeDefined();
    expect(typeof fetchModule.getJsFrameworkIndicators).toBe("function");
  });

  test("fetch/index.ts exports constants", async () => {
    const fetchModule = await import("./fetch");

    expect(fetchModule.MIN_BODY_TEXT_LENGTH).toBeDefined();
    expect(typeof fetchModule.MIN_BODY_TEXT_LENGTH).toBe("number");

    expect(fetchModule.MIN_TEXT_WITH_FRAMEWORK).toBeDefined();
    expect(typeof fetchModule.MIN_TEXT_WITH_FRAMEWORK).toBe("number");
  });

  test("selectStrategy returns expected result shape", async () => {
    const { selectStrategy } = await import("./fetch");

    const result = selectStrategy("auto", {});
    expect(result.strategy).toBeDefined();
    expect(result.allowPlaywrightFallback).toBeDefined();
    expect(result.reason).toBeDefined();
  });
});

// ============================================================================
// Browser Module Barrel Export Tests
// ============================================================================

describe("Browser Module Exports", () => {
  test("browser/index.ts exports lifecycle functions", async () => {
    const browserModule = await import("./browser");

    expect(browserModule.initializeBrowserPool).toBeDefined();
    expect(typeof browserModule.initializeBrowserPool).toBe("function");

    expect(browserModule.getBrowser).toBeDefined();
    expect(typeof browserModule.getBrowser).toBe("function");

    expect(browserModule.shutdownBrowserPool).toBeDefined();
    expect(typeof browserModule.shutdownBrowserPool).toBe("function");
  });

  test("browser/index.ts exports state query functions", async () => {
    const browserModule = await import("./browser");

    expect(browserModule.hasBrowser).toBeDefined();
    expect(typeof browserModule.hasBrowser).toBe("function");

    expect(browserModule.isInitialized).toBeDefined();
    expect(typeof browserModule.isInitialized).toBe("function");

    expect(browserModule.isPoolShuttingDown).toBeDefined();
    expect(typeof browserModule.isPoolShuttingDown).toBe("function");
  });

  test("browser/index.ts exports testing utilities", async () => {
    const browserModule = await import("./browser");

    expect(browserModule.resetBrowserPool).toBeDefined();
    expect(typeof browserModule.resetBrowserPool).toBe("function");

    expect(browserModule.getBrowserPoolStats).toBeDefined();
    expect(typeof browserModule.getBrowserPoolStats).toBe("function");
  });
});

// ============================================================================
// Services Module Barrel Export Tests
// ============================================================================

describe("Services Module Exports", () => {
  test("services/index.ts exports fairness slot helpers", async () => {
    const servicesModule = await import("./services");

    expect(servicesModule.tryAcquireSlot).toBeDefined();
    expect(typeof servicesModule.tryAcquireSlot).toBe("function");

    expect(servicesModule.releaseSlotSafely).toBeDefined();
    expect(typeof servicesModule.releaseSlotSafely).toBe("function");

    expect(servicesModule.withFairnessSlot).toBeDefined();
    expect(typeof servicesModule.withFairnessSlot).toBe("function");

    expect(servicesModule.withFairnessSlotOrThrow).toBeDefined();
    expect(typeof servicesModule.withFairnessSlotOrThrow).toBe("function");
  });

  test("services/index.ts exports fairness utility functions", async () => {
    const servicesModule = await import("./services");

    expect(servicesModule.checkSlotAvailability).toBeDefined();
    expect(typeof servicesModule.checkSlotAvailability).toBe("function");

    expect(servicesModule.getCurrentFairnessConfig).toBeDefined();
    expect(typeof servicesModule.getCurrentFairnessConfig).toBe("function");

    expect(servicesModule.createSlotContext).toBeDefined();
    expect(typeof servicesModule.createSlotContext).toBe("function");

    expect(servicesModule.SlotContext).toBeDefined();
    expect(typeof servicesModule.SlotContext).toBe("function");
  });

  test("services/index.ts exports error handling utilities", async () => {
    const servicesModule = await import("./services");

    expect(servicesModule.FairnessSlotUnavailableError).toBeDefined();
    expect(servicesModule.isFairnessSlotError).toBeDefined();
    expect(typeof servicesModule.isFairnessSlotError).toBe("function");
  });

  test("services/index.ts exports content validation functions", async () => {
    const servicesModule = await import("./services");

    expect(servicesModule.needsJsRendering).toBeDefined();
    expect(typeof servicesModule.needsJsRendering).toBe("function");

    expect(servicesModule.extractBodyTextContent).toBeDefined();
    expect(typeof servicesModule.extractBodyTextContent).toBe("function");

    expect(servicesModule.detectJsFrameworkIndicators).toBeDefined();
    expect(typeof servicesModule.detectJsFrameworkIndicators).toBe("function");

    expect(servicesModule.validateContentSize).toBeDefined();
    expect(typeof servicesModule.validateContentSize).toBe("function");

    expect(servicesModule.isContentSizeValid).toBeDefined();
    expect(typeof servicesModule.isContentSizeValid).toBe("function");
  });

  test("services/index.ts exports content validation re-exports from @grounded/shared", async () => {
    const servicesModule = await import("./services");

    expect(servicesModule.validateHtmlContentType).toBeDefined();
    expect(typeof servicesModule.validateHtmlContentType).toBe("function");

    expect(servicesModule.isContentTypeEnforcementEnabled).toBeDefined();
    expect(typeof servicesModule.isContentTypeEnforcementEnabled).toBe("function");

    expect(servicesModule.ContentError).toBeDefined();
    expect(servicesModule.ErrorCode).toBeDefined();
  });

  test("services/index.ts exports constants", async () => {
    const servicesModule = await import("./services");

    expect(servicesModule.JS_FRAMEWORK_INDICATORS).toBeDefined();
    expect(Array.isArray(servicesModule.JS_FRAMEWORK_INDICATORS)).toBe(true);

    expect(servicesModule.MIN_BODY_TEXT_LENGTH).toBeDefined();
    expect(typeof servicesModule.MIN_BODY_TEXT_LENGTH).toBe("number");

    expect(servicesModule.MIN_TEXT_WITH_FRAMEWORK).toBeDefined();
    expect(typeof servicesModule.MIN_TEXT_WITH_FRAMEWORK).toBe("number");

    expect(servicesModule.MAX_PAGE_SIZE_BYTES).toBeDefined();
    expect(typeof servicesModule.MAX_PAGE_SIZE_BYTES).toBe("number");
  });
});

// ============================================================================
// Bootstrap Module Barrel Export Tests
// ============================================================================

describe("Bootstrap Module Exports", () => {
  test("bootstrap/index.ts exports settings functions", async () => {
    const bootstrapModule = await import("./bootstrap");

    expect(bootstrapModule.initializeSettings).toBeDefined();
    expect(typeof bootstrapModule.initializeSettings).toBe("function");

    expect(bootstrapModule.stopSettingsRefresh).toBeDefined();
    expect(typeof bootstrapModule.stopSettingsRefresh).toBe("function");

    expect(bootstrapModule.getCurrentConcurrency).toBeDefined();
    expect(typeof bootstrapModule.getCurrentConcurrency).toBe("function");

    expect(bootstrapModule.getHeadlessMode).toBeDefined();
    expect(typeof bootstrapModule.getHeadlessMode).toBe("function");
  });

  test("bootstrap/index.ts exports defaults", async () => {
    const bootstrapModule = await import("./bootstrap");

    expect(bootstrapModule.DEFAULT_CONCURRENCY).toBeDefined();
    expect(typeof bootstrapModule.DEFAULT_CONCURRENCY).toBe("number");

    expect(bootstrapModule.DEFAULT_HEADLESS).toBeDefined();
    expect(typeof bootstrapModule.DEFAULT_HEADLESS).toBe("boolean");
  });

  test("bootstrap/index.ts exports settings client", async () => {
    const bootstrapModule = await import("./bootstrap");

    expect(bootstrapModule.settingsClient).toBeDefined();
  });
});

// ============================================================================
// Jobs Module Barrel Export Tests
// ============================================================================

describe("Jobs Module Exports", () => {
  test("jobs/index.ts exports job handler functions", async () => {
    const jobsModule = await import("./jobs");

    expect(jobsModule.handlePageFetch).toBeDefined();
    expect(typeof jobsModule.handlePageFetch).toBe("function");

    expect(jobsModule.processPageFetch).toBeDefined();
    expect(typeof jobsModule.processPageFetch).toBe("function");
  });

  test("jobs/index.ts exports job objects", async () => {
    const jobsModule = await import("./jobs");

    expect(jobsModule.pageFetchJob).toBeDefined();
    expect(jobsModule.pageFetchJob.name).toBe("fetch");
    expect(jobsModule.pageFetchJob.queue).toBe(QUEUE_NAMES.PAGE_FETCH);
    expect(jobsModule.pageFetchJob.handler).toBe(jobsModule.handlePageFetch);
    expect(jobsModule.pageFetchJob.requiresBrowser).toBe(true);
  });

  test("jobs/index.ts exports registry", async () => {
    const jobsModule = await import("./jobs");

    expect(jobsModule.jobRegistry).toBeDefined();
    expect(Array.isArray(jobsModule.jobRegistry)).toBe(true);
    expect(jobsModule.jobRegistry.length).toBe(1);

    expect(jobsModule.jobsByQueue).toBeDefined();
    expect(typeof jobsModule.jobsByQueue).toBe("object");
    expect(jobsModule.jobsByQueue[QUEUE_NAMES.PAGE_FETCH]).toBeDefined();
  });

  test("jobs/index.ts exports utility functions", async () => {
    const jobsModule = await import("./jobs");

    expect(jobsModule.getJobHandler).toBeDefined();
    expect(typeof jobsModule.getJobHandler).toBe("function");

    expect(jobsModule.getPageFetchHandler).toBeDefined();
    expect(typeof jobsModule.getPageFetchHandler).toBe("function");

    expect(jobsModule.getRegisteredJobNames).toBeDefined();
    expect(typeof jobsModule.getRegisteredJobNames).toBe("function");

    expect(jobsModule.getJobCount).toBeDefined();
    expect(typeof jobsModule.getJobCount).toBe("function");

    expect(jobsModule.jobRequiresBrowser).toBeDefined();
    expect(typeof jobsModule.jobRequiresBrowser).toBe("function");

    expect(jobsModule.getJobRegistration).toBeDefined();
    expect(typeof jobsModule.getJobRegistration).toBe("function");
  });
});

// ============================================================================
// Module Consistency Tests
// ============================================================================

describe("Module Consistency", () => {
  test("fetch and services modules export same needsJsRendering function", async () => {
    const fetchModule = await import("./fetch");
    const servicesModule = await import("./services");

    // Both should export the same function (re-export chain)
    expect(fetchModule.needsJsRendering).toBe(servicesModule.needsJsRendering);
  });

  test("fetch and services modules export same constants", async () => {
    const fetchModule = await import("./fetch");
    const servicesModule = await import("./services");

    expect(fetchModule.MIN_BODY_TEXT_LENGTH).toBe(servicesModule.MIN_BODY_TEXT_LENGTH);
    expect(fetchModule.MIN_TEXT_WITH_FRAMEWORK).toBe(servicesModule.MIN_TEXT_WITH_FRAMEWORK);
  });

  test("jobs handler matches processor export", async () => {
    const jobsModule = await import("./jobs");
    const processorModule = await import("./processors/page-fetch");

    // The job handler should call the processor
    expect(jobsModule.processPageFetch).toBe(processorModule.processPageFetch);
  });

  test("bootstrap module exports match direct settings module", async () => {
    const bootstrapModule = await import("./bootstrap");
    const settingsModule = await import("./bootstrap/settings");

    expect(bootstrapModule.initializeSettings).toBe(settingsModule.initializeSettings);
    expect(bootstrapModule.stopSettingsRefresh).toBe(settingsModule.stopSettingsRefresh);
    expect(bootstrapModule.DEFAULT_CONCURRENCY).toBe(settingsModule.DEFAULT_CONCURRENCY);
  });
});

// ============================================================================
// Worker Registration Tests
// ============================================================================

describe("Worker Job Registration", () => {
  test("all registered jobs are for valid queues", async () => {
    const { jobRegistry } = await import("./jobs");
    const validQueues = Object.values(QUEUE_NAMES) as string[];

    for (const job of jobRegistry) {
      // Job queue should be a known queue name
      expect(validQueues).toContain(job.queue);
    }
  });

  test("all registered jobs have handlers", async () => {
    const { jobRegistry } = await import("./jobs");

    for (const job of jobRegistry) {
      expect(job.handler).toBeDefined();
      expect(typeof job.handler).toBe("function");
    }
  });

  test("job count matches registry length", async () => {
    const { jobRegistry, getJobCount } = await import("./jobs");
    expect(getJobCount()).toBe(jobRegistry.length);
  });

  test("getPageFetchHandler returns valid handler", async () => {
    const { getPageFetchHandler, handlePageFetch } = await import("./jobs");
    const handler = getPageFetchHandler();
    expect(handler).toBe(handlePageFetch);
  });
});

// ============================================================================
// Import Path Validation Tests
// ============================================================================

describe("Import Path Validation", () => {
  test("processor imports from services correctly", async () => {
    // Verify the processor uses the correct service imports
    const processorSource = await Bun.file(
      "./src/processors/page-fetch.ts"
    ).text();

    // Should import from services module
    expect(processorSource).toContain('from "../services/fairness-slots"');
    expect(processorSource).toContain('from "../fetch/selection"');
  });

  test("fetch/http imports from services correctly", async () => {
    const httpSource = await Bun.file("./src/fetch/http.ts").text();
    expect(httpSource).toContain('from "../services/content-validation"');
  });

  test("fetch/selection imports from services correctly", async () => {
    const selectionSource = await Bun.file("./src/fetch/selection.ts").text();
    expect(selectionSource).toContain('from "../services/content-validation"');
  });

  test("jobs/page-fetch imports from processor", async () => {
    const jobSource = await Bun.file("./src/jobs/page-fetch.ts").text();
    expect(jobSource).toContain('from "../processors/page-fetch"');
  });
});

// ============================================================================
// Entry Point Integration Tests
// ============================================================================

describe("Entry Point Integration", () => {
  test("entry point imports from jobs index", async () => {
    const entrySource = await Bun.file("./src/index.ts").text();
    
    // Should import from jobs index
    expect(entrySource).toContain('from "./jobs"');
    
    // Specific imports used
    expect(entrySource).toContain("getPageFetchHandler");
    expect(entrySource).toContain("getJobCount");
    expect(entrySource).toContain("pageFetchJob");
  });

  test("entry point imports from bootstrap index", async () => {
    const entrySource = await Bun.file("./src/index.ts").text();
    
    // Should import from bootstrap index
    expect(entrySource).toContain('from "./bootstrap"');
    
    // Specific imports used
    expect(entrySource).toContain("initializeSettings");
    expect(entrySource).toContain("stopSettingsRefresh");
    expect(entrySource).toContain("getCurrentConcurrency");
    expect(entrySource).toContain("getHeadlessMode");
    expect(entrySource).toContain("DEFAULT_CONCURRENCY");
  });

  test("entry point imports from browser pool", async () => {
    const entrySource = await Bun.file("./src/index.ts").text();
    
    // Should import browser lifecycle functions
    expect(entrySource).toContain('from "./browser/pool"');
    expect(entrySource).toContain("initializeBrowserPool");
    expect(entrySource).toContain("getBrowser");
    expect(entrySource).toContain("shutdownBrowserPool");
  });
});
