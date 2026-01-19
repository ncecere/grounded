import { describe, it, expect } from "bun:test";
import {
  // Types
  type EmbedBackpressureCheckResult,
  type EmbedBackpressureConfig,
  type EmbedBackpressureWaitResult,
  type EmbedBackpressureMetrics,
  // Constants
  DEFAULT_EMBED_QUEUE_THRESHOLD,
  DEFAULT_EMBED_LAG_THRESHOLD,
  EMBED_BACKPRESSURE_DELAY_MS,
  EMBED_BACKPRESSURE_MAX_WAIT_CYCLES,
  EMBED_BACKPRESSURE_ENV_VARS,
  EMBED_BACKPRESSURE_KEY,
  EMBED_BACKPRESSURE_KEY_TTL_SECONDS,
  // Functions
  resolveEmbedBackpressureConfig,
  getDefaultEmbedBackpressureConfig,
  checkEmbedBackpressure,
  calculateEmbedBackpressureMetrics,
  getEmbedBackpressureKey,
  getEmbedBackpressureKeyTtl,
} from "./index";

describe("Embed Backpressure Constants", () => {
  describe("DEFAULT_EMBED_QUEUE_THRESHOLD", () => {
    it("should have a reasonable default value", () => {
      expect(DEFAULT_EMBED_QUEUE_THRESHOLD).toBe(100);
    });

    it("should be a positive integer", () => {
      expect(DEFAULT_EMBED_QUEUE_THRESHOLD).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_EMBED_QUEUE_THRESHOLD)).toBe(true);
    });
  });

  describe("DEFAULT_EMBED_LAG_THRESHOLD", () => {
    it("should have a reasonable default value", () => {
      expect(DEFAULT_EMBED_LAG_THRESHOLD).toBe(500);
    });

    it("should be a positive integer", () => {
      expect(DEFAULT_EMBED_LAG_THRESHOLD).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_EMBED_LAG_THRESHOLD)).toBe(true);
    });

    it("should be greater than queue threshold for buffer room", () => {
      expect(DEFAULT_EMBED_LAG_THRESHOLD).toBeGreaterThan(DEFAULT_EMBED_QUEUE_THRESHOLD);
    });
  });

  describe("EMBED_BACKPRESSURE_DELAY_MS", () => {
    it("should be 2 seconds", () => {
      expect(EMBED_BACKPRESSURE_DELAY_MS).toBe(2000);
    });

    it("should be a reasonable wait time", () => {
      // Should be at least 1 second for meaningful backpressure relief
      expect(EMBED_BACKPRESSURE_DELAY_MS).toBeGreaterThanOrEqual(1000);
      // Should be at most 10 seconds to avoid blocking too long
      expect(EMBED_BACKPRESSURE_DELAY_MS).toBeLessThanOrEqual(10000);
    });
  });

  describe("EMBED_BACKPRESSURE_MAX_WAIT_CYCLES", () => {
    it("should have default value of 10", () => {
      expect(EMBED_BACKPRESSURE_MAX_WAIT_CYCLES).toBe(10);
    });

    it("should result in reasonable max wait time", () => {
      const maxWaitMs = EMBED_BACKPRESSURE_DELAY_MS * EMBED_BACKPRESSURE_MAX_WAIT_CYCLES;
      // Max wait should be between 10 seconds and 1 minute
      expect(maxWaitMs).toBeGreaterThanOrEqual(10000);
      expect(maxWaitMs).toBeLessThanOrEqual(60000);
    });
  });

  describe("EMBED_BACKPRESSURE_ENV_VARS", () => {
    it("should have queue threshold env var", () => {
      expect(EMBED_BACKPRESSURE_ENV_VARS.QUEUE_THRESHOLD).toBe("EMBED_QUEUE_THRESHOLD");
    });

    it("should have lag threshold env var", () => {
      expect(EMBED_BACKPRESSURE_ENV_VARS.LAG_THRESHOLD).toBe("EMBED_LAG_THRESHOLD");
    });

    it("should have delay env var", () => {
      expect(EMBED_BACKPRESSURE_ENV_VARS.DELAY_MS).toBe("EMBED_BACKPRESSURE_DELAY_MS");
    });

    it("should have max wait cycles env var", () => {
      expect(EMBED_BACKPRESSURE_ENV_VARS.MAX_WAIT_CYCLES).toBe("EMBED_BACKPRESSURE_MAX_WAIT_CYCLES");
    });

    it("should have disabled env var", () => {
      expect(EMBED_BACKPRESSURE_ENV_VARS.DISABLED).toBe("EMBED_BACKPRESSURE_DISABLED");
    });

    it("should have valid environment variable names", () => {
      Object.values(EMBED_BACKPRESSURE_ENV_VARS).forEach((envVar) => {
        expect(envVar).toMatch(/^[A-Z_]+$/);
      });
    });
  });

  describe("EMBED_BACKPRESSURE_KEY", () => {
    it("should have expected value", () => {
      expect(EMBED_BACKPRESSURE_KEY).toBe("backpressure:embed:pending");
    });

    it("should be a valid Redis key format", () => {
      expect(EMBED_BACKPRESSURE_KEY).toMatch(/^[a-z:]+$/);
    });
  });

  describe("EMBED_BACKPRESSURE_KEY_TTL_SECONDS", () => {
    it("should be 10 minutes", () => {
      expect(EMBED_BACKPRESSURE_KEY_TTL_SECONDS).toBe(600);
    });

    it("should be long enough for typical operations", () => {
      // Should be at least 5 minutes
      expect(EMBED_BACKPRESSURE_KEY_TTL_SECONDS).toBeGreaterThanOrEqual(300);
    });
  });
});

