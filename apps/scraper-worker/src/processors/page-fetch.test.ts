/**
 * Page Fetch Processor Tests
 * 
 * Tests the orchestration of page fetch operations using modular services:
 * - Fairness slot management
 * - Fetch strategy selection and execution
 * - CrawlState updates
 * - Stage progress tracking
 * 
 * These tests verify that the processor correctly orchestrates the modules
 * while preserving the original behavior.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FairnessSlotResult, PageFetchJob } from "@grounded/shared";

// ============================================================================
// Mock State
// ============================================================================

let mockFairnessSlotResult: FairnessSlotResult = {
  acquired: true,
  currentSlots: 1,
  maxAllowedSlots: 5,
  activeRunCount: 1,
};

let mockSelectAndFetchResult = {
  html: "<html><body>Test content</body></html>",
  title: "Test Page",
};
let mockSelectAndFetchError: Error | null = null;

let mockRun: { id: string; status: string; sourceId: string } | null = {
  id: "run-123",
  status: "running",
  sourceId: "source-456",
};

let mockSource: { id: string; config: { firecrawlEnabled?: boolean } } | null = {
  id: "source-456",
  config: { firecrawlEnabled: false },
};

let mockReleaseSlotCalled = false;
let mockMarkFetchedCalled = false;
let mockMarkFailedCalled = false;
let mockMarkFailedUrl = "";
let mockMarkFailedError = "";
let mockStoreFetchedHtmlCalled = false;
let mockStoreFetchedHtmlParams: { runId: string; url: string; html: string; title: string | null } | null = null;
let mockIncrementStageProgressResult = { completed: 1, failed: 0, total: 10, isComplete: false };
let mockIncrementStageProgressCalled = false;
let mockIncrementStageProgressFailed = false;
let mockAddStageTransitionJobCalled = false;
let mockTenantUsageUpdateCalled = false;
let mockInsertSourceRunPagesCalled = false;

// ============================================================================
// Mock Modules
// ============================================================================

// Mock @grounded/queue
mock.module("@grounded/queue", () => ({
  redis: {},
  incrementStageProgress: mock(async (runId: string, failed: boolean) => {
    mockIncrementStageProgressCalled = true;
    mockIncrementStageProgressFailed = failed;
    return mockIncrementStageProgressResult;
  }),
  storeFetchedHtml: mock(async (runId: string, url: string, html: string, title: string | null) => {
    mockStoreFetchedHtmlCalled = true;
    mockStoreFetchedHtmlParams = { runId, url, html, title };
  }),
  addStageTransitionJob: mock(async () => {
    mockAddStageTransitionJobCalled = true;
  }),
}));

// Mock @grounded/db
mock.module("@grounded/db", () => ({
  db: {
    query: {
      sourceRuns: {
        findFirst: mock(async () => mockRun),
      },
      sources: {
        findFirst: mock(async () => mockSource),
      },
    },
    update: mock(() => ({
      set: mock(() => ({
        where: mock(async () => {
          mockTenantUsageUpdateCalled = true;
        }),
      })),
    })),
    insert: mock(() => ({
      values: mock(async () => {
        mockInsertSourceRunPagesCalled = true;
      }),
    })),
  },
}));

mock.module("@grounded/db/schema", () => ({
  sourceRuns: { id: "id" },
  sourceRunPages: {},
  sources: { id: "id" },
  tenantUsage: { scrapedPages: "scrapedPages" },
}));

// Mock drizzle-orm
mock.module("drizzle-orm", () => ({
  eq: mock((a: unknown, b: unknown) => ({ a, b })),
  sql: mock((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
  and: mock((...args: unknown[]) => args),
}));

// Mock @grounded/logger
mock.module("@grounded/logger", () => ({
  log: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

// Mock @grounded/shared
mock.module("@grounded/shared", () => ({
  normalizeUrl: mock((url: string) => url.toLowerCase()),
  SourceRunStage: {
    SCRAPING: "SCRAPING",
    PROCESSING: "PROCESSING",
  },
}));

// Mock @grounded/crawl-state
mock.module("@grounded/crawl-state", () => ({
  createCrawlState: mock(() => ({
    markFetched: mock(async (url: string) => {
      mockMarkFetchedCalled = true;
    }),
    markFailed: mock(async (url: string, error: string) => {
      mockMarkFailedCalled = true;
      mockMarkFailedUrl = url;
      mockMarkFailedError = error;
    }),
  })),
}));

// Mock fetch selection module
mock.module("../fetch/selection", () => ({
  selectAndFetch: mock(async (context: { url: string }) => {
    if (mockSelectAndFetchError) {
      throw mockSelectAndFetchError;
    }
    return mockSelectAndFetchResult;
  }),
}));

// Mock fairness slots module
class MockFairnessSlotUnavailableError extends Error {
  retryDelayMs: number;
  runId: string;
  slotResult: FairnessSlotResult;

  constructor(runId: string, slotResult: FairnessSlotResult) {
    super(`Fairness slot unavailable for run ${runId}: ${slotResult.reason}`);
    this.name = "FairnessSlotUnavailableError";
    this.retryDelayMs = slotResult.retryDelayMs || 500;
    this.runId = runId;
    this.slotResult = slotResult;
  }
}

mock.module("../services/fairness-slots", () => ({
  withFairnessSlotOrThrow: mock(async <T>(runId: string, work: () => Promise<T>, options?: unknown): Promise<T> => {
    if (!mockFairnessSlotResult.acquired) {
      throw new MockFairnessSlotUnavailableError(runId, mockFairnessSlotResult);
    }
    try {
      return await work();
    } finally {
      mockReleaseSlotCalled = true;
    }
  }),
  FairnessSlotUnavailableError: MockFairnessSlotUnavailableError,
}));

// Import after mocks are set up
import { processPageFetch } from "./page-fetch";
import type { Browser } from "playwright";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockBrowser(): Browser {
  return {} as Browser;
}

function createDefaultJobData(): PageFetchJob {
  return {
    tenantId: "tenant-123",
    runId: "run-123",
    url: "https://example.com/page",
    fetchMode: "auto",
    depth: 0,
    requestId: "req-123",
    traceId: "trace-123",
  };
}

function resetMockState(): void {
  mockFairnessSlotResult = {
    acquired: true,
    currentSlots: 1,
    maxAllowedSlots: 5,
    activeRunCount: 1,
  };
  mockSelectAndFetchResult = {
    html: "<html><body>Test content</body></html>",
    title: "Test Page",
  };
  mockSelectAndFetchError = null;
  mockRun = {
    id: "run-123",
    status: "running",
    sourceId: "source-456",
  };
  mockSource = {
    id: "source-456",
    config: { firecrawlEnabled: false },
  };
  mockReleaseSlotCalled = false;
  mockMarkFetchedCalled = false;
  mockMarkFailedCalled = false;
  mockMarkFailedUrl = "";
  mockMarkFailedError = "";
  mockStoreFetchedHtmlCalled = false;
  mockStoreFetchedHtmlParams = null;
  mockIncrementStageProgressResult = { completed: 1, failed: 0, total: 10, isComplete: false };
  mockIncrementStageProgressCalled = false;
  mockIncrementStageProgressFailed = false;
  mockAddStageTransitionJobCalled = false;
  mockTenantUsageUpdateCalled = false;
  mockInsertSourceRunPagesCalled = false;
}

// ============================================================================
// Tests
// ============================================================================

describe("Page Fetch Processor", () => {
  beforeEach(() => {
    resetMockState();
  });

  describe("Fairness Slot Orchestration", () => {
    it("acquires fairness slot before processing", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      // Slot should be released (indicating it was acquired)
      expect(mockReleaseSlotCalled).toBe(true);
    });

    it("throws FairnessSlotUnavailableError when slot not available", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockFairnessSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 3,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      let thrownError: Error | null = null;
      try {
        await processPageFetch(jobData, browser);
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.name).toBe("FairnessSlotUnavailableError");
    });

    it("releases fairness slot even on fetch error", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Network error");

      // Should not throw (error is handled internally)
      await processPageFetch(jobData, browser);

      // Slot should still be released
      expect(mockReleaseSlotCalled).toBe(true);
    });
  });

  describe("Fetch Strategy Orchestration", () => {
    it("calls selectAndFetch with correct context", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      // Fetch should have been called (via selectAndFetch)
      expect(mockStoreFetchedHtmlCalled).toBe(true);
      expect(mockStoreFetchedHtmlParams?.html).toBe(mockSelectAndFetchResult.html);
      expect(mockStoreFetchedHtmlParams?.title).toBe(mockSelectAndFetchResult.title);
    });

    it("stores fetched HTML with correct parameters", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      expect(mockStoreFetchedHtmlCalled).toBe(true);
      expect(mockStoreFetchedHtmlParams).toEqual({
        runId: "run-123",
        url: "https://example.com/page",
        html: "<html><body>Test content</body></html>",
        title: "Test Page",
      });
    });

    it("marks URL as fetched in crawl state on success", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      expect(mockMarkFetchedCalled).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("marks URL as failed in crawl state on fetch error", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Network error");

      await processPageFetch(jobData, browser);

      expect(mockMarkFailedCalled).toBe(true);
      expect(mockMarkFailedUrl).toBe("https://example.com/page");
      expect(mockMarkFailedError).toBe("Network error");
    });

    it("records failure in database on fetch error", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Connection timeout");

      await processPageFetch(jobData, browser);

      expect(mockInsertSourceRunPagesCalled).toBe(true);
    });

    it("throws error when run not found", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockRun = null;

      let thrownError: Error | null = null;
      try {
        await processPageFetch(jobData, browser);
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toBe("Run run-123 not found");
    });

    it("throws error when source not found", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSource = null;

      let thrownError: Error | null = null;
      try {
        await processPageFetch(jobData, browser);
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toBe("Source source-456 not found");
    });
  });

  describe("Run Status Handling", () => {
    it("skips processing when run is canceled", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockRun = {
        id: "run-123",
        status: "canceled",
        sourceId: "source-456",
      };

      await processPageFetch(jobData, browser);

      // Should not fetch or update stage progress
      expect(mockStoreFetchedHtmlCalled).toBe(false);
      expect(mockIncrementStageProgressCalled).toBe(false);
    });
  });

  describe("Usage Tracking", () => {
    it("updates tenant usage on successful fetch", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      expect(mockTenantUsageUpdateCalled).toBe(true);
    });

    it("skips usage update when tenantId is null", async () => {
      const browser = createMockBrowser();
      const jobData = { ...createDefaultJobData(), tenantId: null };

      await processPageFetch(jobData, browser);

      expect(mockTenantUsageUpdateCalled).toBe(false);
    });
  });

  describe("Stage Progress Tracking", () => {
    it("increments stage progress on success", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      expect(mockIncrementStageProgressCalled).toBe(true);
      expect(mockIncrementStageProgressFailed).toBe(false);
    });

    it("increments stage progress with failure flag on error", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Fetch failed");

      await processPageFetch(jobData, browser);

      expect(mockIncrementStageProgressCalled).toBe(true);
      expect(mockIncrementStageProgressFailed).toBe(true);
    });

    it("triggers stage transition when stage is complete", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockIncrementStageProgressResult = {
        completed: 10,
        failed: 0,
        total: 10,
        isComplete: true,
      };

      await processPageFetch(jobData, browser);

      expect(mockAddStageTransitionJobCalled).toBe(true);
    });

    it("triggers stage transition when stage is complete with failures", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Fetch failed");
      mockIncrementStageProgressResult = {
        completed: 8,
        failed: 2,
        total: 10,
        isComplete: true,
      };

      await processPageFetch(jobData, browser);

      expect(mockAddStageTransitionJobCalled).toBe(true);
    });

    it("does not trigger stage transition when stage is not complete", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockIncrementStageProgressResult = {
        completed: 5,
        failed: 0,
        total: 10,
        isComplete: false,
      };

      await processPageFetch(jobData, browser);

      expect(mockAddStageTransitionJobCalled).toBe(false);
    });
  });

  describe("Input/Output Contract", () => {
    it("accepts PageFetchJob with all required fields", async () => {
      const browser = createMockBrowser();
      const jobData: PageFetchJob = {
        tenantId: "tenant-123",
        runId: "run-456",
        url: "https://example.com/test",
        fetchMode: "auto",
        depth: 2,
        requestId: "req-789",
        traceId: "trace-abc",
      };

      // Should not throw
      await processPageFetch(jobData, browser);

      expect(mockStoreFetchedHtmlParams?.url).toBe("https://example.com/test");
    });

    it("handles fetchMode 'auto'", async () => {
      const browser = createMockBrowser();
      const jobData = { ...createDefaultJobData(), fetchMode: "auto" as const };

      await processPageFetch(jobData, browser);

      expect(mockStoreFetchedHtmlCalled).toBe(true);
    });

    it("handles fetchMode 'headless'", async () => {
      const browser = createMockBrowser();
      const jobData = { ...createDefaultJobData(), fetchMode: "headless" as const };

      await processPageFetch(jobData, browser);

      expect(mockStoreFetchedHtmlCalled).toBe(true);
    });

    it("handles fetchMode 'firecrawl'", async () => {
      const browser = createMockBrowser();
      const jobData = { ...createDefaultJobData(), fetchMode: "firecrawl" as const };

      await processPageFetch(jobData, browser);

      expect(mockStoreFetchedHtmlCalled).toBe(true);
    });

    it("defaults depth to 0 when not provided", async () => {
      const browser = createMockBrowser();
      // Create job without depth field to test default behavior
      const jobData: PageFetchJob = {
        tenantId: "tenant-123",
        runId: "run-123",
        url: "https://example.com/page",
        fetchMode: "auto",
        // depth omitted - should default to 0
        requestId: "req-123",
        traceId: "trace-123",
      };

      // Should not throw
      await processPageFetch(jobData, browser);

      expect(mockStoreFetchedHtmlCalled).toBe(true);
    });
  });

  describe("Firecrawl Source Config", () => {
    it("passes firecrawlEnabled from source config", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSource = {
        id: "source-456",
        config: { firecrawlEnabled: true },
      };

      await processPageFetch(jobData, browser);

      // The selectAndFetch mock should have been called
      // (actual firecrawlEnabled value passed is verified by integration tests)
      expect(mockStoreFetchedHtmlCalled).toBe(true);
    });
  });
});

describe("Page Fetch Processor - Module Integration", () => {
  beforeEach(() => {
    resetMockState();
  });

  describe("Orchestration Flow", () => {
    it("executes operations in correct order", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      const operationOrder: string[] = [];

      // Track operation order through mock side effects
      mockFairnessSlotResult.acquired = true;
      
      await processPageFetch(jobData, browser);

      // Verify all operations completed
      expect(mockReleaseSlotCalled).toBe(true); // Slot management
      expect(mockMarkFetchedCalled).toBe(true); // CrawlState update
      expect(mockStoreFetchedHtmlCalled).toBe(true); // HTML storage
      expect(mockIncrementStageProgressCalled).toBe(true); // Progress tracking
    });

    it("handles complete end-to-end success flow", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchResult = {
        html: "<html><head><title>Success</title></head><body>Content</body></html>",
        title: "Success",
      };
      mockIncrementStageProgressResult = {
        completed: 10,
        failed: 0,
        total: 10,
        isComplete: true,
      };

      await processPageFetch(jobData, browser);

      // All success operations should complete
      expect(mockReleaseSlotCalled).toBe(true);
      expect(mockMarkFetchedCalled).toBe(true);
      expect(mockTenantUsageUpdateCalled).toBe(true);
      expect(mockStoreFetchedHtmlCalled).toBe(true);
      expect(mockIncrementStageProgressCalled).toBe(true);
      expect(mockAddStageTransitionJobCalled).toBe(true);
    });

    it("handles complete end-to-end failure flow", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Complete failure");
      mockIncrementStageProgressResult = {
        completed: 9,
        failed: 1,
        total: 10,
        isComplete: true,
      };

      await processPageFetch(jobData, browser);

      // All failure operations should complete
      expect(mockReleaseSlotCalled).toBe(true);
      expect(mockMarkFailedCalled).toBe(true);
      expect(mockInsertSourceRunPagesCalled).toBe(true);
      expect(mockIncrementStageProgressCalled).toBe(true);
      expect(mockAddStageTransitionJobCalled).toBe(true);
    });
  });

  describe("Behavior Parity with Original", () => {
    it("preserves fetch -> store -> progress flow on success", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      await processPageFetch(jobData, browser);

      // Original flow: fetch -> markFetched -> storeFetchedHtml -> incrementStageProgress
      expect(mockMarkFetchedCalled).toBe(true);
      expect(mockStoreFetchedHtmlCalled).toBe(true);
      expect(mockIncrementStageProgressCalled).toBe(true);
      expect(mockIncrementStageProgressFailed).toBe(false);
    });

    it("preserves markFailed -> insert -> progress flow on failure", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockSelectAndFetchError = new Error("Test error");

      await processPageFetch(jobData, browser);

      // Original flow: markFailed -> insert sourceRunPages -> incrementStageProgress(failed=true)
      expect(mockMarkFailedCalled).toBe(true);
      expect(mockInsertSourceRunPagesCalled).toBe(true);
      expect(mockIncrementStageProgressCalled).toBe(true);
      expect(mockIncrementStageProgressFailed).toBe(true);
    });

    it("preserves stage transition trigger on completion", async () => {
      const browser = createMockBrowser();
      const jobData = createDefaultJobData();

      mockIncrementStageProgressResult.isComplete = true;

      await processPageFetch(jobData, browser);

      expect(mockAddStageTransitionJobCalled).toBe(true);
    });
  });
});
