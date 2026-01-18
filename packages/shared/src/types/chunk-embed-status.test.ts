import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ChunkEmbedStatus,
  ChunkEmbedStatusRecord,
  ChunkEmbedStatusSummary,
  EmbedCompletionGatingConfig,
  EmbedCompletionCheckResult,
  buildChunkEmbedStatusKey,
  buildChunkEmbedFailedSetKey,
  createPendingChunkEmbedStatus,
  createInProgressChunkEmbedStatus,
  createSucceededChunkEmbedStatus,
  createFailedChunkEmbedStatus,
  calculateChunkEmbedStatusSummary,
  isChunkEmbedInProgress,
  isChunkEmbedTerminal,
  isChunkEmbedFailed,
  determineRunStatusFromEmbedding,
  getChunkEmbedStatusKeyTtl,
  getDefaultEmbedCompletionGatingConfig,
  resolveEmbedCompletionGatingConfig,
  CHUNK_EMBED_STATUS_KEY_PREFIX,
  CHUNK_EMBED_STATUS_KEY_TTL_SECONDS,
  CHUNK_EMBED_FAILED_SET_KEY_PREFIX,
  DEFAULT_EMBED_COMPLETION_WAIT_MS,
  EMBED_COMPLETION_CHECK_INTERVAL_MS,
} from "./index";