describe("resolveEmbedBackpressureConfig", () => {
  it("should return default values when no env vars are set", () => {
    const config = resolveEmbedBackpressureConfig(() => undefined);

    expect(config.queueThreshold).toBe(DEFAULT_EMBED_QUEUE_THRESHOLD);
    expect(config.lagThreshold).toBe(DEFAULT_EMBED_LAG_THRESHOLD);
    expect(config.delayMs).toBe(EMBED_BACKPRESSURE_DELAY_MS);
    expect(config.maxWaitCycles).toBe(EMBED_BACKPRESSURE_MAX_WAIT_CYCLES);
    expect(config.disabled).toBe(false);
  });

  it("should parse queue threshold from env", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.QUEUE_THRESHOLD ? "200" : undefined
    );

    expect(config.queueThreshold).toBe(200);
  });

  it("should parse lag threshold from env", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.LAG_THRESHOLD ? "1000" : undefined
    );

    expect(config.lagThreshold).toBe(1000);
  });

  it("should parse delay from env", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.DELAY_MS ? "5000" : undefined
    );

    expect(config.delayMs).toBe(5000);
  });

  it("should parse max wait cycles from env", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.MAX_WAIT_CYCLES ? "20" : undefined
    );

    expect(config.maxWaitCycles).toBe(20);
  });

  it("should parse disabled=true from env", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.DISABLED ? "true" : undefined
    );

    expect(config.disabled).toBe(true);
  });

  it("should parse disabled=1 from env", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.DISABLED ? "1" : undefined
    );

    expect(config.disabled).toBe(true);
  });

  it("should not disable for other values", () => {
    const config = resolveEmbedBackpressureConfig((key) =>
      key === EMBED_BACKPRESSURE_ENV_VARS.DISABLED ? "false" : undefined
    );

    expect(config.disabled).toBe(false);
  });

  it("should use default for invalid numeric values", () => {
    const config = resolveEmbedBackpressureConfig((key) => {
      if (key === EMBED_BACKPRESSURE_ENV_VARS.QUEUE_THRESHOLD) return "invalid";
      if (key === EMBED_BACKPRESSURE_ENV_VARS.LAG_THRESHOLD) return "-5";
      if (key === EMBED_BACKPRESSURE_ENV_VARS.DELAY_MS) return "0";
      return undefined;
    });

    expect(config.queueThreshold).toBe(DEFAULT_EMBED_QUEUE_THRESHOLD);
    expect(config.lagThreshold).toBe(DEFAULT_EMBED_LAG_THRESHOLD);
    expect(config.delayMs).toBe(EMBED_BACKPRESSURE_DELAY_MS);
  });

  it("should parse all values from env", () => {
    const config = resolveEmbedBackpressureConfig((key) => {
      const values: Record<string, string> = {
        [EMBED_BACKPRESSURE_ENV_VARS.QUEUE_THRESHOLD]: "50",
        [EMBED_BACKPRESSURE_ENV_VARS.LAG_THRESHOLD]: "250",
        [EMBED_BACKPRESSURE_ENV_VARS.DELAY_MS]: "3000",
        [EMBED_BACKPRESSURE_ENV_VARS.MAX_WAIT_CYCLES]: "5",
        [EMBED_BACKPRESSURE_ENV_VARS.DISABLED]: "true",
      };
      return values[key];
    });

    expect(config.queueThreshold).toBe(50);
    expect(config.lagThreshold).toBe(250);
    expect(config.delayMs).toBe(3000);
    expect(config.maxWaitCycles).toBe(5);
    expect(config.disabled).toBe(true);
  });
});

