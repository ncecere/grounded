import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import {
  // Constants
  DEFAULT_METRICS_EMIT_INTERVAL_MS,
  METRICS_EMIT_INTERVAL_ENV_VAR,
  METRICS_DISABLED_ENV_VAR,
  STAGE_METRICS_KEY_PREFIX,
  STAGE_METRICS_KEY_TTL_SECONDS,
  STAGE_METRICS_ENV_VARS,
  // Types
  type StageLatencyStats,
  type StageThroughputMetrics,
  type StageLatencyMetrics,
  type StageMetrics,
  type StageItemTiming,
  type RunStageMetricsAccumulator,
  type StageMetricsData,
  type StageMetricsSnapshot,
  type RunMetricsSummary,
  type StageMetricsConfig,
  type StageMetricsLog,
  // Functions
  isStageMetricsDisabled,
  isStageMetricsDebugEnabled,
  getStageMetricsEmitInterval,
  getStageMetricsConfig,
  buildStageMetricsKey,
  getStageMetricsKeyTtl,
  createEmptyLatencyStats,
  createEmptyStageMetricsData,
  createRunStageMetricsAccumulator,
  updateLatencyStats,
  recordItemTiming,
  createStageItemTiming,
  calculateThroughputMetrics,
  calculateLatencyMetrics,
  calculateStageMetrics,
  createStageMetricsSnapshot,
  createRunMetricsSummary,
  createStageMetricsLog,
  formatStageMetricsLog,
  createStructuredRunMetricsLog,
  mergeStageMetricsData,
  serializeStageMetricsData,
  deserializeStageMetricsData,
  IngestionStage,
} from "./index";

