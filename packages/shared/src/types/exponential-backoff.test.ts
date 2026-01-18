/**
 * Tests for exponential backoff with jitter functionality.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  // Types
  type BackoffConfig,
  type RetryOptions,
  type RetryResult,
  type RetryAttemptDetail,
  type BackoffDelayInfo,
  // Functions
  getDefaultBackoffConfig,
  getDefaultRetryOptions,
  resolveBackoffConfig,
  getBackoffConfigForStage,
  getMaxRetriesForStage,
  getRetryOptionsForStage,
  calculateJitter,
  calculateBackoffDelay,
  generateBackoffSchedule,
  calculateMaxTotalWaitTime,
  sleepMs,
  executeWithBackoff,
  createRetryFunction,
  createStageRetryFunction,
  // Constants
  DEFAULT_BACKOFF_BASE_DELAY_MS,
  DEFAULT_BACKOFF_MAX_DELAY_MS,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_BACKOFF_JITTER_RATIO,
  DEFAULT_MAX_RETRY_ATTEMPTS,
  BACKOFF_ENV_VARS,
  STAGE_BACKOFF_CONFIG,
  IngestionStage,
} from "./index";
import { STAGE_MAX_RETRIES } from "../constants";

describe("Exponential Backoff Constants", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_BACKOFF_BASE_DELAY_MS).toBe(1000);
    expect(DEFAULT_BACKOFF_MAX_DELAY_MS).toBe(60000);
    expect(DEFAULT_BACKOFF_MULTIPLIER).toBe(2);
    expect(DEFAULT_BACKOFF_JITTER_RATIO).toBe(0.3);
    expect(DEFAULT_MAX_RETRY_ATTEMPTS).toBe(3);
  });

  it("should have environment variable names defined", () => {
    expect(BACKOFF_ENV_VARS.BASE_DELAY_MS).toBe("BACKOFF_BASE_DELAY_MS");
    expect(BACKOFF_ENV_VARS.MAX_DELAY_MS).toBe("BACKOFF_MAX_DELAY_MS");
    expect(BACKOFF_ENV_VARS.MULTIPLIER).toBe("BACKOFF_MULTIPLIER");
    expect(BACKOFF_ENV_VARS.JITTER_RATIO).toBe("BACKOFF_JITTER_RATIO");
    expect(BACKOFF_ENV_VARS.MAX_ATTEMPTS).toBe("BACKOFF_MAX_ATTEMPTS");
  });

  it("should have stage-specific backoff configs for all stages", () => {
    const stages: (keyof typeof STAGE_BACKOFF_CONFIG)[] = ["discover", "fetch", "extract", "chunk", "embed", "index"];
    for (const stage of stages) {
      expect(STAGE_BACKOFF_CONFIG[stage]).toBeDefined();
      expect(STAGE_BACKOFF_CONFIG[stage].baseDelayMs).toBeGreaterThan(0);
      expect(STAGE_BACKOFF_CONFIG[stage].maxDelayMs).toBeGreaterThan(0);
      expect(STAGE_BACKOFF_CONFIG[stage].multiplier).toBeGreaterThanOrEqual(1);
      expect(STAGE_BACKOFF_CONFIG[stage].jitterRatio).toBeGreaterThanOrEqual(0);
      expect(STAGE_BACKOFF_CONFIG[stage].jitterRatio).toBeLessThanOrEqual(1);
    }
  });

  it("should have fetch stage with highest base delay for rate limiting", () => {
    expect(STAGE_BACKOFF_CONFIG.fetch.baseDelayMs).toBeGreaterThanOrEqual(
      STAGE_BACKOFF_CONFIG.extract.baseDelayMs
    );
  });

  it("should have embed stage with high jitter ratio for API calls", () => {
    expect(STAGE_BACKOFF_CONFIG.embed.jitterRatio).toBeGreaterThanOrEqual(0.3);
  });
});

describe("getDefaultBackoffConfig", () => {
  it("should return correct default configuration", () => {
    const config = getDefaultBackoffConfig();
    expect(config).toEqual({
      baseDelayMs: DEFAULT_BACKOFF_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_BACKOFF_MAX_DELAY_MS,
      multiplier: DEFAULT_BACKOFF_MULTIPLIER,
      jitterRatio: DEFAULT_BACKOFF_JITTER_RATIO,
    });
  });

  it("should return a new object each time", () => {
    const config1 = getDefaultBackoffConfig();
    const config2 = getDefaultBackoffConfig();
    expect(config1).not.toBe(config2);
  });
});

describe("getDefaultRetryOptions", () => {
  it("should return correct default options", () => {
    const options = getDefaultRetryOptions();
    expect(options.maxAttempts).toBe(DEFAULT_MAX_RETRY_ATTEMPTS);
    expect(options.backoff).toEqual(getDefaultBackoffConfig());
  });
});

describe("resolveBackoffConfig", () => {
  it("should return defaults when no env vars set", () => {
    const config = resolveBackoffConfig(() => undefined);
    expect(config).toEqual(getDefaultBackoffConfig());
  });

  it("should override baseDelayMs from env var", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.BASE_DELAY_MS ? "2000" : undefined
    );
    expect(config.baseDelayMs).toBe(2000);
    expect(config.maxDelayMs).toBe(DEFAULT_BACKOFF_MAX_DELAY_MS);
  });

  it("should override maxDelayMs from env var", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.MAX_DELAY_MS ? "120000" : undefined
    );
    expect(config.maxDelayMs).toBe(120000);
  });

  it("should override multiplier from env var", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.MULTIPLIER ? "3" : undefined
    );
    expect(config.multiplier).toBe(3);
  });

  it("should override jitterRatio from env var", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.JITTER_RATIO ? "0.5" : undefined
    );
    expect(config.jitterRatio).toBe(0.5);
  });

  it("should ignore invalid baseDelayMs values", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.BASE_DELAY_MS ? "invalid" : undefined
    );
    expect(config.baseDelayMs).toBe(DEFAULT_BACKOFF_BASE_DELAY_MS);
  });

  it("should ignore negative baseDelayMs values", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.BASE_DELAY_MS ? "-1000" : undefined
    );
    expect(config.baseDelayMs).toBe(DEFAULT_BACKOFF_BASE_DELAY_MS);
  });

  it("should ignore out-of-range jitterRatio values", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.JITTER_RATIO ? "1.5" : undefined
    );
    expect(config.jitterRatio).toBe(DEFAULT_BACKOFF_JITTER_RATIO);
  });

  it("should ignore out-of-range multiplier values", () => {
    const config = resolveBackoffConfig((key) =>
      key === BACKOFF_ENV_VARS.MULTIPLIER ? "0.5" : undefined
    );
    expect(config.multiplier).toBe(DEFAULT_BACKOFF_MULTIPLIER);
  });
});

describe("getBackoffConfigForStage", () => {
  it("should return config for discover stage", () => {
    const config = getBackoffConfigForStage(IngestionStage.DISCOVER);
    expect(config).toEqual({
      baseDelayMs: STAGE_BACKOFF_CONFIG.discover.baseDelayMs,
      maxDelayMs: STAGE_BACKOFF_CONFIG.discover.maxDelayMs,
      multiplier: STAGE_BACKOFF_CONFIG.discover.multiplier,
      jitterRatio: STAGE_BACKOFF_CONFIG.discover.jitterRatio,
    });
  });

  it("should return config for fetch stage", () => {
    const config = getBackoffConfigForStage(IngestionStage.FETCH);
    expect(config.baseDelayMs).toBe(5000);
    expect(config.maxDelayMs).toBe(60000);
  });

  it("should return config for embed stage", () => {
    const config = getBackoffConfigForStage(IngestionStage.EMBED);
    expect(config.baseDelayMs).toBe(3000);
  });

  it("should return different configs for different stages", () => {
    const fetchConfig = getBackoffConfigForStage(IngestionStage.FETCH);
    const chunkConfig = getBackoffConfigForStage(IngestionStage.CHUNK);
    expect(fetchConfig.baseDelayMs).not.toBe(chunkConfig.baseDelayMs);
  });
});

describe("getMaxRetriesForStage", () => {
  it("should return correct max retries for each stage", () => {
    expect(getMaxRetriesForStage(IngestionStage.DISCOVER)).toBe(STAGE_MAX_RETRIES.discover);
    expect(getMaxRetriesForStage(IngestionStage.FETCH)).toBe(STAGE_MAX_RETRIES.fetch);
    expect(getMaxRetriesForStage(IngestionStage.EXTRACT)).toBe(STAGE_MAX_RETRIES.extract);
    expect(getMaxRetriesForStage(IngestionStage.CHUNK)).toBe(STAGE_MAX_RETRIES.chunk);
    expect(getMaxRetriesForStage(IngestionStage.EMBED)).toBe(STAGE_MAX_RETRIES.embed);
    expect(getMaxRetriesForStage(IngestionStage.INDEX)).toBe(STAGE_MAX_RETRIES.index);
  });
});

describe("getRetryOptionsForStage", () => {
  it("should return complete options for a stage", () => {
    const options = getRetryOptionsForStage(IngestionStage.FETCH);
    expect(options.maxAttempts).toBe(STAGE_MAX_RETRIES.fetch);
    expect(options.backoff).toEqual(getBackoffConfigForStage(IngestionStage.FETCH));
  });

  it("should apply overrides", () => {
    const isRetryable = (error: unknown) => true;
    const onRetry = (attempt: number, error: unknown, delay: number) => {};

    const options = getRetryOptionsForStage(IngestionStage.FETCH, {
      maxAttempts: 5,
      isRetryable,
      onRetry,
    });

    expect(options.maxAttempts).toBe(5);
    expect(options.isRetryable).toBe(isRetryable);
    expect(options.onRetry).toBe(onRetry);
  });

  it("should apply backoff override", () => {
    const customBackoff: BackoffConfig = {
      baseDelayMs: 100,
      maxDelayMs: 1000,
      multiplier: 1.5,
      jitterRatio: 0.1,
    };

    const options = getRetryOptionsForStage(IngestionStage.FETCH, {
      backoff: customBackoff,
    });

    expect(options.backoff).toEqual(customBackoff);
  });
});

describe("calculateJitter", () => {
  it("should return value between 0 and max jitter", () => {
    const baseDelay = 1000;
    const jitterRatio = 0.3;
    const maxJitter = baseDelay * jitterRatio;

    // Run multiple times to test randomness
    for (let i = 0; i < 100; i++) {
      const jitter = calculateJitter(baseDelay, jitterRatio);
      expect(jitter).toBeGreaterThanOrEqual(0);
      expect(jitter).toBeLessThanOrEqual(maxJitter);
    }
  });

  it("should return 0 when jitterRatio is 0", () => {
    const jitter = calculateJitter(1000, 0);
    expect(jitter).toBe(0);
  });

  it("should return 0 when baseDelay is 0", () => {
    const jitter = calculateJitter(0, 0.3);
    expect(jitter).toBe(0);
  });

  it("should scale with baseDelay", () => {
    // With fixed random, larger base delay should produce larger jitter range
    const jitterSmall = calculateJitter(100, 0.5);
    const jitterLarge = calculateJitter(10000, 0.5);

    // Both should be in valid range
    expect(jitterSmall).toBeLessThanOrEqual(50);
    expect(jitterLarge).toBeLessThanOrEqual(5000);
  });
});

describe("calculateBackoffDelay", () => {
  const config: BackoffConfig = {
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitterRatio: 0.3,
  };

  it("should return base delay for attempt 1", () => {
    const delay = calculateBackoffDelay(1, config);
    expect(delay.baseDelayMs).toBe(1000);
    expect(delay.attempt).toBe(1);
    expect(delay.usedRetryAfter).toBe(false);
  });

  it("should apply exponential growth", () => {
    const delay1 = calculateBackoffDelay(1, config);
    const delay2 = calculateBackoffDelay(2, config);
    const delay3 = calculateBackoffDelay(3, config);

    expect(delay1.baseDelayMs).toBe(1000);  // 1000 * 2^0
    expect(delay2.baseDelayMs).toBe(2000);  // 1000 * 2^1
    expect(delay3.baseDelayMs).toBe(4000);  // 1000 * 2^2
  });

  it("should cap at maxDelayMs", () => {
    const smallMaxConfig = { ...config, maxDelayMs: 3000 };
    const delay = calculateBackoffDelay(10, smallMaxConfig);

    expect(delay.baseDelayMs).toBe(3000);
    expect(delay.wasCapped).toBe(true);
  });

  it("should add jitter to delay", () => {
    const delay = calculateBackoffDelay(1, config);

    // Jitter should be added
    expect(delay.jitterMs).toBeGreaterThanOrEqual(0);
    expect(delay.jitterMs).toBeLessThanOrEqual(1000 * config.jitterRatio);
    expect(delay.totalDelayMs).toBe(delay.baseDelayMs + delay.jitterMs);
  });

  it("should use Retry-After when provided", () => {
    const delay = calculateBackoffDelay(1, config, 30);

    expect(delay.baseDelayMs).toBe(30000);  // 30 seconds in ms
    expect(delay.usedRetryAfter).toBe(true);
  });

  it("should add jitter to Retry-After", () => {
    const delay = calculateBackoffDelay(1, config, 30);

    expect(delay.jitterMs).toBeGreaterThanOrEqual(0);
    // Jitter for Retry-After uses half the jitter ratio
    expect(delay.jitterMs).toBeLessThanOrEqual(30000 * config.jitterRatio * 0.5);
  });

  it("should cap Retry-After at maxDelayMs", () => {
    const delay = calculateBackoffDelay(1, config, 120);  // 120 seconds

    expect(delay.totalDelayMs).toBeLessThanOrEqual(config.maxDelayMs);
    expect(delay.wasCapped).toBe(true);
  });

  it("should not use Retry-After if 0 or negative", () => {
    const delay0 = calculateBackoffDelay(2, config, 0);
    const delayNeg = calculateBackoffDelay(2, config, -5);

    expect(delay0.usedRetryAfter).toBe(false);
    expect(delayNeg.usedRetryAfter).toBe(false);
  });
});

describe("generateBackoffSchedule", () => {
  const config: BackoffConfig = {
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    multiplier: 2,
    jitterRatio: 0.3,
  };

  it("should generate schedule for specified attempts", () => {
    const schedule = generateBackoffSchedule(3, config);
    expect(schedule).toHaveLength(3);
  });

  it("should have increasing base delays", () => {
    const schedule = generateBackoffSchedule(4, config);

    expect(schedule[0].baseDelayMs).toBe(1000);
    expect(schedule[1].baseDelayMs).toBe(2000);
    expect(schedule[2].baseDelayMs).toBe(4000);
    expect(schedule[3].baseDelayMs).toBe(8000);
  });

  it("should include attempt numbers", () => {
    const schedule = generateBackoffSchedule(3, config);

    expect(schedule[0].attempt).toBe(1);
    expect(schedule[1].attempt).toBe(2);
    expect(schedule[2].attempt).toBe(3);
  });

  it("should return empty array for 0 attempts", () => {
    const schedule = generateBackoffSchedule(0, config);
    expect(schedule).toHaveLength(0);
  });
});

describe("calculateMaxTotalWaitTime", () => {
  const config: BackoffConfig = {
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    multiplier: 2,
    jitterRatio: 0.3,
  };

  it("should calculate total wait time for all attempts", () => {
    const total = calculateMaxTotalWaitTime(3, config);

    // Attempt 1: 1000 + 300 jitter = 1300
    // Attempt 2: 2000 + 600 jitter = 2600
    // Attempt 3: 4000 + 1200 jitter = 5200
    // Total: 9100
    expect(total).toBe(9100);
  });

  it("should respect maxDelayMs cap", () => {
    const smallMaxConfig = { ...config, maxDelayMs: 2000 };
    const total = calculateMaxTotalWaitTime(5, smallMaxConfig);

    // All delays capped at 2000 + 600 jitter = 2600
    // But jitter also capped at maxDelayMs
    // Attempt 1: 1000 + 300 = 1300
    // Attempt 2: 2000 + 600 = 2600 (capped at 2000)
    // Attempts 3-5: 2000 each (already capped)
    expect(total).toBeLessThanOrEqual(5 * 2000);
  });

  it("should return 0 for 0 attempts", () => {
    const total = calculateMaxTotalWaitTime(0, config);
    expect(total).toBe(0);
  });
});

describe("sleepMs", () => {
  it("should resolve after specified delay", async () => {
    const start = Date.now();
    await sleepMs(10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(10);
  });

  it("should resolve immediately for 0ms", async () => {
    const start = Date.now();
    await sleepMs(0);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // Allow some margin
  });
});

describe("executeWithBackoff", () => {
  // Use very small delays for fast tests
  const fastConfig: BackoffConfig = {
    baseDelayMs: 1,
    maxDelayMs: 10,
    multiplier: 2,
    jitterRatio: 0,
  };

  it("should succeed on first attempt", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "success";
    };
    const options: RetryOptions = {
      maxAttempts: 3,
      backoff: fastConfig,
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.success).toBe(true);
    expect(result.value).toBe("success");
    expect(result.attempts).toBe(1);
    expect(result.totalWaitTimeMs).toBe(0);
    expect(callCount).toBe(1);
  });

  it("should retry on failure and succeed", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error("fail " + callCount);
      }
      return "success";
    };
    const options: RetryOptions = {
      maxAttempts: 3,
      backoff: fastConfig,
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.success).toBe(true);
    expect(result.value).toBe("success");
    expect(result.attempts).toBe(2);
    expect(result.totalWaitTimeMs).toBeGreaterThan(0);
    expect(callCount).toBe(2);
  });

  it("should fail after max attempts", async () => {
    const error = new Error("persistent failure");
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw error;
    };

    const options: RetryOptions = {
      maxAttempts: 3,
      backoff: fastConfig,
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.success).toBe(false);
    expect(result.error).toBe(error);
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);
  });

  it("should not retry non-retryable errors", async () => {
    const permanentError = new Error("permanent");
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw permanentError;
    };

    const options: RetryOptions = {
      maxAttempts: 5,
      backoff: fastConfig,
      isRetryable: () => false,
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  it("should call onRetry callback", async () => {
    const onRetryCalls: Array<{ attempt: number; error: unknown; delay: number }> = [];
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("fail " + callCount);
      }
      return "success";
    };

    const options: RetryOptions = {
      maxAttempts: 5,
      backoff: fastConfig,
      onRetry: (attempt, error, delay) => {
        onRetryCalls.push({ attempt, error, delay });
      },
    };

    await executeWithBackoff(fn, options);

    expect(onRetryCalls).toHaveLength(2);
    expect(onRetryCalls[0].attempt).toBe(1);
    expect(onRetryCalls[1].attempt).toBe(2);
  });

  it("should track attempt details", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error("fail");
      }
      return "success";
    };

    const options: RetryOptions = {
      maxAttempts: 3,
      backoff: fastConfig,
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.attemptDetails).toHaveLength(2);

    expect(result.attemptDetails[0].attempt).toBe(1);
    expect(result.attemptDetails[0].succeeded).toBe(false);
    expect(result.attemptDetails[0].delayBeforeMs).toBe(0);

    expect(result.attemptDetails[1].attempt).toBe(2);
    expect(result.attemptDetails[1].succeeded).toBe(true);
    expect(result.attemptDetails[1].delayBeforeMs).toBeGreaterThan(0);
  });

  it("should use retryAfterSeconds when provided", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error("rate limited");
      }
      return "success";
    };

    const options: RetryOptions = {
      maxAttempts: 3,
      backoff: { ...fastConfig, maxDelayMs: 100 },
      retryAfterSeconds: 0.01,  // 10ms
    };

    const result = await executeWithBackoff(fn, options);

    // The delay should be approximately 10ms (from retryAfterSeconds)
    expect(result.attemptDetails[1].delayBeforeMs).toBeGreaterThanOrEqual(10);
  });

  it("should stop immediately on non-retryable error", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("retryable");
      }
      if (callCount === 2) {
        throw new Error("permanent");
      }
      return "success";
    };

    const options: RetryOptions = {
      maxAttempts: 5,
      backoff: fastConfig,
      isRetryable: (error) => error instanceof Error && error.message === "retryable",
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(callCount).toBe(2);
  });
});

describe("createRetryFunction", () => {
  const fastConfig: BackoffConfig = {
    baseDelayMs: 1,
    maxDelayMs: 10,
    multiplier: 2,
    jitterRatio: 0,
  };

  it("should create bound retry function", async () => {
    const options: RetryOptions = {
      maxAttempts: 3,
      backoff: fastConfig,
    };
    const retryFn = createRetryFunction(options);

    const fn = async () => "result";
    const result = await retryFn(fn);

    expect(result.success).toBe(true);
    expect(result.value).toBe("result");
  });
});

describe("createStageRetryFunction", () => {
  it("should create stage-specific retry function", async () => {
    const retryFn = createStageRetryFunction(IngestionStage.CHUNK, {
      backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 },
    });

    const fn = async () => "fetched";
    const result = await retryFn(fn);

    expect(result.success).toBe(true);
    expect(result.value).toBe("fetched");
  });

  it("should apply stage-specific max attempts", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("always fail");
    };

    const retryFn = createStageRetryFunction(IngestionStage.CHUNK, {
      backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 },
    });  // chunk has 1 retry
    const result = await retryFn(fn);

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(STAGE_MAX_RETRIES.chunk);
  });

  it("should apply overrides to stage function", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      throw new Error("fail");
    };

    const retryFn = createStageRetryFunction(IngestionStage.FETCH, {
      maxAttempts: 1,
      backoff: { baseDelayMs: 1, maxDelayMs: 10, multiplier: 2, jitterRatio: 0 },
    });

    const result = await retryFn(fn);

    expect(result.attempts).toBe(1);
  });
});

describe("BackoffConfig interface", () => {
  it("should allow creating custom configs", () => {
    const config: BackoffConfig = {
      baseDelayMs: 500,
      maxDelayMs: 10000,
      multiplier: 1.5,
      jitterRatio: 0.2,
    };

    expect(config.baseDelayMs).toBe(500);
    expect(config.maxDelayMs).toBe(10000);
    expect(config.multiplier).toBe(1.5);
    expect(config.jitterRatio).toBe(0.2);
  });
});

describe("RetryOptions interface", () => {
  it("should allow creating complete options", () => {
    const options: RetryOptions = {
      maxAttempts: 5,
      backoff: getDefaultBackoffConfig(),
      isRetryable: (error) => error instanceof Error,
      onRetry: (attempt, error, delay) => console.log(`Retry ${attempt}`),
      retryAfterSeconds: 10,
    };

    expect(options.maxAttempts).toBe(5);
    expect(options.isRetryable).toBeDefined();
    expect(options.onRetry).toBeDefined();
    expect(options.retryAfterSeconds).toBe(10);
  });
});

describe("RetryResult interface", () => {
  it("should represent successful result", () => {
    const result: RetryResult<string> = {
      success: true,
      value: "data",
      attempts: 1,
      totalWaitTimeMs: 0,
      attemptDetails: [{
        attempt: 1,
        succeeded: true,
        delayBeforeMs: 0,
        startedAt: new Date().toISOString(),
      }],
    };

    expect(result.success).toBe(true);
    expect(result.value).toBe("data");
    expect(result.error).toBeUndefined();
  });

  it("should represent failed result", () => {
    const error = new Error("failed");
    const result: RetryResult<string> = {
      success: false,
      error,
      attempts: 3,
      totalWaitTimeMs: 5000,
      attemptDetails: [],
    };

    expect(result.success).toBe(false);
    expect(result.value).toBeUndefined();
    expect(result.error).toBe(error);
  });
});

describe("BackoffDelayInfo interface", () => {
  it("should represent delay information", () => {
    const info: BackoffDelayInfo = {
      baseDelayMs: 1000,
      jitterMs: 150,
      totalDelayMs: 1150,
      attempt: 2,
      wasCapped: false,
      usedRetryAfter: false,
    };

    expect(info.totalDelayMs).toBe(info.baseDelayMs + info.jitterMs);
  });
});

describe("Integration with error taxonomy", () => {
  const fastConfig: BackoffConfig = {
    baseDelayMs: 1,
    maxDelayMs: 10,
    multiplier: 2,
    jitterRatio: 0,
  };

  it("should work with isRetryableError from error taxonomy", async () => {
    // Import isRetryableError
    const { isRetryableError } = await import("../errors");

    const retryableError = new Error("timeout");

    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw retryableError;
      }
      return "success";
    };

    const options: RetryOptions = {
      maxAttempts: 5,
      backoff: fastConfig,
      isRetryable: isRetryableError,
    };

    const result = await executeWithBackoff(fn, options);

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
  });
});