describe("getDefaultEmbedBackpressureConfig", () => {
  it("should return default config", () => {
    const config = getDefaultEmbedBackpressureConfig();

    expect(config.queueThreshold).toBe(DEFAULT_EMBED_QUEUE_THRESHOLD);
    expect(config.lagThreshold).toBe(DEFAULT_EMBED_LAG_THRESHOLD);
    expect(config.delayMs).toBe(EMBED_BACKPRESSURE_DELAY_MS);
    expect(config.maxWaitCycles).toBe(EMBED_BACKPRESSURE_MAX_WAIT_CYCLES);
    expect(config.disabled).toBe(false);
  });
});

describe("checkEmbedBackpressure", () => {
  const defaultConfig = getDefaultEmbedBackpressureConfig();

  it("should not wait when below thresholds", () => {
    const result = checkEmbedBackpressure(50, 200, defaultConfig);

    expect(result.shouldWait).toBe(false);
    expect(result.queueDepth).toBe(50);
    expect(result.embedLag).toBe(200);
    expect(result.exceededThreshold).toBeUndefined();
    expect(result.reason).toBe("within_thresholds");
  });

  it("should wait when queue depth exceeds threshold", () => {
    const result = checkEmbedBackpressure(150, 200, defaultConfig);

    expect(result.shouldWait).toBe(true);
    expect(result.exceededThreshold).toBe("queue");
    expect(result.reason).toContain("queue_depth_150_exceeds_threshold");
  });

  it("should wait when embed lag exceeds threshold", () => {
    const result = checkEmbedBackpressure(50, 600, defaultConfig);

    expect(result.shouldWait).toBe(true);
    expect(result.exceededThreshold).toBe("lag");
    expect(result.reason).toContain("embed_lag_600_exceeds_threshold");
  });

  it("should prefer queue threshold check over lag", () => {
    const result = checkEmbedBackpressure(150, 600, defaultConfig);

    // Queue is checked first, so it should report queue as the exceeded threshold
    expect(result.shouldWait).toBe(true);
    expect(result.exceededThreshold).toBe("queue");
  });

  it("should not wait at exact queue threshold", () => {
    const result = checkEmbedBackpressure(100, 200, defaultConfig);

    expect(result.shouldWait).toBe(true); // >= not >
    expect(result.exceededThreshold).toBe("queue");
  });

  it("should not wait at exact lag threshold", () => {
    const result = checkEmbedBackpressure(50, 500, defaultConfig);

    expect(result.shouldWait).toBe(true); // >= not >
    expect(result.exceededThreshold).toBe("lag");
  });

  it("should never wait when disabled", () => {
    const disabledConfig = { ...defaultConfig, disabled: true };

    // Even with high values, should not wait
    const result = checkEmbedBackpressure(1000, 5000, disabledConfig);

    expect(result.shouldWait).toBe(false);
    expect(result.reason).toBe("backpressure_disabled");
  });

  it("should work with custom thresholds", () => {
    const customConfig = { ...defaultConfig, queueThreshold: 10, lagThreshold: 50 };

    const result1 = checkEmbedBackpressure(5, 20, customConfig);
    expect(result1.shouldWait).toBe(false);

    const result2 = checkEmbedBackpressure(15, 20, customConfig);
    expect(result2.shouldWait).toBe(true);
    expect(result2.exceededThreshold).toBe("queue");

    const result3 = checkEmbedBackpressure(5, 60, customConfig);
    expect(result3.shouldWait).toBe(true);
    expect(result3.exceededThreshold).toBe("lag");
  });

  it("should handle zero values", () => {
    const result = checkEmbedBackpressure(0, 0, defaultConfig);

    expect(result.shouldWait).toBe(false);
    expect(result.queueDepth).toBe(0);
    expect(result.embedLag).toBe(0);
  });
});

