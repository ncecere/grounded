import { describe, it, expect, vi, mock } from "bun:test";
import {
  RetryOutcome,
  RetryOutcomeLog,
  RetryOutcomeLogConfig,
  RetryOutcomeStats,
  RetryResult,
  RetryAttemptDetail,
  IngestionStage,
  STAGE_MAX_RETRIES,
  getDefaultRetryOutcomeLogConfig,
  classifyRetryOutcome,
  createRetryOutcomeLog,
  shouldLogRetryOutcome,
  formatRetryOutcomeLog,
  createStructuredRetryLog,
  isMaxRetriesReached,
  getRemainingRetries,
  executeWithRetryLogging,
  summarizeRetryOutcomes,
  getMaxRetriesForStage,
} from "./index";

// ============================================================================
// RetryOutcome Enum Tests
// ============================================================================

describe("RetryOutcome enum", () => {
  it("should define all expected outcome types", () => {
    expect(RetryOutcome.SUCCESS_NO_RETRY).toBe("success_no_retry");
    expect(RetryOutcome.SUCCESS_AFTER_RETRY).toBe("success_after_retry");
    expect(RetryOutcome.FAILURE_NON_RETRYABLE).toBe("failure_non_retryable");
    expect(RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED).toBe("failure_max_retries_exhausted");
    expect(RetryOutcome.SKIPPED).toBe("skipped");
  });

  it("should have 5 distinct outcome types", () => {
    const outcomes = Object.values(RetryOutcome);
    expect(outcomes.length).toBe(5);
    expect(new Set(outcomes).size).toBe(5);
  });
});

// ============================================================================
// getDefaultRetryOutcomeLogConfig Tests
// ============================================================================

describe("getDefaultRetryOutcomeLogConfig", () => {
  it("should return default configuration", () => {
    const config = getDefaultRetryOutcomeLogConfig();

    expect(config.includeAttemptDetails).toBe(true);
    expect(config.logSuccesses).toBe(true);
    expect(config.minAttemptsToLogSuccess).toBe(1);
  });

  it("should return a new object each time", () => {
    const config1 = getDefaultRetryOutcomeLogConfig();
    const config2 = getDefaultRetryOutcomeLogConfig();

    expect(config1).not.toBe(config2);
    expect(config1).toEqual(config2);
  });
});

// ============================================================================
// classifyRetryOutcome Tests
// ============================================================================

describe("classifyRetryOutcome", () => {
  const createMockResult = (
    success: boolean,
    attempts: number,
    error?: unknown
  ): RetryResult<string> => ({
    success,
    value: success ? "result" : undefined,
    error,
    attempts,
    totalWaitTimeMs: (attempts - 1) * 1000,
    attemptDetails: Array.from({ length: attempts }, (_, i) => ({
      attempt: i + 1,
      succeeded: i === attempts - 1 && success,
      delayBeforeMs: i * 1000,
      startedAt: new Date().toISOString(),
      durationMs: 100,
      error: i < attempts - 1 || !success ? new Error("test error") : undefined,
    })),
  });

  it("should classify success on first attempt", () => {
    const result = createMockResult(true, 1);
    expect(classifyRetryOutcome(result)).toBe(RetryOutcome.SUCCESS_NO_RETRY);
  });

  it("should classify success after retries", () => {
    const result = createMockResult(true, 3);
    expect(classifyRetryOutcome(result)).toBe(RetryOutcome.SUCCESS_AFTER_RETRY);
  });

  it("should classify failure due to non-retryable error", () => {
    const result = createMockResult(false, 1, new Error("permission denied"));
    const isRetryable = () => false;

    expect(classifyRetryOutcome(result, isRetryable)).toBe(
      RetryOutcome.FAILURE_NON_RETRYABLE
    );
  });

  it("should classify failure after max retries exhausted", () => {
    const result = createMockResult(false, 3, new Error("service unavailable"));
    const isRetryable = () => true;

    expect(classifyRetryOutcome(result, isRetryable)).toBe(
      RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED
    );
  });

  it("should default to max retries exhausted when no isRetryable function provided", () => {
    const result = createMockResult(false, 3, new Error("some error"));

    expect(classifyRetryOutcome(result)).toBe(
      RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED
    );
  });

  it("should handle failure with no error object", () => {
    const result: RetryResult<string> = {
      success: false,
      attempts: 2,
      totalWaitTimeMs: 1000,
      attemptDetails: [],
    };

    expect(classifyRetryOutcome(result)).toBe(
      RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED
    );
  });
});