describe("ChunkEmbedStatus", () => {
  describe("ChunkEmbedStatus enum", () => {
    it("should have all expected status values", () => {
      expect(ChunkEmbedStatus.PENDING).toBe("pending");
      expect(ChunkEmbedStatus.IN_PROGRESS).toBe("in_progress");
      expect(ChunkEmbedStatus.SUCCEEDED).toBe("succeeded");
      expect(ChunkEmbedStatus.FAILED_RETRYABLE).toBe("failed_retryable");
      expect(ChunkEmbedStatus.FAILED_PERMANENT).toBe("failed_permanent");
    });

    it("should have exactly 5 status values", () => {
      const values = Object.values(ChunkEmbedStatus);
      expect(values.length).toBe(5);
    });
  });

  describe("Constants", () => {
    it("should have correct key prefix", () => {
      expect(CHUNK_EMBED_STATUS_KEY_PREFIX).toBe("chunk_embed_status:");
    });

    it("should have correct TTL (24 hours)", () => {
      expect(CHUNK_EMBED_STATUS_KEY_TTL_SECONDS).toBe(86400);
    });

    it("should have correct failed set key prefix", () => {
      expect(CHUNK_EMBED_FAILED_SET_KEY_PREFIX).toBe("chunk_embed_failed:");
    });

    it("should have correct default wait time (30 seconds)", () => {
      expect(DEFAULT_EMBED_COMPLETION_WAIT_MS).toBe(30000);
    });

    it("should have correct check interval (2 seconds)", () => {
      expect(EMBED_COMPLETION_CHECK_INTERVAL_MS).toBe(2000);
    });
  });

  describe("buildChunkEmbedStatusKey", () => {
    it("should build correct key format", () => {
      const key = buildChunkEmbedStatusKey("run-123", "chunk-456");
      expect(key).toBe("chunk_embed_status:run-123:chunk-456");
    });

    it("should handle UUID format IDs", () => {
      const runId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
      const chunkId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const key = buildChunkEmbedStatusKey(runId, chunkId);
      expect(key).toBe(`chunk_embed_status:${runId}:${chunkId}`);
    });
  });

  describe("buildChunkEmbedFailedSetKey", () => {
    it("should build correct key format", () => {
      const key = buildChunkEmbedFailedSetKey("run-123");
      expect(key).toBe("chunk_embed_failed:run-123");
    });
  });

  describe("createPendingChunkEmbedStatus", () => {
    it("should create a pending status record", () => {
      const record = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");

      expect(record.chunkId).toBe("chunk-1");
      expect(record.runId).toBe("run-1");
      expect(record.kbId).toBe("kb-1");
      expect(record.status).toBe(ChunkEmbedStatus.PENDING);
      expect(record.attemptCount).toBe(0);
      expect(record.updatedAt).toBeDefined();
    });

    it("should have ISO timestamp format", () => {
      const record = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      expect(() => new Date(record.updatedAt)).not.toThrow();
    });
  });

  describe("createInProgressChunkEmbedStatus", () => {
    it("should update status to in_progress", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const inProgress = createInProgressChunkEmbedStatus(pending);

      expect(inProgress.status).toBe(ChunkEmbedStatus.IN_PROGRESS);
      expect(inProgress.chunkId).toBe("chunk-1");
      expect(inProgress.runId).toBe("run-1");
      expect(inProgress.kbId).toBe("kb-1");
    });

    it("should increment attempt count", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      expect(pending.attemptCount).toBe(0);

      const inProgress = createInProgressChunkEmbedStatus(pending);
      expect(inProgress.attemptCount).toBe(1);
    });

    it("should update timestamp", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const inProgress = createInProgressChunkEmbedStatus(pending);

      expect(new Date(inProgress.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(pending.updatedAt).getTime()
      );
    });
  });

  describe("createSucceededChunkEmbedStatus", () => {
    it("should update status to succeeded with dimensions", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const inProgress = createInProgressChunkEmbedStatus(pending);
      const succeeded = createSucceededChunkEmbedStatus(inProgress, 1536);

      expect(succeeded.status).toBe(ChunkEmbedStatus.SUCCEEDED);
      expect(succeeded.dimensions).toBe(1536);
    });

    it("should clear error fields on success", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const failed = createFailedChunkEmbedStatus(pending, "test error", "TEST_ERR", true);
      const succeeded = createSucceededChunkEmbedStatus(failed, 768);

      expect(succeeded.error).toBeUndefined();
      expect(succeeded.errorCode).toBeUndefined();
      expect(succeeded.errorRetryable).toBeUndefined();
    });
  });

  describe("createFailedChunkEmbedStatus", () => {
    it("should create retryable failure", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const failed = createFailedChunkEmbedStatus(
        pending,
        "Connection timeout",
        "NETWORK_TIMEOUT",
        true
      );

      expect(failed.status).toBe(ChunkEmbedStatus.FAILED_RETRYABLE);
      expect(failed.error).toBe("Connection timeout");
      expect(failed.errorCode).toBe("NETWORK_TIMEOUT");
      expect(failed.errorRetryable).toBe(true);
    });

    it("should create permanent failure", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const failed = createFailedChunkEmbedStatus(
        pending,
        "Dimension mismatch",
        "CONFIG_DIMENSION_MISMATCH",
        false
      );

      expect(failed.status).toBe(ChunkEmbedStatus.FAILED_PERMANENT);
      expect(failed.error).toBe("Dimension mismatch");
      expect(failed.errorCode).toBe("CONFIG_DIMENSION_MISMATCH");
      expect(failed.errorRetryable).toBe(false);
    });

    it("should default to permanent failure when retryable is undefined", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const failed = createFailedChunkEmbedStatus(pending, "Unknown error");

      expect(failed.status).toBe(ChunkEmbedStatus.FAILED_PERMANENT);
    });
  });

  describe("calculateChunkEmbedStatusSummary", () => {
    const createRecordsWithStatuses = (
      statuses: ChunkEmbedStatus[]
    ): ChunkEmbedStatusRecord[] => {
      return statuses.map((status, i) => ({
        chunkId: `chunk-${i}`,
        status,
        runId: "run-1",
        kbId: "kb-1",
        updatedAt: new Date().toISOString(),
      }));
    };

    it("should correctly count each status type", () => {
      const records = createRecordsWithStatuses([
        ChunkEmbedStatus.PENDING,
        ChunkEmbedStatus.PENDING,
        ChunkEmbedStatus.IN_PROGRESS,
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.FAILED_RETRYABLE,
        ChunkEmbedStatus.FAILED_PERMANENT,
        ChunkEmbedStatus.FAILED_PERMANENT,
      ]);

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.total).toBe(9);
      expect(summary.pending).toBe(2);
      expect(summary.inProgress).toBe(1);
      expect(summary.succeeded).toBe(3);
      expect(summary.failedRetryable).toBe(1);
      expect(summary.failedPermanent).toBe(2);
    });

    it("should mark incomplete when there are pending chunks", () => {
      const records = createRecordsWithStatuses([
        ChunkEmbedStatus.PENDING,
        ChunkEmbedStatus.SUCCEEDED,
      ]);

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.isComplete).toBe(false);
      expect(summary.allSucceeded).toBe(false);
    });

    it("should mark incomplete when there are in-progress chunks", () => {
      const records = createRecordsWithStatuses([
        ChunkEmbedStatus.IN_PROGRESS,
        ChunkEmbedStatus.SUCCEEDED,
      ]);

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.isComplete).toBe(false);
    });

    it("should mark complete when all chunks have terminal status", () => {
      const records = createRecordsWithStatuses([
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.FAILED_PERMANENT,
      ]);

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.isComplete).toBe(true);
      expect(summary.allSucceeded).toBe(false);
      expect(summary.hasFailures).toBe(true);
    });

    it("should mark allSucceeded when all chunks succeeded", () => {
      const records = createRecordsWithStatuses([
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.SUCCEEDED,
      ]);

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.isComplete).toBe(true);
      expect(summary.allSucceeded).toBe(true);
      expect(summary.hasFailures).toBe(false);
    });

    it("should track failed chunk IDs", () => {
      const records = createRecordsWithStatuses([
        ChunkEmbedStatus.SUCCEEDED,
        ChunkEmbedStatus.FAILED_RETRYABLE,
        ChunkEmbedStatus.FAILED_PERMANENT,
      ]);

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.failedChunkIds).toContain("chunk-1");
      expect(summary.failedChunkIds).toContain("chunk-2");
      expect(summary.failedChunkIds?.length).toBe(2);
    });

    it("should handle empty records array", () => {
      const summary = calculateChunkEmbedStatusSummary([]);

      expect(summary.total).toBe(0);
      expect(summary.isComplete).toBe(false);
      expect(summary.allSucceeded).toBe(false);
    });
  });

  describe("isChunkEmbedInProgress", () => {
    it("should return true for pending status", () => {
      expect(isChunkEmbedInProgress(ChunkEmbedStatus.PENDING)).toBe(true);
    });

    it("should return true for in_progress status", () => {
      expect(isChunkEmbedInProgress(ChunkEmbedStatus.IN_PROGRESS)).toBe(true);
    });

    it("should return false for succeeded status", () => {
      expect(isChunkEmbedInProgress(ChunkEmbedStatus.SUCCEEDED)).toBe(false);
    });

    it("should return false for failed statuses", () => {
      expect(isChunkEmbedInProgress(ChunkEmbedStatus.FAILED_RETRYABLE)).toBe(false);
      expect(isChunkEmbedInProgress(ChunkEmbedStatus.FAILED_PERMANENT)).toBe(false);
    });
  });

  describe("isChunkEmbedTerminal", () => {
    it("should return true for succeeded status", () => {
      expect(isChunkEmbedTerminal(ChunkEmbedStatus.SUCCEEDED)).toBe(true);
    });

    it("should return true for failed_permanent status", () => {
      expect(isChunkEmbedTerminal(ChunkEmbedStatus.FAILED_PERMANENT)).toBe(true);
    });

    it("should return false for pending status", () => {
      expect(isChunkEmbedTerminal(ChunkEmbedStatus.PENDING)).toBe(false);
    });

    it("should return false for in_progress status", () => {
      expect(isChunkEmbedTerminal(ChunkEmbedStatus.IN_PROGRESS)).toBe(false);
    });

    it("should return false for failed_retryable status", () => {
      expect(isChunkEmbedTerminal(ChunkEmbedStatus.FAILED_RETRYABLE)).toBe(false);
    });
  });

  describe("isChunkEmbedFailed", () => {
    it("should return true for failed_retryable status", () => {
      expect(isChunkEmbedFailed(ChunkEmbedStatus.FAILED_RETRYABLE)).toBe(true);
    });

    it("should return true for failed_permanent status", () => {
      expect(isChunkEmbedFailed(ChunkEmbedStatus.FAILED_PERMANENT)).toBe(true);
    });

    it("should return false for succeeded status", () => {
      expect(isChunkEmbedFailed(ChunkEmbedStatus.SUCCEEDED)).toBe(false);
    });

    it("should return false for pending status", () => {
      expect(isChunkEmbedFailed(ChunkEmbedStatus.PENDING)).toBe(false);
    });

    it("should return false for in_progress status", () => {
      expect(isChunkEmbedFailed(ChunkEmbedStatus.IN_PROGRESS)).toBe(false);
    });
  });

  describe("determineRunStatusFromEmbedding", () => {
    it("should return embedding_incomplete when not complete", () => {
      const summary: ChunkEmbedStatusSummary = {
        total: 10,
        pending: 3,
        inProgress: 2,
        succeeded: 5,
        failedRetryable: 0,
        failedPermanent: 0,
        isComplete: false,
        allSucceeded: false,
        hasFailures: false,
      };

      expect(determineRunStatusFromEmbedding(summary, false)).toBe("embedding_incomplete");
    });

    it("should return succeeded when all embeddings complete with no failures", () => {
      const summary: ChunkEmbedStatusSummary = {
        total: 10,
        pending: 0,
        inProgress: 0,
        succeeded: 10,
        failedRetryable: 0,
        failedPermanent: 0,
        isComplete: true,
        allSucceeded: true,
        hasFailures: false,
      };

      expect(determineRunStatusFromEmbedding(summary, false)).toBe("succeeded");
    });

    it("should return partial when there are embedding failures", () => {
      const summary: ChunkEmbedStatusSummary = {
        total: 10,
        pending: 0,
        inProgress: 0,
        succeeded: 8,
        failedRetryable: 0,
        failedPermanent: 2,
        isComplete: true,
        allSucceeded: false,
        hasFailures: true,
      };

      expect(determineRunStatusFromEmbedding(summary, false)).toBe("partial");
    });

    it("should return partial when there are page failures", () => {
      const summary: ChunkEmbedStatusSummary = {
        total: 10,
        pending: 0,
        inProgress: 0,
        succeeded: 10,
        failedRetryable: 0,
        failedPermanent: 0,
        isComplete: true,
        allSucceeded: true,
        hasFailures: false,
      };

      expect(determineRunStatusFromEmbedding(summary, true)).toBe("partial");
    });
  });

  describe("getChunkEmbedStatusKeyTtl", () => {
    it("should return the correct TTL value", () => {
      expect(getChunkEmbedStatusKeyTtl()).toBe(CHUNK_EMBED_STATUS_KEY_TTL_SECONDS);
    });
  });

  describe("getDefaultEmbedCompletionGatingConfig", () => {
    it("should return default configuration", () => {
      const config = getDefaultEmbedCompletionGatingConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxWaitMs).toBe(DEFAULT_EMBED_COMPLETION_WAIT_MS);
      expect(config.checkIntervalMs).toBe(EMBED_COMPLETION_CHECK_INTERVAL_MS);
    });
  });

  describe("resolveEmbedCompletionGatingConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return default config when no env vars set", () => {
      const config = resolveEmbedCompletionGatingConfig();

      expect(config.enabled).toBe(true);
      expect(config.maxWaitMs).toBe(DEFAULT_EMBED_COMPLETION_WAIT_MS);
      expect(config.checkIntervalMs).toBe(EMBED_COMPLETION_CHECK_INTERVAL_MS);
    });

    it("should disable gating when EMBED_COMPLETION_GATING_DISABLED is true", () => {
      process.env.EMBED_COMPLETION_GATING_DISABLED = "true";

      const config = resolveEmbedCompletionGatingConfig();

      expect(config.enabled).toBe(false);
    });

    it("should disable gating when EMBED_COMPLETION_GATING_DISABLED is 1", () => {
      process.env.EMBED_COMPLETION_GATING_DISABLED = "1";

      const config = resolveEmbedCompletionGatingConfig();

      expect(config.enabled).toBe(false);
    });

    it("should override wait time from env var", () => {
      process.env.EMBED_COMPLETION_WAIT_MS = "60000";

      const config = resolveEmbedCompletionGatingConfig();

      expect(config.maxWaitMs).toBe(60000);
    });

    it("should override check interval from env var", () => {
      process.env.EMBED_COMPLETION_CHECK_INTERVAL_MS = "5000";

      const config = resolveEmbedCompletionGatingConfig();

      expect(config.checkIntervalMs).toBe(5000);
    });

    it("should fall back to defaults for invalid env values", () => {
      process.env.EMBED_COMPLETION_WAIT_MS = "invalid";
      process.env.EMBED_COMPLETION_CHECK_INTERVAL_MS = "not-a-number";

      const config = resolveEmbedCompletionGatingConfig();

      expect(config.maxWaitMs).toBe(DEFAULT_EMBED_COMPLETION_WAIT_MS);
      expect(config.checkIntervalMs).toBe(EMBED_COMPLETION_CHECK_INTERVAL_MS);
    });
  });

  describe("ChunkEmbedStatusRecord interface", () => {
    it("should allow all optional fields to be undefined", () => {
      const record: ChunkEmbedStatusRecord = {
        chunkId: "chunk-1",
        status: ChunkEmbedStatus.PENDING,
        runId: "run-1",
        kbId: "kb-1",
        updatedAt: new Date().toISOString(),
      };

      expect(record.error).toBeUndefined();
      expect(record.errorCode).toBeUndefined();
      expect(record.errorRetryable).toBeUndefined();
      expect(record.attemptCount).toBeUndefined();
      expect(record.dimensions).toBeUndefined();
    });

    it("should allow all optional fields to be set", () => {
      const record: ChunkEmbedStatusRecord = {
        chunkId: "chunk-1",
        status: ChunkEmbedStatus.FAILED_RETRYABLE,
        runId: "run-1",
        kbId: "kb-1",
        updatedAt: new Date().toISOString(),
        error: "Test error",
        errorCode: "TEST_ERROR",
        errorRetryable: true,
        attemptCount: 2,
        dimensions: 1536,
      };

      expect(record.error).toBe("Test error");
      expect(record.errorCode).toBe("TEST_ERROR");
      expect(record.errorRetryable).toBe(true);
      expect(record.attemptCount).toBe(2);
      expect(record.dimensions).toBe(1536);
    });
  });

  describe("Integration scenarios", () => {
    it("should handle typical chunk lifecycle: pending -> in_progress -> succeeded", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      expect(pending.status).toBe(ChunkEmbedStatus.PENDING);
      expect(isChunkEmbedInProgress(pending.status)).toBe(true);

      const inProgress = createInProgressChunkEmbedStatus(pending);
      expect(inProgress.status).toBe(ChunkEmbedStatus.IN_PROGRESS);
      expect(isChunkEmbedInProgress(inProgress.status)).toBe(true);

      const succeeded = createSucceededChunkEmbedStatus(inProgress, 768);
      expect(succeeded.status).toBe(ChunkEmbedStatus.SUCCEEDED);
      expect(isChunkEmbedTerminal(succeeded.status)).toBe(true);
    });

    it("should handle retry lifecycle: pending -> in_progress -> failed_retryable -> in_progress -> succeeded", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");

      const inProgress1 = createInProgressChunkEmbedStatus(pending);
      expect(inProgress1.attemptCount).toBe(1);

      const failed = createFailedChunkEmbedStatus(inProgress1, "Timeout", "TIMEOUT", true);
      expect(failed.status).toBe(ChunkEmbedStatus.FAILED_RETRYABLE);
      expect(isChunkEmbedFailed(failed.status)).toBe(true);
      expect(isChunkEmbedTerminal(failed.status)).toBe(false);

      const inProgress2 = createInProgressChunkEmbedStatus(failed);
      expect(inProgress2.attemptCount).toBe(2);

      const succeeded = createSucceededChunkEmbedStatus(inProgress2, 768);
      expect(succeeded.status).toBe(ChunkEmbedStatus.SUCCEEDED);
    });

    it("should handle permanent failure lifecycle", () => {
      const pending = createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1");
      const inProgress = createInProgressChunkEmbedStatus(pending);
      const failed = createFailedChunkEmbedStatus(
        inProgress,
        "Dimension mismatch",
        "DIMENSION_MISMATCH",
        false
      );

      expect(failed.status).toBe(ChunkEmbedStatus.FAILED_PERMANENT);
      expect(isChunkEmbedFailed(failed.status)).toBe(true);
      expect(isChunkEmbedTerminal(failed.status)).toBe(true);
    });

    it("should calculate correct summary for mixed run state", () => {
      const records: ChunkEmbedStatusRecord[] = [
        createPendingChunkEmbedStatus("chunk-1", "run-1", "kb-1"),
        createInProgressChunkEmbedStatus(
          createPendingChunkEmbedStatus("chunk-2", "run-1", "kb-1")
        ),
        createSucceededChunkEmbedStatus(
          createInProgressChunkEmbedStatus(
            createPendingChunkEmbedStatus("chunk-3", "run-1", "kb-1")
          ),
          768
        ),
        createSucceededChunkEmbedStatus(
          createInProgressChunkEmbedStatus(
            createPendingChunkEmbedStatus("chunk-4", "run-1", "kb-1")
          ),
          768
        ),
        createFailedChunkEmbedStatus(
          createInProgressChunkEmbedStatus(
            createPendingChunkEmbedStatus("chunk-5", "run-1", "kb-1")
          ),
          "Error",
          "ERR",
          false
        ),
      ];

      const summary = calculateChunkEmbedStatusSummary(records);

      expect(summary.total).toBe(5);
      expect(summary.pending).toBe(1);
      expect(summary.inProgress).toBe(1);
      expect(summary.succeeded).toBe(2);
      expect(summary.failedPermanent).toBe(1);
      expect(summary.isComplete).toBe(false);
      expect(summary.hasFailures).toBe(true);

      // This run is incomplete due to pending/in-progress chunks
      expect(determineRunStatusFromEmbedding(summary, false)).toBe("embedding_incomplete");
    });
  });
});
