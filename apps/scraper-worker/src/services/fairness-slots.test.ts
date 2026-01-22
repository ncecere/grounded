import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FairnessSlotResult, FairnessConfig } from "@grounded/shared";

// Track mock state
let mockAcquireSlotResult: FairnessSlotResult = {
  acquired: true,
  currentSlots: 1,
  maxAllowedSlots: 5,
  activeRunCount: 1,
};

let mockReleaseSlotCalled = false;
let mockReleaseSlotError: Error | null = null;
let mockFairnessConfig: FairnessConfig = {
  enabled: true,
  totalSlots: 5,
  minSlotsPerRun: 1,
  maxSlotsPerRun: 5,
  retryDelayMs: 500,
  slotTtlSeconds: 300,
  debug: false,
};
let mockRunSlotCount = 0;
let mockIsRunRegistered = true;

// Mock the @grounded/queue module
mock.module("@grounded/queue", () => ({
  acquireSlot: mock(async () => mockAcquireSlotResult),
  releaseSlot: mock(async () => {
    mockReleaseSlotCalled = true;
    if (mockReleaseSlotError) {
      throw mockReleaseSlotError;
    }
  }),
  FairnessSlotUnavailableError: class FairnessSlotUnavailableError extends Error {
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
  },
  isFairnessSlotError: mock((error: unknown): boolean => {
    return error instanceof Error && error.name === "FairnessSlotUnavailableError";
  }),
  getFairnessConfig: mock(() => mockFairnessConfig),
  getRunSlotCount: mock(async () => mockRunSlotCount),
  isRunRegistered: mock(async () => mockIsRunRegistered),
}));

// Mock the logger
mock.module("@grounded/logger", () => ({
  log: {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  },
}));

// Import after mocks
import {
  tryAcquireSlot,
  releaseSlotSafely,
  withFairnessSlot,
  withFairnessSlotOrThrow,
  checkSlotAvailability,
  getCurrentFairnessConfig,
  createSlotContext,
  SlotContext,
  FairnessSlotUnavailableError,
  isFairnessSlotError,
} from "./fairness-slots";
import { log } from "@grounded/logger";