// ============================================================================
// createRetryOutcomeLog Tests
// ============================================================================

describe("createRetryOutcomeLog", () => {
  const createMockResult = (
    success: boolean,
    attempts: number
  ): RetryResult<string> => ({
    success,
    value: success ? "result" : undefined,
    error: success ? undefined : new Error("test error"),
    attempts,
    totalWaitTimeMs: (attempts - 1) * 1000,
    attemptDetails: Array.from({ length: attempts }, (_, i) => ({
      attempt: i + 1,
      succeeded: i === attempts - 1 && success,
      delayBeforeMs: i * 1000,
      startedAt: new Date().toISOString(),
      durationMs: 100,
    })),
  });

  it("should create log with required fields", () => {
    const result = createMockResult(true, 1);
    const log = createRetryOutcomeLog(IngestionStage.FETCH, result, 3);

    expect(log.stage).toBe(IngestionStage.FETCH);
    expect(log.outcome).toBe(RetryOutcome.SUCCESS_NO_RETRY);
    expect(log.totalAttempts).toBe(1);
    expect(log.maxAttempts).toBe(3);
    expect(log.timestamp).toBeDefined();
    expect(log.totalWaitTimeMs).toBe(0);
    expect(log.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("should include context fields when provided", () => {
    const result = createMockResult(true, 2);
    const log = createRetryOutcomeLog(IngestionStage.EMBED, result, 3, {
      resourceId: "chunk-123",
      tenantId: "tenant-456",
      runId: "run-789",
    });

    expect(log.resourceId).toBe("chunk-123");
    expect(log.tenantId).toBe("tenant-456");
    expect(log.runId).toBe("run-789");
  });

  it("should include error info for failures", () => {
    const result = createMockResult(false, 3);
    const errorInfo = {
      code: "SERVICE_RATE_LIMITED",
      category: "service",
      message: "Rate limit exceeded",
      retryable: true,
    };

    const log = createRetryOutcomeLog(
      IngestionStage.FETCH,
      result,
      3,
      {},
      errorInfo
    );

    expect(log.error).toEqual(errorInfo);
    expect(log.outcome).toBe(RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED);
  });

  it("should include attempt details by default", () => {
    const result = createMockResult(true, 2);
    const log = createRetryOutcomeLog(IngestionStage.FETCH, result, 3);

    expect(log.attemptSummary).toBeDefined();
    expect(log.attemptSummary?.length).toBe(2);
    expect(log.attemptSummary?.[0].attempt).toBe(1);
    expect(log.attemptSummary?.[1].attempt).toBe(2);
  });

  it("should exclude attempt details when configured", () => {
    const result = createMockResult(true, 2);
    const log = createRetryOutcomeLog(
      IngestionStage.FETCH,
      result,
      3,
      {},
      undefined,
      { includeAttemptDetails: false }
    );

    expect(log.attemptSummary).toBeUndefined();
  });

  it("should calculate correct execution time with start time", () => {
    const startTime = Date.now() - 500; // 500ms ago
    const result = createMockResult(true, 1);
    const log = createRetryOutcomeLog(
      IngestionStage.FETCH,
      result,
      3,
      { executionStartTime: startTime }
    );

    expect(log.totalExecutionTimeMs).toBeGreaterThanOrEqual(500);
    expect(log.totalExecutionTimeMs).toBeLessThan(600);
  });

  it("should handle all ingestion stages", () => {
    const stages: IngestionStage[] = [
      IngestionStage.DISCOVER,
      IngestionStage.FETCH,
      IngestionStage.EXTRACT,
      IngestionStage.CHUNK,
      IngestionStage.EMBED,
      IngestionStage.INDEX,
    ];

    for (const stage of stages) {
      const result = createMockResult(true, 1);
      const log = createRetryOutcomeLog(stage, result, 3);
      expect(log.stage).toBe(stage);
    }
  });
});

// ============================================================================
// shouldLogRetryOutcome Tests
// ============================================================================

describe("shouldLogRetryOutcome", () => {
  it("should always log failures - non-retryable", () => {
    const log: RetryOutcomeLog = {
      timestamp: new Date().toISOString(),
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.FAILURE_NON_RETRYABLE,
      totalAttempts: 1,
      maxAttempts: 3,
      totalWaitTimeMs: 0,
      totalExecutionTimeMs: 100,
    };

    expect(shouldLogRetryOutcome(log, { logSuccesses: false })).toBe(true);
  });

  it("should always log failures - max retries exhausted", () => {
    const log: RetryOutcomeLog = {
      timestamp: new Date().toISOString(),
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED,
      totalAttempts: 3,
      maxAttempts: 3,
      totalWaitTimeMs: 2000,
      totalExecutionTimeMs: 2500,
    };

    expect(shouldLogRetryOutcome(log, { logSuccesses: false })).toBe(true);
  });

  it("should log successes when configured", () => {
    const log: RetryOutcomeLog = {
      timestamp: new Date().toISOString(),
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.SUCCESS_NO_RETRY,
      totalAttempts: 1,
      maxAttempts: 3,
      totalWaitTimeMs: 0,
      totalExecutionTimeMs: 100,
    };

    expect(shouldLogRetryOutcome(log, { logSuccesses: true })).toBe(true);
    expect(shouldLogRetryOutcome(log, { logSuccesses: false })).toBe(false);
  });

  it("should respect minimum attempts threshold for success logging", () => {
    const log: RetryOutcomeLog = {
      timestamp: new Date().toISOString(),
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.SUCCESS_NO_RETRY,
      totalAttempts: 1,
      maxAttempts: 3,
      totalWaitTimeMs: 0,
      totalExecutionTimeMs: 100,
    };

    expect(
      shouldLogRetryOutcome(log, {
        logSuccesses: true,
        minAttemptsToLogSuccess: 2,
      })
    ).toBe(false);

    log.totalAttempts = 2;
    log.outcome = RetryOutcome.SUCCESS_AFTER_RETRY;
    expect(
      shouldLogRetryOutcome(log, {
        logSuccesses: true,
        minAttemptsToLogSuccess: 2,
      })
    ).toBe(true);
  });
});

// ============================================================================
// formatRetryOutcomeLog Tests
// ============================================================================

describe("formatRetryOutcomeLog", () => {
  it("should format basic log entry", () => {
    const log: RetryOutcomeLog = {
      timestamp: "2026-01-18T12:00:00.000Z",
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.SUCCESS_NO_RETRY,
      totalAttempts: 1,
      maxAttempts: 3,
      totalWaitTimeMs: 0,
      totalExecutionTimeMs: 100,
    };

    const formatted = formatRetryOutcomeLog(log);

    expect(formatted).toContain("[FETCH]");
    expect(formatted).toContain("success_no_retry");
    expect(formatted).toContain("attempts=1/3");
    expect(formatted).toContain("waitTime=0ms");
    expect(formatted).toContain("totalTime=100ms");
  });

  it("should include resource ID when present", () => {
    const log: RetryOutcomeLog = {
      timestamp: "2026-01-18T12:00:00.000Z",
      stage: IngestionStage.EMBED,
      outcome: RetryOutcome.SUCCESS_AFTER_RETRY,
      totalAttempts: 2,
      maxAttempts: 3,
      totalWaitTimeMs: 1000,
      totalExecutionTimeMs: 1200,
      resourceId: "chunk-abc-123",
    };

    const formatted = formatRetryOutcomeLog(log);
    expect(formatted).toContain("resource=chunk-abc-123");
  });

  it("should include error information when present", () => {
    const log: RetryOutcomeLog = {
      timestamp: "2026-01-18T12:00:00.000Z",
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED,
      totalAttempts: 3,
      maxAttempts: 3,
      totalWaitTimeMs: 2000,
      totalExecutionTimeMs: 2500,
      error: {
        code: "SERVICE_RATE_LIMITED",
        category: "service",
        message: "Rate limit exceeded",
        retryable: true,
      },
    };

    const formatted = formatRetryOutcomeLog(log);
    expect(formatted).toContain("error=SERVICE_RATE_LIMITED");
    expect(formatted).toContain('message="Rate limit exceeded"');
  });
});

// ============================================================================
// createStructuredRetryLog Tests
// ============================================================================

describe("createStructuredRetryLog", () => {
  it("should create structured log object", () => {
    const log: RetryOutcomeLog = {
      timestamp: "2026-01-18T12:00:00.000Z",
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED,
      totalAttempts: 3,
      maxAttempts: 3,
      totalWaitTimeMs: 2000,
      totalExecutionTimeMs: 2500,
      error: {
        code: "NETWORK_TIMEOUT",
        category: "network",
        message: "Connection timed out",
        retryable: true,
      },
    };

    const structured = createStructuredRetryLog(log);

    expect(structured.event).toBe("retry_outcome");
    expect(structured.stage).toBe(IngestionStage.FETCH);
    expect(structured.outcome).toBe(RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED);
    expect(structured.errorCode).toBe("NETWORK_TIMEOUT");
    expect(structured.errorCategory).toBe("network");
    expect(structured.errorMessage).toBe("Connection timed out");
    expect(structured.errorRetryable).toBe(true);
  });

  it("should handle logs without error", () => {
    const log: RetryOutcomeLog = {
      timestamp: "2026-01-18T12:00:00.000Z",
      stage: IngestionStage.FETCH,
      outcome: RetryOutcome.SUCCESS_NO_RETRY,
      totalAttempts: 1,
      maxAttempts: 3,
      totalWaitTimeMs: 0,
      totalExecutionTimeMs: 100,
    };

    const structured = createStructuredRetryLog(log);

    expect(structured.errorCode).toBeUndefined();
    expect(structured.errorCategory).toBeUndefined();
    expect(structured.errorMessage).toBeUndefined();
    expect(structured.errorRetryable).toBeUndefined();
  });
});

// ============================================================================
// isMaxRetriesReached Tests
// ============================================================================

describe("isMaxRetriesReached", () => {
  it("should return true when max retries reached for each stage", () => {
    // STAGE_MAX_RETRIES values:
    // discover: 2, fetch: 3, extract: 2, chunk: 1, embed: 3, index: 3

    expect(isMaxRetriesReached(IngestionStage.DISCOVER, 2)).toBe(true);
    expect(isMaxRetriesReached(IngestionStage.FETCH, 3)).toBe(true);
    expect(isMaxRetriesReached(IngestionStage.EXTRACT, 2)).toBe(true);
    expect(isMaxRetriesReached(IngestionStage.CHUNK, 1)).toBe(true);
    expect(isMaxRetriesReached(IngestionStage.EMBED, 3)).toBe(true);
    expect(isMaxRetriesReached(IngestionStage.INDEX, 3)).toBe(true);
  });

  it("should return false when retries not exhausted", () => {
    expect(isMaxRetriesReached(IngestionStage.DISCOVER, 1)).toBe(false);
    expect(isMaxRetriesReached(IngestionStage.FETCH, 2)).toBe(false);
    expect(isMaxRetriesReached(IngestionStage.EXTRACT, 1)).toBe(false);
    expect(isMaxRetriesReached(IngestionStage.EMBED, 2)).toBe(false);
  });

  it("should return true when exceeding max retries", () => {
    expect(isMaxRetriesReached(IngestionStage.DISCOVER, 5)).toBe(true);
    expect(isMaxRetriesReached(IngestionStage.FETCH, 10)).toBe(true);
  });
});

// ============================================================================
// getRemainingRetries Tests
// ============================================================================

describe("getRemainingRetries", () => {
  it("should return correct remaining retries for each stage", () => {
    // STAGE_MAX_RETRIES values:
    // discover: 2, fetch: 3, extract: 2, chunk: 1, embed: 3, index: 3

    expect(getRemainingRetries(IngestionStage.DISCOVER, 1)).toBe(1);
    expect(getRemainingRetries(IngestionStage.FETCH, 1)).toBe(2);
    expect(getRemainingRetries(IngestionStage.EXTRACT, 1)).toBe(1);
    expect(getRemainingRetries(IngestionStage.CHUNK, 1)).toBe(0);
    expect(getRemainingRetries(IngestionStage.EMBED, 1)).toBe(2);
    expect(getRemainingRetries(IngestionStage.INDEX, 2)).toBe(1);
  });

  it("should return 0 when all retries exhausted", () => {
    expect(getRemainingRetries(IngestionStage.DISCOVER, 2)).toBe(0);
    expect(getRemainingRetries(IngestionStage.FETCH, 3)).toBe(0);
  });

  it("should return 0 when exceeding max retries", () => {
    expect(getRemainingRetries(IngestionStage.DISCOVER, 10)).toBe(0);
    expect(getRemainingRetries(IngestionStage.FETCH, 100)).toBe(0);
  });
});

// ============================================================================
// STAGE_MAX_RETRIES Tests
// ============================================================================

describe("STAGE_MAX_RETRIES", () => {
  it("should have retry limits for all stages", () => {
    expect(STAGE_MAX_RETRIES.discover).toBe(2);
    expect(STAGE_MAX_RETRIES.fetch).toBe(3);
    expect(STAGE_MAX_RETRIES.extract).toBe(2);
    expect(STAGE_MAX_RETRIES.chunk).toBe(1);
    expect(STAGE_MAX_RETRIES.embed).toBe(3);
    expect(STAGE_MAX_RETRIES.index).toBe(3);
  });

  it("should be consistent with getMaxRetriesForStage", () => {
    expect(getMaxRetriesForStage(IngestionStage.DISCOVER)).toBe(
      STAGE_MAX_RETRIES.discover
    );
    expect(getMaxRetriesForStage(IngestionStage.FETCH)).toBe(
      STAGE_MAX_RETRIES.fetch
    );
    expect(getMaxRetriesForStage(IngestionStage.EXTRACT)).toBe(
      STAGE_MAX_RETRIES.extract
    );
    expect(getMaxRetriesForStage(IngestionStage.CHUNK)).toBe(
      STAGE_MAX_RETRIES.chunk
    );
    expect(getMaxRetriesForStage(IngestionStage.EMBED)).toBe(
      STAGE_MAX_RETRIES.embed
    );
    expect(getMaxRetriesForStage(IngestionStage.INDEX)).toBe(
      STAGE_MAX_RETRIES.index
    );
  });
});

// ============================================================================
// executeWithRetryLogging Tests
// ============================================================================

describe("executeWithRetryLogging", () => {
  it("should execute function and return success result", async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return Promise.resolve("success");
    };
    const logs: RetryOutcomeLog[] = [];
    const logger = (log: RetryOutcomeLog) => logs.push(log);

    const result = await executeWithRetryLogging(
      fn,
      IngestionStage.FETCH,
      { resourceId: "test-url" },
      // Use minimal backoff to speed up test
      { backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 } },
      undefined,
      logger
    );

    expect(result.success).toBe(true);
    expect(result.value).toBe("success");
    expect(callCount).toBe(1);
    expect(logs.length).toBe(1);

    expect(logs[0].outcome).toBe(RetryOutcome.SUCCESS_NO_RETRY);
    expect(logs[0].resourceId).toBe("test-url");
  });

  it("should retry on failure and eventually succeed", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) {
        return Promise.reject(new Error("temporary failure"));
      }
      return Promise.resolve("success");
    };
    const logs: RetryOutcomeLog[] = [];
    const logger = (log: RetryOutcomeLog) => logs.push(log);

    const result = await executeWithRetryLogging(
      fn,
      IngestionStage.FETCH,
      { resourceId: "test-url" },
      // Use minimal backoff to speed up test
      {
        maxAttempts: 3,
        backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 },
      },
      undefined,
      logger
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(logs.length).toBe(1);

    expect(logs[0].outcome).toBe(RetryOutcome.SUCCESS_AFTER_RETRY);
    expect(logs[0].totalAttempts).toBe(2);
  });

  it("should fail after max retries exhausted", async () => {
    const fn = () => Promise.reject(new Error("persistent failure"));
    const logs: RetryOutcomeLog[] = [];
    const logger = (log: RetryOutcomeLog) => logs.push(log);

    const result = await executeWithRetryLogging(
      fn,
      IngestionStage.FETCH,
      { resourceId: "test-url" },
      // Use minimal backoff to speed up test
      {
        maxAttempts: 2,
        backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 },
      },
      undefined,
      logger
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(logs.length).toBe(1);

    expect(logs[0].outcome).toBe(RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED);
    expect(logs[0].error).toBeDefined();
    expect(logs[0].error?.message).toBe("persistent failure");
  });

  it("should not retry non-retryable errors", async () => {
    let callCount = 0;
    const nonRetryableError = { code: "CONTENT_TOO_LARGE", message: "File too large" };
    const fn = () => {
      callCount++;
      return Promise.reject(nonRetryableError);
    };
    const logs: RetryOutcomeLog[] = [];
    const logger = (log: RetryOutcomeLog) => logs.push(log);

    const result = await executeWithRetryLogging(
      fn,
      IngestionStage.FETCH,
      { resourceId: "test-url" },
      {
        maxAttempts: 3,
        isRetryable: () => false,
        backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 },
      },
      undefined,
      logger
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);

    expect(logs[0].outcome).toBe(RetryOutcome.FAILURE_NON_RETRYABLE);
  });

  it("should include context in logs", async () => {
    const fn = () => Promise.resolve("success");
    const logs: RetryOutcomeLog[] = [];
    const logger = (log: RetryOutcomeLog) => logs.push(log);

    await executeWithRetryLogging(
      fn,
      IngestionStage.EMBED,
      {
        resourceId: "chunk-123",
        tenantId: "tenant-456",
        runId: "run-789",
      },
      { backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 } },
      undefined,
      logger
    );

    expect(logs[0].resourceId).toBe("chunk-123");
    expect(logs[0].tenantId).toBe("tenant-456");
    expect(logs[0].runId).toBe("run-789");
    expect(logs[0].stage).toBe(IngestionStage.EMBED);
  });
});