describe("Stage Metrics", () => {
  // Store original env vars for restoration
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original env vars
    originalEnv[METRICS_DISABLED_ENV_VAR] = process.env[METRICS_DISABLED_ENV_VAR];
    originalEnv[METRICS_EMIT_INTERVAL_ENV_VAR] = process.env[METRICS_EMIT_INTERVAL_ENV_VAR];
    originalEnv[STAGE_METRICS_ENV_VARS.DEBUG] = process.env[STAGE_METRICS_ENV_VARS.DEBUG];
    // Clear env vars
    delete process.env[METRICS_DISABLED_ENV_VAR];
    delete process.env[METRICS_EMIT_INTERVAL_ENV_VAR];
    delete process.env[STAGE_METRICS_ENV_VARS.DEBUG];
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnv[METRICS_DISABLED_ENV_VAR] !== undefined) {
      process.env[METRICS_DISABLED_ENV_VAR] = originalEnv[METRICS_DISABLED_ENV_VAR];
    } else {
      delete process.env[METRICS_DISABLED_ENV_VAR];
    }
    if (originalEnv[METRICS_EMIT_INTERVAL_ENV_VAR] !== undefined) {
      process.env[METRICS_EMIT_INTERVAL_ENV_VAR] = originalEnv[METRICS_EMIT_INTERVAL_ENV_VAR];
    } else {
      delete process.env[METRICS_EMIT_INTERVAL_ENV_VAR];
    }
    if (originalEnv[STAGE_METRICS_ENV_VARS.DEBUG] !== undefined) {
      process.env[STAGE_METRICS_ENV_VARS.DEBUG] = originalEnv[STAGE_METRICS_ENV_VARS.DEBUG];
    } else {
      delete process.env[STAGE_METRICS_ENV_VARS.DEBUG];
    }
  });

  describe("Constants", () => {
    it("should have correct default metrics emit interval", () => {
      expect(DEFAULT_METRICS_EMIT_INTERVAL_MS).toBe(30000);
    });

    it("should have correct env var names", () => {
      expect(METRICS_EMIT_INTERVAL_ENV_VAR).toBe("METRICS_EMIT_INTERVAL_MS");
      expect(METRICS_DISABLED_ENV_VAR).toBe("STAGE_METRICS_DISABLED");
    });

    it("should have correct Redis key prefix", () => {
      expect(STAGE_METRICS_KEY_PREFIX).toBe("stage_metrics:");
    });

    it("should have 24-hour TTL for metrics keys", () => {
      expect(STAGE_METRICS_KEY_TTL_SECONDS).toBe(86400);
    });

    it("should have all stage metrics env vars defined", () => {
      expect(STAGE_METRICS_ENV_VARS.EMIT_INTERVAL_MS).toBe("METRICS_EMIT_INTERVAL_MS");
      expect(STAGE_METRICS_ENV_VARS.DISABLED).toBe("STAGE_METRICS_DISABLED");
      expect(STAGE_METRICS_ENV_VARS.DEBUG).toBe("STAGE_METRICS_DEBUG");
    });
  });

  describe("Environment Configuration", () => {
    describe("isStageMetricsDisabled", () => {
      it("should return false when env var is not set", () => {
        expect(isStageMetricsDisabled()).toBe(false);
      });

      it("should return true when env var is 'true'", () => {
        process.env[METRICS_DISABLED_ENV_VAR] = "true";
        expect(isStageMetricsDisabled()).toBe(true);
      });

      it("should return true when env var is '1'", () => {
        process.env[METRICS_DISABLED_ENV_VAR] = "1";
        expect(isStageMetricsDisabled()).toBe(true);
      });

      it("should return false for other values", () => {
        process.env[METRICS_DISABLED_ENV_VAR] = "false";
        expect(isStageMetricsDisabled()).toBe(false);
        process.env[METRICS_DISABLED_ENV_VAR] = "0";
        expect(isStageMetricsDisabled()).toBe(false);
      });
    });

    describe("isStageMetricsDebugEnabled", () => {
      it("should return false when env var is not set", () => {
        expect(isStageMetricsDebugEnabled()).toBe(false);
      });

      it("should return true when env var is 'true'", () => {
        process.env[STAGE_METRICS_ENV_VARS.DEBUG] = "true";
        expect(isStageMetricsDebugEnabled()).toBe(true);
      });

      it("should return true when env var is '1'", () => {
        process.env[STAGE_METRICS_ENV_VARS.DEBUG] = "1";
        expect(isStageMetricsDebugEnabled()).toBe(true);
      });
    });

    describe("getStageMetricsEmitInterval", () => {
      it("should return default when env var is not set", () => {
        expect(getStageMetricsEmitInterval()).toBe(DEFAULT_METRICS_EMIT_INTERVAL_MS);
      });

      it("should return custom value when env var is set", () => {
        process.env[METRICS_EMIT_INTERVAL_ENV_VAR] = "60000";
        expect(getStageMetricsEmitInterval()).toBe(60000);
      });

      it("should return default for invalid values", () => {
        process.env[METRICS_EMIT_INTERVAL_ENV_VAR] = "invalid";
        expect(getStageMetricsEmitInterval()).toBe(DEFAULT_METRICS_EMIT_INTERVAL_MS);
      });

      it("should accept 0 to disable periodic emission", () => {
        process.env[METRICS_EMIT_INTERVAL_ENV_VAR] = "0";
        expect(getStageMetricsEmitInterval()).toBe(0);
      });
    });

    describe("getStageMetricsConfig", () => {
      it("should return default config when no env vars are set", () => {
        const config = getStageMetricsConfig();
        expect(config.enabled).toBe(true);
        expect(config.emitIntervalMs).toBe(DEFAULT_METRICS_EMIT_INTERVAL_MS);
        expect(config.debug).toBe(false);
      });

      it("should reflect disabled state", () => {
        process.env[METRICS_DISABLED_ENV_VAR] = "true";
        const config = getStageMetricsConfig();
        expect(config.enabled).toBe(false);
      });

      it("should reflect custom interval", () => {
        process.env[METRICS_EMIT_INTERVAL_ENV_VAR] = "15000";
        const config = getStageMetricsConfig();
        expect(config.emitIntervalMs).toBe(15000);
      });

      it("should reflect debug enabled", () => {
        process.env[STAGE_METRICS_ENV_VARS.DEBUG] = "true";
        const config = getStageMetricsConfig();
        expect(config.debug).toBe(true);
      });
    });
  });

  describe("Key Building Functions", () => {
    describe("buildStageMetricsKey", () => {
      it("should build correct key for stage metrics", () => {
        const key = buildStageMetricsKey("run-123", IngestionStage.FETCH);
        expect(key).toBe("stage_metrics:run-123:fetch");
      });

      it("should work for all stages", () => {
        Object.values(IngestionStage).forEach(stage => {
          const key = buildStageMetricsKey("run-456", stage);
          expect(key).toBe(`stage_metrics:run-456:${stage}`);
        });
      });
    });

    describe("getStageMetricsKeyTtl", () => {
      it("should return the correct TTL", () => {
        expect(getStageMetricsKeyTtl()).toBe(STAGE_METRICS_KEY_TTL_SECONDS);
      });
    });
  });

  describe("Latency Stats", () => {
    describe("createEmptyLatencyStats", () => {
      it("should create empty latency stats", () => {
        const stats = createEmptyLatencyStats();
        expect(stats.minMs).toBe(Infinity);
        expect(stats.maxMs).toBe(0);
        expect(stats.sumMs).toBe(0);
        expect(stats.count).toBe(0);
        expect(stats.averageMs).toBe(0);
      });
    });

    describe("updateLatencyStats", () => {
      it("should update stats with first sample", () => {
        const initial = createEmptyLatencyStats();
        const updated = updateLatencyStats(initial, 100);
        expect(updated.minMs).toBe(100);
        expect(updated.maxMs).toBe(100);
        expect(updated.sumMs).toBe(100);
        expect(updated.count).toBe(1);
        expect(updated.averageMs).toBe(100);
      });

      it("should correctly track min and max", () => {
        let stats = createEmptyLatencyStats();
        stats = updateLatencyStats(stats, 100);
        stats = updateLatencyStats(stats, 50);
        stats = updateLatencyStats(stats, 200);
        expect(stats.minMs).toBe(50);
        expect(stats.maxMs).toBe(200);
      });

      it("should correctly calculate average", () => {
        let stats = createEmptyLatencyStats();
        stats = updateLatencyStats(stats, 100);
        stats = updateLatencyStats(stats, 200);
        stats = updateLatencyStats(stats, 300);
        expect(stats.averageMs).toBe(200);
        expect(stats.sumMs).toBe(600);
        expect(stats.count).toBe(3);
      });

      it("should handle zero duration", () => {
        let stats = createEmptyLatencyStats();
        stats = updateLatencyStats(stats, 0);
        expect(stats.minMs).toBe(0);
        expect(stats.maxMs).toBe(0);
        expect(stats.averageMs).toBe(0);
      });
    });
  });

  describe("Stage Metrics Data", () => {
    describe("createEmptyStageMetricsData", () => {
      it("should create empty stage metrics data", () => {
        const data = createEmptyStageMetricsData();
        expect(data.completed).toBe(0);
        expect(data.failed).toBe(0);
        expect(data.skipped).toBe(0);
        expect(data.latencyStats.count).toBe(0);
        expect(data.firstItemStartedAt).toBeUndefined();
        expect(data.lastItemCompletedAt).toBeUndefined();
      });
    });

    describe("createRunStageMetricsAccumulator", () => {
      it("should create accumulator with all stages", () => {
        const accumulator = createRunStageMetricsAccumulator(
          "run-123",
          "source-456",
          "tenant-789"
        );
        expect(accumulator.runId).toBe("run-123");
        expect(accumulator.sourceId).toBe("source-456");
        expect(accumulator.tenantId).toBe("tenant-789");
        expect(accumulator.createdAt).toBeDefined();
        expect(accumulator.updatedAt).toBeDefined();

        // Should have all stages
        Object.values(IngestionStage).forEach(stage => {
          expect(accumulator.stages[stage]).toBeDefined();
          expect(accumulator.stages[stage].completed).toBe(0);
        });
      });
    });
  });

  describe("Item Timing", () => {
    describe("createStageItemTiming", () => {
      it("should create timing with duration calculated", () => {
        const startedAt = "2024-01-01T10:00:00.000Z";
        const finishedAt = "2024-01-01T10:00:01.500Z";
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          startedAt,
          finishedAt,
          "completed"
        );

        expect(timing.itemId).toBe("item-1");
        expect(timing.stage).toBe(IngestionStage.FETCH);
        expect(timing.startedAt).toBe(startedAt);
        expect(timing.finishedAt).toBe(finishedAt);
        expect(timing.durationMs).toBe(1500);
        expect(timing.outcome).toBe("completed");
      });

      it("should handle missing finishedAt", () => {
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          undefined,
          "failed"
        );
        expect(timing.finishedAt).toBeUndefined();
        expect(timing.durationMs).toBeUndefined();
      });

      it("should include error code for failed items", () => {
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:05.000Z",
          "failed",
          "NETWORK_TIMEOUT"
        );
        expect(timing.outcome).toBe("failed");
        expect(timing.errorCode).toBe("NETWORK_TIMEOUT");
      });
    });

    describe("recordItemTiming", () => {
      it("should increment completed count", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:01.000Z",
          "completed"
        );

        recordItemTiming(accumulator, timing);
        expect(accumulator.stages[IngestionStage.FETCH].completed).toBe(1);
        expect(accumulator.stages[IngestionStage.FETCH].failed).toBe(0);
        expect(accumulator.stages[IngestionStage.FETCH].skipped).toBe(0);
      });

      it("should increment failed count", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:01.000Z",
          "failed"
        );

        recordItemTiming(accumulator, timing);
        expect(accumulator.stages[IngestionStage.FETCH].failed).toBe(1);
      });

      it("should increment skipped count", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:00.100Z",
          "skipped"
        );

        recordItemTiming(accumulator, timing);
        expect(accumulator.stages[IngestionStage.FETCH].skipped).toBe(1);
      });

      it("should update latency stats", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:01.000Z",
          "completed"
        );

        recordItemTiming(accumulator, timing);
        expect(accumulator.stages[IngestionStage.FETCH].latencyStats.count).toBe(1);
        expect(accumulator.stages[IngestionStage.FETCH].latencyStats.sumMs).toBe(1000);
      });

      it("should track first and last timestamps", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");

        const timing1 = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:01.000Z",
          "completed"
        );
        recordItemTiming(accumulator, timing1);

        const timing2 = createStageItemTiming(
          "item-2",
          IngestionStage.FETCH,
          "2024-01-01T09:59:00.000Z", // Earlier start
          "2024-01-01T10:00:05.000Z", // Later finish
          "completed"
        );
        recordItemTiming(accumulator, timing2);

        const stageData = accumulator.stages[IngestionStage.FETCH];
        expect(stageData.firstItemStartedAt).toBe("2024-01-01T09:59:00.000Z");
        expect(stageData.lastItemCompletedAt).toBe("2024-01-01T10:00:05.000Z");
      });
    });
  });

  describe("Metrics Calculation", () => {
    describe("calculateThroughputMetrics", () => {
      it("should calculate correct throughput metrics", () => {
        const data: StageMetricsData = {
          completed: 80,
          failed: 10,
          skipped: 10,
          latencyStats: createEmptyLatencyStats(),
          firstItemStartedAt: "2024-01-01T10:00:00.000Z",
          lastItemCompletedAt: "2024-01-01T10:00:10.000Z",
        };

        // 10 seconds = 10000ms
        const metrics = calculateThroughputMetrics(IngestionStage.FETCH, data, 10000);

        expect(metrics.stage).toBe(IngestionStage.FETCH);
        expect(metrics.itemsCompleted).toBe(80);
        expect(metrics.itemsFailed).toBe(10);
        expect(metrics.itemsSkipped).toBe(10);
        expect(metrics.totalItems).toBe(100);
        expect(metrics.successRate).toBe(80); // 80%
        expect(metrics.throughputPerSecond).toBe(8); // 80 items / 10 seconds
      });

      it("should handle zero items", () => {
        const data = createEmptyStageMetricsData();
        const metrics = calculateThroughputMetrics(IngestionStage.FETCH, data, 1000);

        expect(metrics.totalItems).toBe(0);
        expect(metrics.successRate).toBe(0);
        expect(metrics.throughputPerSecond).toBe(0);
      });

      it("should handle missing wall clock duration", () => {
        const data: StageMetricsData = {
          completed: 10,
          failed: 0,
          skipped: 0,
          latencyStats: createEmptyLatencyStats(),
        };

        const metrics = calculateThroughputMetrics(IngestionStage.FETCH, data, undefined);
        expect(metrics.throughputPerSecond).toBe(0);
      });
    });

    describe("calculateLatencyMetrics", () => {
      it("should calculate correct latency metrics", () => {
        let latencyStats = createEmptyLatencyStats();
        latencyStats = updateLatencyStats(latencyStats, 100);
        latencyStats = updateLatencyStats(latencyStats, 200);
        latencyStats = updateLatencyStats(latencyStats, 300);

        const data: StageMetricsData = {
          completed: 3,
          failed: 0,
          skipped: 0,
          latencyStats,
        };

        const metrics = calculateLatencyMetrics(IngestionStage.FETCH, data);

        expect(metrics.stage).toBe(IngestionStage.FETCH);
        expect(metrics.minLatencyMs).toBe(100);
        expect(metrics.maxLatencyMs).toBe(300);
        expect(metrics.averageLatencyMs).toBe(200);
        expect(metrics.totalDurationMs).toBe(600);
        expect(metrics.sampleCount).toBe(3);
      });

      it("should return zeros for empty data", () => {
        const data = createEmptyStageMetricsData();
        const metrics = calculateLatencyMetrics(IngestionStage.FETCH, data);

        expect(metrics.minLatencyMs).toBe(0);
        expect(metrics.maxLatencyMs).toBe(0);
        expect(metrics.averageLatencyMs).toBe(0);
        expect(metrics.sampleCount).toBe(0);
      });
    });

    describe("calculateStageMetrics", () => {
      it("should calculate combined metrics", () => {
        let latencyStats = createEmptyLatencyStats();
        latencyStats = updateLatencyStats(latencyStats, 1000);
        latencyStats = updateLatencyStats(latencyStats, 2000);

        const data: StageMetricsData = {
          completed: 2,
          failed: 0,
          skipped: 0,
          latencyStats,
          firstItemStartedAt: "2024-01-01T10:00:00.000Z",
          lastItemCompletedAt: "2024-01-01T10:00:05.000Z",
        };

        const metrics = calculateStageMetrics(IngestionStage.FETCH, data);

        expect(metrics.stage).toBe(IngestionStage.FETCH);
        expect(metrics.throughput.itemsCompleted).toBe(2);
        expect(metrics.latency.averageLatencyMs).toBe(1500);
        expect(metrics.wallClockDurationMs).toBe(5000);
        expect(metrics.firstItemStartedAt).toBe("2024-01-01T10:00:00.000Z");
        expect(metrics.lastItemCompletedAt).toBe("2024-01-01T10:00:05.000Z");
      });
    });
  });

  describe("Snapshots and Summaries", () => {
    describe("createStageMetricsSnapshot", () => {
      it("should create snapshot from accumulator", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");

        const timing = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:01.000Z",
          "completed"
        );
        recordItemTiming(accumulator, timing);

        const snapshot = createStageMetricsSnapshot(accumulator, IngestionStage.FETCH, false);

        expect(snapshot.runId).toBe("run-1");
        expect(snapshot.sourceId).toBe("src-1");
        expect(snapshot.tenantId).toBe("tenant-1");
        expect(snapshot.stage).toBe(IngestionStage.FETCH);
        expect(snapshot.isFinal).toBe(false);
        expect(snapshot.metrics.throughput.itemsCompleted).toBe(1);
        expect(snapshot.timestamp).toBeDefined();
      });

      it("should create final snapshot", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        const snapshot = createStageMetricsSnapshot(accumulator, IngestionStage.FETCH, true);
        expect(snapshot.isFinal).toBe(true);
      });
    });

    describe("createRunMetricsSummary", () => {
      it("should create run summary from accumulator", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");

        // Add discover stage data
        const discoverTiming = createStageItemTiming(
          "item-1",
          IngestionStage.DISCOVER,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:01.000Z",
          "completed"
        );
        recordItemTiming(accumulator, discoverTiming);

        // Add fetch stage data
        const fetchTiming = createStageItemTiming(
          "item-1",
          IngestionStage.FETCH,
          "2024-01-01T10:00:01.000Z",
          "2024-01-01T10:00:03.000Z",
          "completed"
        );
        recordItemTiming(accumulator, fetchTiming);

        const summary = createRunMetricsSummary(
          accumulator,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:10.000Z"
        );

        expect(summary.runId).toBe("run-1");
        expect(summary.sourceId).toBe("src-1");
        expect(summary.tenantId).toBe("tenant-1");
        expect(summary.runStartedAt).toBe("2024-01-01T10:00:00.000Z");
        expect(summary.runFinishedAt).toBe("2024-01-01T10:00:10.000Z");
        expect(summary.runDurationMs).toBe(10000);
        expect(summary.stages[IngestionStage.DISCOVER]).toBeDefined();
        expect(summary.stages[IngestionStage.FETCH]).toBeDefined();
        expect(summary.overall.totalItemsCompleted).toBe(1);
        expect(summary.overall.overallSuccessRate).toBe(100);
      });

      it("should identify critical path by latency", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");

        // Add fast discover (100ms)
        recordItemTiming(accumulator, createStageItemTiming(
          "item-1", IngestionStage.DISCOVER,
          "2024-01-01T10:00:00.000Z", "2024-01-01T10:00:00.100Z", "completed"
        ));

        // Add slow embed (5000ms)
        recordItemTiming(accumulator, createStageItemTiming(
          "item-1", IngestionStage.EMBED,
          "2024-01-01T10:00:01.000Z", "2024-01-01T10:00:06.000Z", "completed"
        ));

        // Add medium fetch (1000ms)
        recordItemTiming(accumulator, createStageItemTiming(
          "item-1", IngestionStage.FETCH,
          "2024-01-01T10:00:00.500Z", "2024-01-01T10:00:01.500Z", "completed"
        ));

        const summary = createRunMetricsSummary(accumulator);

        // Critical path should be sorted by latency (highest first)
        expect(summary.overall.criticalPath[0]).toBe(IngestionStage.EMBED);
      });
    });
  });

  describe("Logging", () => {
    describe("createStageMetricsLog", () => {
      it("should create log entry from snapshot", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        recordItemTiming(accumulator, createStageItemTiming(
          "item-1", IngestionStage.FETCH,
          "2024-01-01T10:00:00.000Z", "2024-01-01T10:00:01.000Z", "completed"
        ));

        const snapshot = createStageMetricsSnapshot(accumulator, IngestionStage.FETCH, true);
        const log = createStageMetricsLog(snapshot);

        expect(log.event).toBe("stage_metrics");
        expect(log.stage).toBe(IngestionStage.FETCH);
        expect(log.runId).toBe("run-1");
        expect(log.sourceId).toBe("src-1");
        expect(log.tenantId).toBe("tenant-1");
        expect(log.isFinal).toBe(true);
        expect(log.itemsCompleted).toBe(1);
        expect(log.totalItems).toBe(1);
        expect(log.successRate).toBe(100);
      });
    });

    describe("formatStageMetricsLog", () => {
      it("should format log for human readability", () => {
        const log: StageMetricsLog = {
          event: "stage_metrics",
          stage: IngestionStage.FETCH,
          runId: "run-1",
          sourceId: "src-1",
          tenantId: "tenant-1",
          timestamp: "2024-01-01T10:00:00.000Z",
          isFinal: true,
          itemsCompleted: 80,
          itemsFailed: 10,
          itemsSkipped: 10,
          totalItems: 100,
          successRate: 80,
          throughputPerSecond: 8,
          minLatencyMs: 100,
          maxLatencyMs: 5000,
          averageLatencyMs: 1500,
          totalDurationMs: 150000,
          wallClockDurationMs: 12500,
        };

        const formatted = formatStageMetricsLog(log);

        expect(formatted).toContain("[FETCH]");
        expect(formatted).toContain("(final)");
        expect(formatted).toContain("items=100");
        expect(formatted).toContain("completed=80");
        expect(formatted).toContain("failed=10");
        expect(formatted).toContain("skipped=10");
        expect(formatted).toContain("success=80.0%");
        expect(formatted).toContain("throughput=8.00/s");
        expect(formatted).toContain("latency_avg=1500ms");
        expect(formatted).toContain("wall_clock=12500ms");
      });

      it("should show interim status", () => {
        const log: StageMetricsLog = {
          event: "stage_metrics",
          stage: IngestionStage.FETCH,
          runId: "run-1",
          sourceId: "src-1",
          tenantId: "tenant-1",
          timestamp: "2024-01-01T10:00:00.000Z",
          isFinal: false,
          itemsCompleted: 50,
          itemsFailed: 5,
          itemsSkipped: 0,
          totalItems: 55,
          successRate: 90.91,
          throughputPerSecond: 5,
          minLatencyMs: 100,
          maxLatencyMs: 2000,
          averageLatencyMs: 500,
          totalDurationMs: 25000,
        };

        const formatted = formatStageMetricsLog(log);
        expect(formatted).toContain("(interim)");
      });
    });

    describe("createStructuredRunMetricsLog", () => {
      it("should create JSON-compatible log object", () => {
        const accumulator = createRunStageMetricsAccumulator("run-1", "src-1", "tenant-1");
        recordItemTiming(accumulator, createStageItemTiming(
          "item-1", IngestionStage.DISCOVER,
          "2024-01-01T10:00:00.000Z", "2024-01-01T10:00:01.000Z", "completed"
        ));

        const summary = createRunMetricsSummary(
          accumulator,
          "2024-01-01T10:00:00.000Z",
          "2024-01-01T10:00:10.000Z"
        );
        const log = createStructuredRunMetricsLog(summary);

        expect(log.event).toBe("run_metrics_summary");
        expect(log.runId).toBe("run-1");
        expect(log.runDurationMs).toBe(10000);
        expect(log.stages).toBeDefined();
        expect(typeof log.stages).toBe("object");
      });
    });
  });

  describe("Merging", () => {
    describe("mergeStageMetricsData", () => {
      it("should merge counts correctly", () => {
        const a: StageMetricsData = {
          completed: 10,
          failed: 2,
          skipped: 1,
          latencyStats: createEmptyLatencyStats(),
        };
        const b: StageMetricsData = {
          completed: 20,
          failed: 3,
          skipped: 2,
          latencyStats: createEmptyLatencyStats(),
        };

        const merged = mergeStageMetricsData(a, b);
        expect(merged.completed).toBe(30);
        expect(merged.failed).toBe(5);
        expect(merged.skipped).toBe(3);
      });

      it("should merge latency stats correctly", () => {
        let aStats = createEmptyLatencyStats();
        aStats = updateLatencyStats(aStats, 100);
        aStats = updateLatencyStats(aStats, 200);

        let bStats = createEmptyLatencyStats();
        bStats = updateLatencyStats(bStats, 50);
        bStats = updateLatencyStats(bStats, 300);

        const a: StageMetricsData = {
          completed: 2,
          failed: 0,
          skipped: 0,
          latencyStats: aStats,
        };
        const b: StageMetricsData = {
          completed: 2,
          failed: 0,
          skipped: 0,
          latencyStats: bStats,
        };

        const merged = mergeStageMetricsData(a, b);
        expect(merged.latencyStats.minMs).toBe(50);
        expect(merged.latencyStats.maxMs).toBe(300);
        expect(merged.latencyStats.count).toBe(4);
        expect(merged.latencyStats.sumMs).toBe(650);
        expect(merged.latencyStats.averageMs).toBe(162.5);
      });

      it("should merge timestamps correctly", () => {
        const a: StageMetricsData = {
          completed: 1,
          failed: 0,
          skipped: 0,
          latencyStats: createEmptyLatencyStats(),
          firstItemStartedAt: "2024-01-01T10:00:00.000Z",
          lastItemCompletedAt: "2024-01-01T10:00:05.000Z",
        };
        const b: StageMetricsData = {
          completed: 1,
          failed: 0,
          skipped: 0,
          latencyStats: createEmptyLatencyStats(),
          firstItemStartedAt: "2024-01-01T09:59:00.000Z", // Earlier
          lastItemCompletedAt: "2024-01-01T10:00:10.000Z", // Later
        };

        const merged = mergeStageMetricsData(a, b);
        expect(merged.firstItemStartedAt).toBe("2024-01-01T09:59:00.000Z");
        expect(merged.lastItemCompletedAt).toBe("2024-01-01T10:00:10.000Z");
      });

      it("should handle empty data on one side", () => {
        const a = createEmptyStageMetricsData();
        const b: StageMetricsData = {
          completed: 5,
          failed: 1,
          skipped: 0,
          latencyStats: updateLatencyStats(createEmptyLatencyStats(), 100),
          firstItemStartedAt: "2024-01-01T10:00:00.000Z",
          lastItemCompletedAt: "2024-01-01T10:00:01.000Z",
        };

        const merged = mergeStageMetricsData(a, b);
        expect(merged.completed).toBe(5);
        expect(merged.latencyStats.minMs).toBe(100);
        expect(merged.firstItemStartedAt).toBe("2024-01-01T10:00:00.000Z");
      });
    });
  });

  describe("Serialization", () => {
    describe("serializeStageMetricsData", () => {
      it("should serialize to JSON string", () => {
        const data: StageMetricsData = {
          completed: 10,
          failed: 2,
          skipped: 1,
          latencyStats: updateLatencyStats(createEmptyLatencyStats(), 100),
          firstItemStartedAt: "2024-01-01T10:00:00.000Z",
          lastItemCompletedAt: "2024-01-01T10:00:01.000Z",
        };

        const json = serializeStageMetricsData(data);
        expect(typeof json).toBe("string");

        const parsed = JSON.parse(json);
        expect(parsed.completed).toBe(10);
        expect(parsed.failed).toBe(2);
        expect(parsed.skipped).toBe(1);
      });
    });

    describe("deserializeStageMetricsData", () => {
      it("should deserialize valid JSON", () => {
        const original: StageMetricsData = {
          completed: 10,
          failed: 2,
          skipped: 1,
          latencyStats: {
            minMs: 100,
            maxMs: 200,
            sumMs: 300,
            count: 2,
            averageMs: 150,
          },
        };

        const json = JSON.stringify(original);
        const deserialized = deserializeStageMetricsData(json);

        expect(deserialized).toBeDefined();
        expect(deserialized!.completed).toBe(10);
        expect(deserialized!.failed).toBe(2);
        expect(deserialized!.latencyStats.averageMs).toBe(150);
      });

      it("should return undefined for invalid JSON", () => {
        const result = deserializeStageMetricsData("invalid json");
        expect(result).toBeUndefined();
      });

      it("should return undefined for missing required fields", () => {
        const result = deserializeStageMetricsData(JSON.stringify({ foo: "bar" }));
        expect(result).toBeUndefined();
      });
    });

    it("should round-trip serialize/deserialize", () => {
      const original: StageMetricsData = {
        completed: 100,
        failed: 10,
        skipped: 5,
        latencyStats: {
          minMs: 50,
          maxMs: 5000,
          sumMs: 115000,
          count: 115,
          averageMs: 1000,
        },
        firstItemStartedAt: "2024-01-01T10:00:00.000Z",
        lastItemCompletedAt: "2024-01-01T10:05:00.000Z",
      };

      const json = serializeStageMetricsData(original);
      const restored = deserializeStageMetricsData(json);

      expect(restored).toEqual(original);
    });
  });

  describe("Interface Compliance", () => {
    it("StageLatencyStats should have all required fields", () => {
      const stats: StageLatencyStats = {
        minMs: 100,
        maxMs: 500,
        sumMs: 1200,
        count: 4,
        averageMs: 300,
      };
      expect(stats).toBeDefined();
    });

    it("StageThroughputMetrics should have all required fields", () => {
      const metrics: StageThroughputMetrics = {
        stage: IngestionStage.FETCH,
        itemsCompleted: 100,
        itemsFailed: 10,
        itemsSkipped: 5,
        totalItems: 115,
        successRate: 86.96,
        throughputPerSecond: 10,
      };
      expect(metrics).toBeDefined();
    });

    it("StageMetricsConfig should have all required fields", () => {
      const config: StageMetricsConfig = {
        enabled: true,
        emitIntervalMs: 30000,
        debug: false,
      };
      expect(config).toBeDefined();
    });

    it("StageItemTiming should work with all outcomes", () => {
      const completed: StageItemTiming = {
        itemId: "1",
        stage: IngestionStage.FETCH,
        startedAt: "2024-01-01T10:00:00.000Z",
        finishedAt: "2024-01-01T10:00:01.000Z",
        durationMs: 1000,
        outcome: "completed",
      };
      expect(completed.outcome).toBe("completed");

      const failed: StageItemTiming = {
        itemId: "2",
        stage: IngestionStage.FETCH,
        startedAt: "2024-01-01T10:00:00.000Z",
        outcome: "failed",
        errorCode: "TIMEOUT",
      };
      expect(failed.outcome).toBe("failed");

      const skipped: StageItemTiming = {
        itemId: "3",
        stage: IngestionStage.FETCH,
        startedAt: "2024-01-01T10:00:00.000Z",
        outcome: "skipped",
      };
      expect(skipped.outcome).toBe("skipped");
    });
  });

  describe("Integration Tests", () => {
    it("should handle a complete pipeline processing scenario", () => {
      const accumulator = createRunStageMetricsAccumulator("run-123", "src-456", "tenant-789");

      // Simulate processing 5 items through the pipeline
      const items = ["page-1", "page-2", "page-3", "page-4", "page-5"];
      const baseTime = new Date("2024-01-01T10:00:00.000Z").getTime();

      items.forEach((itemId, index) => {
        const offset = index * 1000;

        // Discover stage (100ms each)
        recordItemTiming(accumulator, createStageItemTiming(
          itemId, IngestionStage.DISCOVER,
          new Date(baseTime + offset).toISOString(),
          new Date(baseTime + offset + 100).toISOString(),
          "completed"
        ));

        // Fetch stage (500-1500ms each)
        const fetchDuration = 500 + (index * 250);
        recordItemTiming(accumulator, createStageItemTiming(
          itemId, IngestionStage.FETCH,
          new Date(baseTime + offset + 100).toISOString(),
          new Date(baseTime + offset + 100 + fetchDuration).toISOString(),
          index === 2 ? "failed" : "completed", // page-3 fails
          index === 2 ? "NETWORK_TIMEOUT" : undefined
        ));

        // Extract stage (200ms each, skip failed fetches)
        if (index !== 2) {
          recordItemTiming(accumulator, createStageItemTiming(
            itemId, IngestionStage.EXTRACT,
            new Date(baseTime + offset + 2000).toISOString(),
            new Date(baseTime + offset + 2200).toISOString(),
            "completed"
          ));
        }
      });

      // Create summary
      const summary = createRunMetricsSummary(
        accumulator,
        new Date(baseTime).toISOString(),
        new Date(baseTime + 10000).toISOString()
      );

      // Verify discover stage
      expect(summary.stages[IngestionStage.DISCOVER]?.throughput.itemsCompleted).toBe(5);
      expect(summary.stages[IngestionStage.DISCOVER]?.latency.averageLatencyMs).toBe(100);

      // Verify fetch stage (1 failed)
      expect(summary.stages[IngestionStage.FETCH]?.throughput.itemsCompleted).toBe(4);
      expect(summary.stages[IngestionStage.FETCH]?.throughput.itemsFailed).toBe(1);
      expect(summary.stages[IngestionStage.FETCH]?.throughput.successRate).toBe(80);

      // Verify extract stage (4 items, skipped the failed fetch)
      expect(summary.stages[IngestionStage.EXTRACT]?.throughput.itemsCompleted).toBe(4);

      // Verify overall stats from discover stage
      expect(summary.overall.totalItemsCompleted).toBe(5);
      expect(summary.overall.overallSuccessRate).toBe(100);

      // Verify run duration
      expect(summary.runDurationMs).toBe(10000);
    });

    it("should handle concurrent worker scenarios with merge", () => {
      // Simulate data from worker 1
      let worker1Stats = createEmptyLatencyStats();
      worker1Stats = updateLatencyStats(worker1Stats, 100);
      worker1Stats = updateLatencyStats(worker1Stats, 200);

      const worker1Data: StageMetricsData = {
        completed: 50,
        failed: 5,
        skipped: 2,
        latencyStats: worker1Stats,
        firstItemStartedAt: "2024-01-01T10:00:00.000Z",
        lastItemCompletedAt: "2024-01-01T10:00:30.000Z",
      };

      // Simulate data from worker 2
      let worker2Stats = createEmptyLatencyStats();
      worker2Stats = updateLatencyStats(worker2Stats, 150);
      worker2Stats = updateLatencyStats(worker2Stats, 250);

      const worker2Data: StageMetricsData = {
        completed: 45,
        failed: 8,
        skipped: 3,
        latencyStats: worker2Stats,
        firstItemStartedAt: "2024-01-01T10:00:05.000Z", // Started later
        lastItemCompletedAt: "2024-01-01T10:00:35.000Z", // Finished later
      };

      // Merge the data
      const merged = mergeStageMetricsData(worker1Data, worker2Data);

      expect(merged.completed).toBe(95);
      expect(merged.failed).toBe(13);
      expect(merged.skipped).toBe(5);
      expect(merged.latencyStats.count).toBe(4);
      expect(merged.latencyStats.minMs).toBe(100);
      expect(merged.latencyStats.maxMs).toBe(250);
      expect(merged.firstItemStartedAt).toBe("2024-01-01T10:00:00.000Z"); // Earliest
      expect(merged.lastItemCompletedAt).toBe("2024-01-01T10:00:35.000Z"); // Latest
    });
  });
});