describe("Fairness Slots Service", () => {
  beforeEach(() => {
    // Reset mock state
    mockAcquireSlotResult = {
      acquired: true,
      currentSlots: 1,
      maxAllowedSlots: 5,
      activeRunCount: 1,
    };
    mockReleaseSlotCalled = false;
    mockReleaseSlotError = null;
    mockFairnessConfig = {
      enabled: true,
      totalSlots: 5,
      minSlotsPerRun: 1,
      maxSlotsPerRun: 5,
      retryDelayMs: 500,
      slotTtlSeconds: 300,
      debug: false,
    };
    mockRunSlotCount = 0;
    mockIsRunRegistered = true;
  });

  afterEach(() => {
    mock.restore();
  });

  describe("tryAcquireSlot", () => {
    it("returns slot result when acquisition succeeds", async () => {
      const result = await tryAcquireSlot("run-123");

      expect(result.acquired).toBe(true);
      expect(result.currentSlots).toBe(1);
      expect(result.maxAllowedSlots).toBe(5);
      expect(result.activeRunCount).toBe(1);
    });

    it("returns slot result when acquisition fails", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 1,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      const result = await tryAcquireSlot("run-123");

      expect(result.acquired).toBe(false);
      expect(result.reason).toBe("at_limit");
      expect(result.retryDelayMs).toBe(500);
    });

    it("logs when acquisition fails", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 2,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      await tryAcquireSlot("run-456", { requestId: "req-1", traceId: "trace-1" });

      expect(log.debug).toHaveBeenCalledWith(
        "scraper-worker",
        "Fairness slot acquisition attempt",
        expect.objectContaining({
          runId: "run-456",
          acquired: false,
          reason: "at_limit",
          requestId: "req-1",
          traceId: "trace-1",
        })
      );
    });

    it("logs when debug option is enabled", async () => {
      await tryAcquireSlot("run-789", { debug: true });

      expect(log.debug).toHaveBeenCalledWith(
        "scraper-worker",
        "Fairness slot acquisition attempt",
        expect.objectContaining({
          runId: "run-789",
          acquired: true,
        })
      );
    });
  });

  describe("releaseSlotSafely", () => {
    it("releases slot without throwing", async () => {
      await releaseSlotSafely("run-123");

      expect(mockReleaseSlotCalled).toBe(true);
    });

    it("logs when debug option is enabled", async () => {
      await releaseSlotSafely("run-456", { debug: true, requestId: "req-2" });

      expect(log.debug).toHaveBeenCalledWith(
        "scraper-worker",
        "Fairness slot released",
        expect.objectContaining({
          runId: "run-456",
          requestId: "req-2",
        })
      );
    });

    it("catches and logs errors without throwing", async () => {
      mockReleaseSlotError = new Error("Redis connection failed");

      // Should not throw
      await releaseSlotSafely("run-789", { requestId: "req-3" });

      expect(log.warn).toHaveBeenCalledWith(
        "scraper-worker",
        "Failed to release fairness slot",
        expect.objectContaining({
          runId: "run-789",
          error: "Redis connection failed",
          requestId: "req-3",
        })
      );
    });
  });

  describe("withFairnessSlot", () => {
    it("executes work when slot is acquired", async () => {
      const workFn = mock(async () => "result");

      const result = await withFairnessSlot("run-123", workFn);

      expect(result.acquired).toBe(true);
      expect(result.result).toBe("result");
      expect(workFn).toHaveBeenCalled();
    });

    it("returns not acquired when slot unavailable", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 1,
        reason: "at_limit",
        retryDelayMs: 500,
      };
      const workFn = mock(async () => "result");

      const result = await withFairnessSlot("run-123", workFn);

      expect(result.acquired).toBe(false);
      expect(result.result).toBeUndefined();
      expect(workFn).not.toHaveBeenCalled();
    });

    it("releases slot after successful work", async () => {
      await withFairnessSlot("run-123", async () => "done");

      expect(mockReleaseSlotCalled).toBe(true);
    });

    it("releases slot even when work throws", async () => {
      try {
        await withFairnessSlot("run-123", async () => {
          throw new Error("Work failed");
        });
      } catch {
        // Expected
      }

      expect(mockReleaseSlotCalled).toBe(true);
    });

    it("propagates work errors", async () => {
      await expect(
        withFairnessSlot("run-123", async () => {
          throw new Error("Processing error");
        })
      ).rejects.toThrow("Processing error");
    });

    it("includes slotResult in return value", async () => {
      const result = await withFairnessSlot("run-123", async () => 42);

      expect(result.slotResult).toBeDefined();
      expect(result.slotResult.acquired).toBe(true);
      expect(result.slotResult.currentSlots).toBe(1);
    });
  });

  describe("withFairnessSlotOrThrow", () => {
    it("returns work result when slot acquired", async () => {
      const result = await withFairnessSlotOrThrow("run-123", async () => "success");

      expect(result).toBe("success");
    });

    it("throws FairnessSlotUnavailableError when slot not acquired", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 2,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      await expect(
        withFairnessSlotOrThrow("run-456", async () => "never")
      ).rejects.toThrow("Fairness slot unavailable for run run-456");
    });

    it("throws error with correct properties", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 3,
        maxAllowedSlots: 3,
        activeRunCount: 2,
        reason: "at_limit",
        retryDelayMs: 750,
      };

      try {
        await withFairnessSlotOrThrow("run-789", async () => {});
        expect.unreachable("Should have thrown");
      } catch (error) {
        expect(isFairnessSlotError(error)).toBe(true);
        if (error instanceof FairnessSlotUnavailableError) {
          expect(error.runId).toBe("run-789");
          expect(error.retryDelayMs).toBe(750);
          expect(error.slotResult.reason).toBe("at_limit");
        }
      }
    });

    it("releases slot after successful work", async () => {
      await withFairnessSlotOrThrow("run-123", async () => "done");

      expect(mockReleaseSlotCalled).toBe(true);
    });
  });

  describe("checkSlotAvailability", () => {
    it("returns available=true when under min slots", async () => {
      mockRunSlotCount = 0;
      mockIsRunRegistered = true;

      const result = await checkSlotAvailability("run-123");

      expect(result.available).toBe(true);
      expect(result.currentSlots).toBe(0);
      expect(result.registered).toBe(true);
    });

    it("returns available=false when at or above min slots", async () => {
      mockRunSlotCount = 1;
      mockIsRunRegistered = true;
      mockFairnessConfig.minSlotsPerRun = 1;

      const result = await checkSlotAvailability("run-123");

      expect(result.available).toBe(false);
      expect(result.currentSlots).toBe(1);
    });

    it("returns available=false when not registered", async () => {
      mockRunSlotCount = 0;
      mockIsRunRegistered = false;

      const result = await checkSlotAvailability("run-123");

      expect(result.available).toBe(false);
      expect(result.registered).toBe(false);
    });

    it("returns available=true when fairness disabled", async () => {
      mockFairnessConfig.enabled = false;

      const result = await checkSlotAvailability("run-123");

      expect(result.available).toBe(true);
      expect(result.registered).toBe(false);
      expect(result.config.enabled).toBe(false);
    });

    it("includes current config in result", async () => {
      mockFairnessConfig = {
        enabled: true,
        totalSlots: 10,
        minSlotsPerRun: 2,
        maxSlotsPerRun: 8,
        retryDelayMs: 1000,
        slotTtlSeconds: 600,
        debug: true,
      };

      const result = await checkSlotAvailability("run-123");

      expect(result.config.totalSlots).toBe(10);
      expect(result.config.minSlotsPerRun).toBe(2);
      expect(result.config.maxSlotsPerRun).toBe(8);
    });
  });

  describe("getCurrentFairnessConfig", () => {
    it("returns current config", () => {
      mockFairnessConfig = {
        enabled: true,
        totalSlots: 7,
        minSlotsPerRun: 1,
        maxSlotsPerRun: 4,
        retryDelayMs: 250,
        slotTtlSeconds: 300,
        debug: false,
      };

      const config = getCurrentFairnessConfig();

      expect(config.totalSlots).toBe(7);
      expect(config.maxSlotsPerRun).toBe(4);
    });
  });

  describe("SlotContext", () => {
    it("acquires slot on first call", async () => {
      const ctx = createSlotContext("run-123");

      const acquired = await ctx.acquire();

      expect(acquired).toBe(true);
      expect(ctx.isAcquired()).toBe(true);
    });

    it("returns true on duplicate acquire", async () => {
      const ctx = createSlotContext("run-123");

      await ctx.acquire();
      const secondAcquire = await ctx.acquire();

      expect(secondAcquire).toBe(true);
      expect(log.warn).toHaveBeenCalledWith(
        "scraper-worker",
        "Slot already acquired",
        expect.objectContaining({ runId: "run-123" })
      );
    });

    it("releases slot on release()", async () => {
      const ctx = createSlotContext("run-123");

      await ctx.acquire();
      await ctx.release();

      expect(mockReleaseSlotCalled).toBe(true);
      expect(ctx.isAcquired()).toBe(false);
    });

    it("does nothing on release() without acquire", async () => {
      const ctx = createSlotContext("run-123");

      await ctx.release();

      expect(mockReleaseSlotCalled).toBe(false);
    });

    it("stores last result", async () => {
      const ctx = createSlotContext("run-456");

      await ctx.acquire();
      const result = ctx.getLastResult();

      expect(result).toBeDefined();
      expect(result?.acquired).toBe(true);
      expect(result?.currentSlots).toBe(1);
    });

    it("getRunId() returns the run ID", () => {
      const ctx = createSlotContext("run-789");

      expect(ctx.getRunId()).toBe("run-789");
    });

    it("handles acquisition failure", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 1,
        reason: "at_limit",
        retryDelayMs: 500,
      };
      const ctx = createSlotContext("run-123");

      const acquired = await ctx.acquire();

      expect(acquired).toBe(false);
      expect(ctx.isAcquired()).toBe(false);
      expect(ctx.getLastResult()?.reason).toBe("at_limit");
    });

    it("works with options", async () => {
      const ctx = createSlotContext("run-123", { debug: true, requestId: "req-5" });

      await ctx.acquire();

      expect(log.debug).toHaveBeenCalledWith(
        "scraper-worker",
        "Fairness slot acquisition attempt",
        expect.objectContaining({
          runId: "run-123",
          requestId: "req-5",
        })
      );
    });
  });

  describe("Re-exports", () => {
    it("exports FairnessSlotUnavailableError", () => {
      expect(FairnessSlotUnavailableError).toBeDefined();
    });

    it("exports isFairnessSlotError", () => {
      expect(typeof isFairnessSlotError).toBe("function");
    });

    it("FairnessSlotUnavailableError can be instantiated", () => {
      const slotResult: FairnessSlotResult = {
        acquired: false,
        currentSlots: 3,
        maxAllowedSlots: 3,
        activeRunCount: 2,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      const error = new FairnessSlotUnavailableError("run-test", slotResult);

      expect(error.name).toBe("FairnessSlotUnavailableError");
      expect(error.runId).toBe("run-test");
      expect(error.retryDelayMs).toBe(500);
      expect(error.slotResult).toBe(slotResult);
    });
  });

  describe("Behavior parity with page-fetch.ts", () => {
    // These tests verify that the helper behavior matches what page-fetch.ts expects
    
    it("withFairnessSlotOrThrow matches page-fetch acquire/release pattern", async () => {
      // page-fetch.ts does:
      // 1. acquireSlot()
      // 2. if !acquired, throw FairnessSlotUnavailableError
      // 3. try { work } finally { releaseSlot }
      
      let workExecuted = false;
      
      await withFairnessSlotOrThrow("run-123", async () => {
        workExecuted = true;
      });

      expect(workExecuted).toBe(true);
      expect(mockReleaseSlotCalled).toBe(true);
    });

    it("throws same error type as page-fetch.ts", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 1,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      try {
        await withFairnessSlotOrThrow("run-123", async () => {});
        expect.unreachable("Should throw");
      } catch (error) {
        // page-fetch.ts checks: error instanceof FairnessSlotUnavailableError
        // or uses isFairnessSlotError()
        expect(isFairnessSlotError(error)).toBe(true);
        if (error instanceof FairnessSlotUnavailableError) {
          expect(error.retryDelayMs).toBe(500);
          expect(error.slotResult.currentSlots).toBe(5);
        }
      }
    });

    it("releases slot even on work failure (finally behavior)", async () => {
      try {
        await withFairnessSlotOrThrow("run-123", async () => {
          throw new Error("Fetch failed");
        });
      } catch {
        // Expected
      }

      // page-fetch.ts uses try/finally to ensure releaseSlot is called
      expect(mockReleaseSlotCalled).toBe(true);
    });

    it("does not call releaseSlot when slot not acquired", async () => {
      mockAcquireSlotResult = {
        acquired: false,
        currentSlots: 5,
        maxAllowedSlots: 5,
        activeRunCount: 1,
        reason: "at_limit",
        retryDelayMs: 500,
      };

      try {
        await withFairnessSlotOrThrow("run-123", async () => {});
      } catch {
        // Expected
      }

      // Should NOT release because slot was never acquired
      expect(mockReleaseSlotCalled).toBe(false);
    });
  });
});
