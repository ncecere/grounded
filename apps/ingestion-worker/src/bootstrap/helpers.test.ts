import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test";
import {
  getWorkerLogger,
  ingestLog,
  workerSamplingConfig,
  shouldSample,
  IngestionError,
  NotFoundError,
  ConfigurationError,
  ProcessingError,
  EmbeddingError,
  EmbeddingDimensionMismatchError,
  StageTransitionError,
  normalizeError,
  getErrorMessage,
  isRetriableError,
  withErrorLogging,
} from "./helpers";

// ============================================================================
// Logger Tests
// ============================================================================

describe("getWorkerLogger", () => {
  it("returns a logger instance", () => {
    const logger = getWorkerLogger();
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("returns singleton instance on multiple calls", () => {
    const logger1 = getWorkerLogger();
    const logger2 = getWorkerLogger();
    expect(logger1).toBe(logger2);
  });
});

describe("ingestLog", () => {
  it("exports all log level functions", () => {
    expect(typeof ingestLog.trace).toBe("function");
    expect(typeof ingestLog.debug).toBe("function");
    expect(typeof ingestLog.info).toBe("function");
    expect(typeof ingestLog.warn).toBe("function");
    expect(typeof ingestLog.error).toBe("function");
    expect(typeof ingestLog.fatal).toBe("function");
  });
});

// ============================================================================
// Sampling Config Tests
// ============================================================================

describe("workerSamplingConfig", () => {
  it("has 100% base sample rate for workers", () => {
    expect(workerSamplingConfig.baseSampleRate).toBe(1.0);
  });

  it("has 30s slow request threshold", () => {
    expect(workerSamplingConfig.slowRequestThresholdMs).toBe(30000);
  });

  it("always logs errors", () => {
    expect(workerSamplingConfig.alwaysLogErrors).toBe(true);
  });
});

describe("shouldSample", () => {
  it("always samples error events", () => {
    const errorEvent = {
      requestId: "test",
      timestamp: new Date().toISOString(),
      service: "ingestion-worker" as const,
      outcome: "error" as const,
    };
    expect(shouldSample(errorEvent, workerSamplingConfig)).toBe(true);
  });

  it("samples slow requests", () => {
    const slowEvent = {
      requestId: "test",
      timestamp: new Date().toISOString(),
      service: "ingestion-worker" as const,
      durationMs: 35000,
    };
    expect(shouldSample(slowEvent, workerSamplingConfig)).toBe(true);
  });
});

// ============================================================================
// Error Class Tests
// ============================================================================

describe("IngestionError", () => {
  it("creates error with code and retriable flag", () => {
    const error = new IngestionError("Test error", {
      code: "TEST_ERROR",
      retriable: true,
    });

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("TEST_ERROR");
    expect(error.retriable).toBe(true);
    expect(error.name).toBe("IngestionError");
  });

  it("defaults retriable to false", () => {
    const error = new IngestionError("Test error", { code: "TEST" });
    expect(error.retriable).toBe(false);
  });

  it("includes optional context", () => {
    const error = new IngestionError("Test error", {
      code: "TEST",
      context: { runId: "123", url: "http://example.com" },
    });

    expect(error.context).toEqual({ runId: "123", url: "http://example.com" });
  });

  it("preserves cause error", () => {
    const cause = new Error("Original error");
    const error = new IngestionError("Wrapper error", {
      code: "WRAPPED",
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});

describe("NotFoundError", () => {
  it("creates error with resource type and id", () => {
    const error = new NotFoundError("Source Run", "run-123");

    expect(error.message).toBe("Source Run run-123 not found");
    expect(error.code).toBe("NOT_FOUND_SOURCE_RUN");
    expect(error.retriable).toBe(false);
    expect(error.name).toBe("NotFoundError");
  });

  it("normalizes resource type in code", () => {
    const error = new NotFoundError("Knowledge Base", "kb-456");
    expect(error.code).toBe("NOT_FOUND_KNOWLEDGE_BASE");
  });

  it("includes context with resource info", () => {
    const error = new NotFoundError("Page", "page-789", { runId: "run-123" });

    expect(error.context).toEqual({
      resourceType: "Page",
      resourceId: "page-789",
      runId: "run-123",
    });
  });
});

describe("ConfigurationError", () => {
  it("creates error with config code", () => {
    const error = new ConfigurationError("Invalid embedding model");

    expect(error.message).toBe("Invalid embedding model");
    expect(error.code).toBe("CONFIG_ERROR");
    expect(error.retriable).toBe(false);
    expect(error.name).toBe("ConfigurationError");
  });
});

describe("ProcessingError", () => {
  it("defaults to retriable", () => {
    const error = new ProcessingError("Failed to extract content");

    expect(error.message).toBe("Failed to extract content");
    expect(error.code).toBe("PROCESSING_ERROR");
    expect(error.retriable).toBe(true);
    expect(error.name).toBe("ProcessingError");
  });

  it("allows custom code", () => {
    const error = new ProcessingError("Extraction failed", {
      code: "EXTRACTION_FAILED",
    });

    expect(error.code).toBe("EXTRACTION_FAILED");
  });
});

describe("EmbeddingError", () => {
  it("defaults to retriable", () => {
    const error = new EmbeddingError("Embedding generation failed");

    expect(error.code).toBe("EMBED_ERROR");
    expect(error.retriable).toBe(true);
    expect(error.name).toBe("EmbeddingError");
  });
});

describe("EmbeddingDimensionMismatchError", () => {
  it("creates error with dimension details", () => {
    const error = new EmbeddingDimensionMismatchError(1536, 768, "kb-123");

    expect(error.message).toContain("expected 1536 dimensions but got 768");
    expect(error.message).toContain("kb-123");
    expect(error.code).toBe("CONFIG_EMBEDDING_DIMENSION_MISMATCH");
    expect(error.retriable).toBe(false);
    expect(error.name).toBe("EmbeddingDimensionMismatchError");
  });

  it("includes dimension context", () => {
    const error = new EmbeddingDimensionMismatchError(1536, 768, "kb-123");

    expect(error.context).toEqual({
      expected: 1536,
      actual: 768,
      kbId: "kb-123",
    });
  });
});

describe("StageTransitionError", () => {
  it("creates error with stage details", () => {
    const error = new StageTransitionError(
      "run-123",
      "PROCESSING",
      "INDEXING",
      "No pages to process"
    );

    expect(error.message).toContain("run-123");
    expect(error.message).toContain("PROCESSING -> INDEXING");
    expect(error.message).toContain("No pages to process");
    expect(error.code).toBe("STAGE_TRANSITION_ERROR");
    expect(error.retriable).toBe(true);
    expect(error.name).toBe("StageTransitionError");
  });

  it("includes stage context", () => {
    const error = new StageTransitionError(
      "run-123",
      "SCRAPING",
      "PROCESSING",
      "Timeout",
      { pagesScraped: 50 }
    );

    expect(error.context).toEqual({
      runId: "run-123",
      fromStage: "SCRAPING",
      toStage: "PROCESSING",
      reason: "Timeout",
      pagesScraped: 50,
    });
  });
});

// ============================================================================
// Error Utility Tests
// ============================================================================

describe("normalizeError", () => {
  it("normalizes IngestionError", () => {
    const error = new IngestionError("Test", {
      code: "TEST",
      retriable: true,
    });

    const normalized = normalizeError(error);

    expect(normalized.type).toBe("IngestionError");
    expect(normalized.message).toBe("Test");
    expect(normalized.code).toBe("TEST");
    expect(normalized.retriable).toBe(true);
    expect(normalized.stack).toBeDefined();
  });

  it("normalizes standard Error", () => {
    const error = new Error("Standard error");

    const normalized = normalizeError(error);

    expect(normalized.type).toBe("Error");
    expect(normalized.message).toBe("Standard error");
    expect(normalized.stack).toBeDefined();
  });

  it("normalizes unknown error types", () => {
    const normalized = normalizeError("string error");

    expect(normalized.type).toBe("UnknownError");
    expect(normalized.message).toBe("string error");
  });

  it("normalizes null/undefined", () => {
    expect(normalizeError(null).message).toBe("null");
    expect(normalizeError(undefined).message).toBe("undefined");
  });
});

describe("getErrorMessage", () => {
  it("extracts message from Error", () => {
    expect(getErrorMessage(new Error("test"))).toBe("test");
  });

  it("converts non-Error to string", () => {
    expect(getErrorMessage("string error")).toBe("string error");
    expect(getErrorMessage(123)).toBe("123");
    expect(getErrorMessage(null)).toBe("null");
  });
});

describe("isRetriableError", () => {
  it("checks IngestionError retriable flag", () => {
    const retriable = new ProcessingError("test");
    const notRetriable = new NotFoundError("Run", "123");

    expect(isRetriableError(retriable)).toBe(true);
    expect(isRetriableError(notRetriable)).toBe(false);
  });

  it("detects non-retriable patterns in standard errors", () => {
    expect(isRetriableError(new Error("Resource not found"))).toBe(false);
    expect(isRetriableError(new Error("Vector store not configured"))).toBe(false);
    expect(isRetriableError(new Error("Invalid parameter"))).toBe(false);
    expect(isRetriableError(new Error("dimension mismatch"))).toBe(false);
  });

  it("defaults to retriable for unknown errors", () => {
    expect(isRetriableError(new Error("Network timeout"))).toBe(true);
    expect(isRetriableError("string error")).toBe(true);
  });
});

describe("withErrorLogging", () => {
  it("returns result on success", async () => {
    const result = await withErrorLogging({ job: "test" }, async () => {
      return "success";
    });

    expect(result).toBe("success");
  });

  it("rethrows error on failure", async () => {
    await expect(
      withErrorLogging({ job: "test" }, async () => {
        throw new Error("Test failure");
      })
    ).rejects.toThrow("Test failure");
  });

  it("logs error with context", async () => {
    // The logging happens internally - we just verify it doesn't throw
    // and properly rethrows the original error
    try {
      await withErrorLogging({ job: "test", url: "http://example.com" }, async () => {
        throw new ProcessingError("Failed", { code: "PROC_FAIL" });
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ProcessingError);
      expect((error as ProcessingError).code).toBe("PROC_FAIL");
    }
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("error class hierarchy", () => {
  it("all custom errors extend IngestionError", () => {
    expect(new NotFoundError("Run", "123")).toBeInstanceOf(IngestionError);
    expect(new ConfigurationError("test")).toBeInstanceOf(IngestionError);
    expect(new ProcessingError("test")).toBeInstanceOf(IngestionError);
    expect(new EmbeddingError("test")).toBeInstanceOf(IngestionError);
    expect(new EmbeddingDimensionMismatchError(100, 50, "kb")).toBeInstanceOf(IngestionError);
    expect(new StageTransitionError("run", "A", "B", "test")).toBeInstanceOf(IngestionError);
  });

  it("EmbeddingDimensionMismatchError extends EmbeddingError", () => {
    const error = new EmbeddingDimensionMismatchError(100, 50, "kb");
    expect(error).toBeInstanceOf(EmbeddingError);
    expect(error).toBeInstanceOf(IngestionError);
  });

  it("all custom errors extend base Error", () => {
    expect(new NotFoundError("Run", "123")).toBeInstanceOf(Error);
    expect(new ConfigurationError("test")).toBeInstanceOf(Error);
    expect(new ProcessingError("test")).toBeInstanceOf(Error);
    expect(new EmbeddingError("test")).toBeInstanceOf(Error);
    expect(new StageTransitionError("run", "A", "B", "test")).toBeInstanceOf(Error);
  });
});

describe("error codes consistency", () => {
  it("NotFoundError codes start with NOT_FOUND_", () => {
    const errors = [
      new NotFoundError("Run", "1"),
      new NotFoundError("Page", "2"),
      new NotFoundError("Knowledge Base", "3"),
    ];

    for (const error of errors) {
      expect(error.code).toMatch(/^NOT_FOUND_/);
    }
  });

  it("EmbeddingDimensionMismatchError has CONFIG_ prefix", () => {
    const error = new EmbeddingDimensionMismatchError(100, 50, "kb");
    expect(error.code).toMatch(/^CONFIG_/);
  });

  it("ConfigurationError has CONFIG_ code", () => {
    const error = new ConfigurationError("test");
    expect(error.code).toBe("CONFIG_ERROR");
  });
});