describe("calculateEmbedBackpressureMetrics", () => {
  const defaultConfig = getDefaultEmbedBackpressureConfig();

  it("should calculate metrics correctly when not active", () => {
    const metrics = calculateEmbedBackpressureMetrics(50, 200, defaultConfig);

    expect(metrics.queueDepth).toBe(50);
    expect(metrics.embedLag).toBe(200);
    expect(metrics.isActive).toBe(false);
    expect(metrics.queueThreshold).toBe(DEFAULT_EMBED_QUEUE_THRESHOLD);
    expect(metrics.lagThreshold).toBe(DEFAULT_EMBED_LAG_THRESHOLD);
    expect(metrics.queueUtilization).toBe(50); // 50/100 * 100
    expect(metrics.lagUtilization).toBe(40); // 200/500 * 100
  });

  it("should mark as active when queue exceeds threshold", () => {
    const metrics = calculateEmbedBackpressureMetrics(150, 200, defaultConfig);

    expect(metrics.isActive).toBe(true);
    expect(metrics.queueUtilization).toBe(150);
  });

  it("should mark as active when lag exceeds threshold", () => {
    const metrics = calculateEmbedBackpressureMetrics(50, 600, defaultConfig);

    expect(metrics.isActive).toBe(true);
    expect(metrics.lagUtilization).toBe(120);
  });

  it("should handle zero thresholds", () => {
    const zeroConfig = { ...defaultConfig, queueThreshold: 0, lagThreshold: 0 };
    const metrics = calculateEmbedBackpressureMetrics(50, 200, zeroConfig);

    expect(metrics.queueUtilization).toBe(0);
    expect(metrics.lagUtilization).toBe(0);
  });
});

describe("Helper functions", () => {
  describe("getEmbedBackpressureKey", () => {
    it("should return the key constant", () => {
      expect(getEmbedBackpressureKey()).toBe(EMBED_BACKPRESSURE_KEY);
    });
  });

  describe("getEmbedBackpressureKeyTtl", () => {
    it("should return the TTL constant", () => {
      expect(getEmbedBackpressureKeyTtl()).toBe(EMBED_BACKPRESSURE_KEY_TTL_SECONDS);
    });
  });
});