// ============================================================================
// summarizeRetryOutcomes Tests
// ============================================================================

describe("summarizeRetryOutcomes", () => {
  it("should return empty summary for no logs", () => {
    const summary = summarizeRetryOutcomes([]);

    expect(summary.total).toBe(0);
    expect(summary.avgAttempts).toBe(0);
    expect(summary.avgWaitTimeMs).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.totalRetries).toBe(0);
  });

  it("should calculate correct stats for mixed outcomes", () => {
    const logs: RetryOutcomeLog[] = [
      {
        timestamp: "2026-01-18T12:00:00.000Z",
        stage: IngestionStage.FETCH,
        outcome: RetryOutcome.SUCCESS_NO_RETRY,
        totalAttempts: 1,
        maxAttempts: 3,
        totalWaitTimeMs: 0,
        totalExecutionTimeMs: 100,
      },
      {
        timestamp: "2026-01-18T12:00:01.000Z",
        stage: IngestionStage.FETCH,
        outcome: RetryOutcome.SUCCESS_AFTER_RETRY,
        totalAttempts: 2,
        maxAttempts: 3,
        totalWaitTimeMs: 1000,
        totalExecutionTimeMs: 1200,
      },
      {
        timestamp: "2026-01-18T12:00:02.000Z",
        stage: IngestionStage.EMBED,
        outcome: RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED,
        totalAttempts: 3,
        maxAttempts: 3,
        totalWaitTimeMs: 2000,
        totalExecutionTimeMs: 2500,
      },
    ];

    const summary = summarizeRetryOutcomes(logs);

    expect(summary.total).toBe(3);
    expect(summary.byOutcome[RetryOutcome.SUCCESS_NO_RETRY]).toBe(1);
    expect(summary.byOutcome[RetryOutcome.SUCCESS_AFTER_RETRY]).toBe(1);
    expect(summary.byOutcome[RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED]).toBe(1);
    expect(summary.byStage[IngestionStage.FETCH].total).toBe(2);
    expect(summary.byStage[IngestionStage.FETCH].succeeded).toBe(2);
    expect(summary.byStage[IngestionStage.FETCH].failed).toBe(0);
    expect(summary.byStage[IngestionStage.EMBED].total).toBe(1);
    expect(summary.byStage[IngestionStage.EMBED].failed).toBe(1);
    expect(summary.avgAttempts).toBe(2); // (1 + 2 + 3) / 3 = 2
    expect(summary.avgWaitTimeMs).toBe(1000); // (0 + 1000 + 2000) / 3 = 1000
    expect(summary.successRate).toBeCloseTo(0.666, 2); // 2 successes / 3 total
    expect(summary.totalRetries).toBe(3); // (0 + 1 + 2) retries
  });

  it("should handle all success outcomes", () => {
    const logs: RetryOutcomeLog[] = [
      {
        timestamp: "2026-01-18T12:00:00.000Z",
        stage: IngestionStage.FETCH,
        outcome: RetryOutcome.SUCCESS_NO_RETRY,
        totalAttempts: 1,
        maxAttempts: 3,
        totalWaitTimeMs: 0,
        totalExecutionTimeMs: 100,
      },
      {
        timestamp: "2026-01-18T12:00:01.000Z",
        stage: IngestionStage.FETCH,
        outcome: RetryOutcome.SUCCESS_NO_RETRY,
        totalAttempts: 1,
        maxAttempts: 3,
        totalWaitTimeMs: 0,
        totalExecutionTimeMs: 100,
      },
    ];

    const summary = summarizeRetryOutcomes(logs);

    expect(summary.successRate).toBe(1);
    expect(summary.totalRetries).toBe(0);
  });

  it("should handle all failure outcomes", () => {
    const logs: RetryOutcomeLog[] = [
      {
        timestamp: "2026-01-18T12:00:00.000Z",
        stage: IngestionStage.FETCH,
        outcome: RetryOutcome.FAILURE_NON_RETRYABLE,
        totalAttempts: 1,
        maxAttempts: 3,
        totalWaitTimeMs: 0,
        totalExecutionTimeMs: 100,
      },
      {
        timestamp: "2026-01-18T12:00:01.000Z",
        stage: IngestionStage.EMBED,
        outcome: RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED,
        totalAttempts: 3,
        maxAttempts: 3,
        totalWaitTimeMs: 2000,
        totalExecutionTimeMs: 2500,
      },
    ];

    const summary = summarizeRetryOutcomes(logs);

    expect(summary.successRate).toBe(0);
    expect(summary.byStage[IngestionStage.FETCH].failed).toBe(1);
    expect(summary.byStage[IngestionStage.EMBED].failed).toBe(1);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Retry Outcome Logging Integration", () => {
  it("should enforce stage-specific retry limits", () => {
    // Verify that each stage has appropriate retry limits
    const stages: IngestionStage[] = [
      IngestionStage.DISCOVER,
      IngestionStage.FETCH,
      IngestionStage.EXTRACT,
      IngestionStage.CHUNK,
      IngestionStage.EMBED,
      IngestionStage.INDEX,
    ];

    for (const stage of stages) {
      const maxRetries = getMaxRetriesForStage(stage);
      expect(maxRetries).toBeGreaterThan(0);
      expect(maxRetries).toBeLessThanOrEqual(5);

      // Verify isMaxRetriesReached works correctly
      // At maxRetries attempts, we've reached the limit
      expect(isMaxRetriesReached(stage, maxRetries)).toBe(true);
      // At maxRetries - 1 attempts, we haven't reached the limit (unless maxRetries is 1)
      if (maxRetries > 1) {
        expect(isMaxRetriesReached(stage, maxRetries - 1)).toBe(false);
      }

      // Verify getRemainingRetries works correctly
      expect(getRemainingRetries(stage, 1)).toBe(maxRetries - 1);
      expect(getRemainingRetries(stage, maxRetries)).toBe(0);
    }
  });

  it("should create complete outcome log with all information", () => {
    const result: RetryResult<string> = {
      success: false,
      error: new Error("Service temporarily unavailable"),
      attempts: 3,
      totalWaitTimeMs: 3000,
      attemptDetails: [
        { attempt: 1, succeeded: false, delayBeforeMs: 0, startedAt: "2026-01-18T12:00:00.000Z", durationMs: 100 },
        { attempt: 2, succeeded: false, delayBeforeMs: 1000, startedAt: "2026-01-18T12:00:01.100Z", durationMs: 100 },
        { attempt: 3, succeeded: false, delayBeforeMs: 2000, startedAt: "2026-01-18T12:00:03.200Z", durationMs: 100 },
      ],
    };

    const errorInfo = {
      code: "SERVICE_UNAVAILABLE",
      category: "service",
      message: "Service temporarily unavailable",
      retryable: true,
    };

    const log = createRetryOutcomeLog(
      IngestionStage.FETCH,
      result,
      3,
      {
        resourceId: "https://example.com/page",
        tenantId: "tenant-123",
        runId: "run-456",
      },
      errorInfo
    );

    // Verify all fields are populated
    expect(log.timestamp).toBeDefined();
    expect(log.stage).toBe(IngestionStage.FETCH);
    expect(log.outcome).toBe(RetryOutcome.FAILURE_MAX_RETRIES_EXHAUSTED);
    expect(log.totalAttempts).toBe(3);
    expect(log.maxAttempts).toBe(3);
    expect(log.totalWaitTimeMs).toBe(3000);
    expect(log.resourceId).toBe("https://example.com/page");
    expect(log.tenantId).toBe("tenant-123");
    expect(log.runId).toBe("run-456");
    expect(log.error).toEqual(errorInfo);
    expect(log.attemptSummary?.length).toBe(3);

    // Verify structured log format
    const structured = createStructuredRetryLog(log);
    expect(structured.event).toBe("retry_outcome");
    expect(structured.errorCode).toBe("SERVICE_UNAVAILABLE");

    // Verify human-readable format
    const formatted = formatRetryOutcomeLog(log);
    expect(formatted).toContain("[FETCH]");
    expect(formatted).toContain("failure_max_retries_exhausted");
    expect(formatted).toContain("attempts=3/3");
  });
});