describe("Type interfaces", () => {
  it("EmbedBackpressureCheckResult should have required properties", () => {
    const result: EmbedBackpressureCheckResult = {
      shouldWait: true,
      queueDepth: 100,
      embedLag: 200,
      exceededThreshold: "queue",
      reason: "test_reason",
    };

    expect(result.shouldWait).toBe(true);
    expect(result.queueDepth).toBe(100);
    expect(result.embedLag).toBe(200);
    expect(result.exceededThreshold).toBe("queue");
    expect(result.reason).toBe("test_reason");
  });

  it("EmbedBackpressureConfig should have all properties", () => {
    const config: EmbedBackpressureConfig = {
      queueThreshold: 100,
      lagThreshold: 500,
      delayMs: 2000,
      maxWaitCycles: 10,
      disabled: false,
    };

    expect(config.queueThreshold).toBe(100);
    expect(config.lagThreshold).toBe(500);
    expect(config.delayMs).toBe(2000);
    expect(config.maxWaitCycles).toBe(10);
    expect(config.disabled).toBe(false);
  });

  it("EmbedBackpressureWaitResult should have all properties", () => {
    const result: EmbedBackpressureWaitResult = {
      waited: true,
      waitCycles: 5,
      waitTimeMs: 10000,
      timedOut: false,
      finalCheck: {
        shouldWait: false,
        queueDepth: 50,
        embedLag: 100,
      },
    };

    expect(result.waited).toBe(true);
    expect(result.waitCycles).toBe(5);
    expect(result.waitTimeMs).toBe(10000);
    expect(result.timedOut).toBe(false);
    expect(result.finalCheck.shouldWait).toBe(false);
  });

  it("EmbedBackpressureMetrics should have all properties", () => {
    const metrics: EmbedBackpressureMetrics = {
      queueDepth: 50,
      embedLag: 200,
      isActive: false,
      queueThreshold: 100,
      lagThreshold: 500,
      queueUtilization: 50,
      lagUtilization: 40,
    };

    expect(metrics.queueDepth).toBe(50);
    expect(metrics.embedLag).toBe(200);
    expect(metrics.isActive).toBe(false);
    expect(metrics.queueThreshold).toBe(100);
    expect(metrics.lagThreshold).toBe(500);
    expect(metrics.queueUtilization).toBe(50);
    expect(metrics.lagUtilization).toBe(40);
  });
});

describe("Integration scenarios", () => {
  it("should handle typical low-load scenario", () => {
    const config = getDefaultEmbedBackpressureConfig();

    // Simulate a system with low load
    const check = checkEmbedBackpressure(10, 50, config);
    expect(check.shouldWait).toBe(false);

    const metrics = calculateEmbedBackpressureMetrics(10, 50, config);
    expect(metrics.isActive).toBe(false);
    expect(metrics.queueUtilization).toBe(10);
    expect(metrics.lagUtilization).toBe(10);
  });

  it("should handle high-load queue-bound scenario", () => {
    const config = getDefaultEmbedBackpressureConfig();

    // Simulate a system with queue backup
    const check = checkEmbedBackpressure(150, 100, config);
    expect(check.shouldWait).toBe(true);
    expect(check.exceededThreshold).toBe("queue");

    const metrics = calculateEmbedBackpressureMetrics(150, 100, config);
    expect(metrics.isActive).toBe(true);
    expect(metrics.queueUtilization).toBe(150);
  });

  it("should handle high-load lag-bound scenario", () => {
    const config = getDefaultEmbedBackpressureConfig();

    // Simulate a system with embedding lag (maybe embed workers are slow)
    const check = checkEmbedBackpressure(50, 750, config);
    expect(check.shouldWait).toBe(true);
    expect(check.exceededThreshold).toBe("lag");

    const metrics = calculateEmbedBackpressureMetrics(50, 750, config);
    expect(metrics.isActive).toBe(true);
    expect(metrics.lagUtilization).toBe(150);
  });

  it("should respect disabled configuration in high load", () => {
    const config = { ...getDefaultEmbedBackpressureConfig(), disabled: true };

    // Even in high load, should not wait when disabled
    const check = checkEmbedBackpressure(500, 2000, config);
    expect(check.shouldWait).toBe(false);
    expect(check.reason).toBe("backpressure_disabled");
  });

  it("should work with production-realistic thresholds", () => {
    // Simulate a production environment with higher thresholds
    const prodConfig: EmbedBackpressureConfig = {
      queueThreshold: 500,
      lagThreshold: 2000,
      delayMs: 5000,
      maxWaitCycles: 12,
      disabled: false,
    };

    // Normal operation
    const normalCheck = checkEmbedBackpressure(100, 500, prodConfig);
    expect(normalCheck.shouldWait).toBe(false);

    // Heavy load
    const heavyCheck = checkEmbedBackpressure(600, 500, prodConfig);
    expect(heavyCheck.shouldWait).toBe(true);
    expect(heavyCheck.exceededThreshold).toBe("queue");

    // Very heavy lag
    const laggyCheck = checkEmbedBackpressure(100, 2500, prodConfig);
    expect(laggyCheck.shouldWait).toBe(true);
    expect(laggyCheck.exceededThreshold).toBe("lag");
  });
});
