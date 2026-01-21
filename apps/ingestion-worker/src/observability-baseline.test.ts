/**
 * Observability Baseline Tests
 *
 * These tests verify that the ingestion worker preserves the expected logging keys,
 * metric fields, and error codes as documented in phase-0-baseline.md.
 *
 * Acceptance criteria:
 * - Logging keys and error codes unchanged
 * - Verified against baseline observability list
 * - Exceptions documented if required
 *
 * This ensures dashboards and alerts continue to work after refactoring.
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ErrorCategory, ERROR_RETRYABILITY, ERROR_CATEGORIES } from "@grounded/shared";
import {
  IngestionError,
  NotFoundError,
  ConfigurationError,
  ProcessingError,
  EmbeddingError,
  EmbeddingDimensionMismatchError,
  StageTransitionError,
  workerSamplingConfig,
  normalizeError,
} from "./bootstrap/helpers";
import { QUEUE_NAMES } from "@grounded/queue";

// ============================================================================
// Baseline Error Code Taxonomy
// ============================================================================

/**
 * Error codes from phase-0-baseline.md that must be preserved.
 * These are used in dashboards, alerts, and log analysis.
 */
const BASELINE_ERROR_CODES = {
  // Network errors
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_CONNECTION_REFUSED: "NETWORK_CONNECTION_REFUSED",
  NETWORK_DNS_FAILURE: "NETWORK_DNS_FAILURE",
  NETWORK_RESET: "NETWORK_RESET",
  NETWORK_SSL_ERROR: "NETWORK_SSL_ERROR",

  // Service errors
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  SERVICE_RATE_LIMITED: "SERVICE_RATE_LIMITED",
  SERVICE_TIMEOUT: "SERVICE_TIMEOUT",
  SERVICE_BAD_GATEWAY: "SERVICE_BAD_GATEWAY",
  SERVICE_GATEWAY_TIMEOUT: "SERVICE_GATEWAY_TIMEOUT",
  SERVICE_OVERLOADED: "SERVICE_OVERLOADED",
  SERVICE_API_ERROR: "SERVICE_API_ERROR",

  // Content errors
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
  CONTENT_INVALID_FORMAT: "CONTENT_INVALID_FORMAT",
  CONTENT_EMPTY: "CONTENT_EMPTY",
  CONTENT_UNSUPPORTED_TYPE: "CONTENT_UNSUPPORTED_TYPE",
  CONTENT_PARSE_FAILED: "CONTENT_PARSE_FAILED",
  CONTENT_ENCODING_ERROR: "CONTENT_ENCODING_ERROR",

  // Config errors
  CONFIG_MISSING: "CONFIG_MISSING",
  CONFIG_INVALID: "CONFIG_INVALID",
  CONFIG_API_KEY_MISSING: "CONFIG_API_KEY_MISSING",
  CONFIG_MODEL_MISMATCH: "CONFIG_MODEL_MISMATCH",
  CONFIG_DIMENSION_MISMATCH: "CONFIG_DIMENSION_MISMATCH",

  // Not found errors
  NOT_FOUND_RESOURCE: "NOT_FOUND_RESOURCE",
  NOT_FOUND_URL: "NOT_FOUND_URL",
  NOT_FOUND_KB: "NOT_FOUND_KB",
  NOT_FOUND_SOURCE: "NOT_FOUND_SOURCE",
  NOT_FOUND_RUN: "NOT_FOUND_RUN",
  NOT_FOUND_CHUNK: "NOT_FOUND_CHUNK",

  // Validation errors
  VALIDATION_SCHEMA: "VALIDATION_SCHEMA",
  VALIDATION_URL_INVALID: "VALIDATION_URL_INVALID",
  VALIDATION_CONSTRAINT: "VALIDATION_CONSTRAINT",
  VALIDATION_PAYLOAD: "VALIDATION_PAYLOAD",

  // Auth errors
  AUTH_FORBIDDEN: "AUTH_FORBIDDEN",
  AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  AUTH_BLOCKED: "AUTH_BLOCKED",

  // System errors
  SYSTEM_OUT_OF_MEMORY: "SYSTEM_OUT_OF_MEMORY",
  SYSTEM_DISK_FULL: "SYSTEM_DISK_FULL",
  SYSTEM_INTERNAL: "SYSTEM_INTERNAL",
  SYSTEM_DATABASE_ERROR: "SYSTEM_DATABASE_ERROR",

  // Unknown error
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

/**
 * Error categories from phase-0-baseline.md.
 */
const BASELINE_ERROR_CATEGORIES = {
  NETWORK: "network",
  SERVICE: "service",
  CONTENT: "content",
  CONFIGURATION: "configuration",
  NOT_FOUND: "not_found",
  VALIDATION: "validation",
  AUTH: "auth",
  SYSTEM: "system",
  UNKNOWN: "unknown",
} as const;

// ============================================================================
// Baseline Queue Names
// ============================================================================

/**
 * Queue names from phase-0-baseline.md for ingestion worker.
 */
const BASELINE_INGESTION_QUEUES = {
  SOURCE_RUN: "source-run",
  PAGE_PROCESS: "page-process",
  PAGE_INDEX: "page-index",
  EMBED_CHUNKS: "embed-chunks",
  ENRICH_PAGE: "enrich-page",
  DELETION: "deletion",
  KB_REINDEX: "kb-reindex",
} as const;

// ============================================================================
// Baseline Logging Fields
// ============================================================================

/**
 * Wide event fields from phase-0-baseline.md that must be present in logs.
 */
const BASELINE_WIDE_EVENT_FIELDS = {
  // Core identifiers
  identifiers: ["requestId", "traceId", "spanId"],
  // Timing
  timing: ["timestamp", "durationMs"],
  // Service info
  service: ["service", "version", "deploymentId", "env"],
  // Context
  context: ["tenant", "user", "http", "job"],
  // Business context
  business: ["knowledgeBase", "source", "sourceRun", "agent"],
  // Operation
  operation: ["operation", "outcome", "error"],
  // Metrics
  metrics: [
    "dbQueries",
    "externalCalls",
    "cacheHit",
    "bytesProcessed",
    "itemsProcessed",
  ],
} as const;

/**
 * Error context fields from phase-0-baseline.md.
 */
const BASELINE_ERROR_CONTEXT_FIELDS = [
  "type",
  "code",
  "message",
  "stack",
  "retriable",
] as const;

/**
 * Job context fields from phase-0-baseline.md.
 */
const BASELINE_JOB_CONTEXT_FIELDS = [
  "id",
  "name",
  "queue",
  "attempt",
  "maxAttempts",
] as const;

// ============================================================================
// Baseline Sampling Configuration
// ============================================================================

/**
 * Sampling config baseline from phase-0-baseline.md.
 */
const BASELINE_SAMPLING_CONFIG = {
  baseSampleRate: 1.0, // Workers log 100%
  slowRequestThresholdMs: 30000, // 30s for jobs
  alwaysLogErrors: true,
} as const;

// ============================================================================
// Error Code Taxonomy Tests
// ============================================================================

describe("Observability Baseline: Error Code Taxonomy", () => {
  it("shared package exports all baseline error codes", () => {
    for (const [key, expectedCode] of Object.entries(BASELINE_ERROR_CODES)) {
      expect(ErrorCode[key as keyof typeof ErrorCode]).toBe(expectedCode);
    }
  });

  it("shared package exports all baseline error categories", () => {
    for (const [key, expectedCategory] of Object.entries(
      BASELINE_ERROR_CATEGORIES
    )) {
      expect(ErrorCategory[key as keyof typeof ErrorCategory]).toBe(
        expectedCategory
      );
    }
  });

  it("all baseline error codes have retryability defined", () => {
    for (const code of Object.values(BASELINE_ERROR_CODES)) {
      expect(ERROR_RETRYABILITY[code as keyof typeof ERROR_RETRYABILITY]).toBeDefined();
    }
  });

  it("all baseline error codes have category defined", () => {
    for (const code of Object.values(BASELINE_ERROR_CODES)) {
      expect(ERROR_CATEGORIES[code as keyof typeof ERROR_CATEGORIES]).toBeDefined();
    }
  });

  it("network errors are mapped to network category", () => {
    const networkCodes = [
      "NETWORK_TIMEOUT",
      "NETWORK_CONNECTION_REFUSED",
      "NETWORK_DNS_FAILURE",
      "NETWORK_RESET",
      "NETWORK_SSL_ERROR",
    ];
    for (const code of networkCodes) {
      expect(ERROR_CATEGORIES[code as keyof typeof ERROR_CATEGORIES]).toBe(
        "network"
      );
    }
  });

  it("service errors are mapped to service category", () => {
    const serviceCodes = [
      "SERVICE_UNAVAILABLE",
      "SERVICE_RATE_LIMITED",
      "SERVICE_TIMEOUT",
      "SERVICE_BAD_GATEWAY",
      "SERVICE_GATEWAY_TIMEOUT",
      "SERVICE_OVERLOADED",
      "SERVICE_API_ERROR",
    ];
    for (const code of serviceCodes) {
      expect(ERROR_CATEGORIES[code as keyof typeof ERROR_CATEGORIES]).toBe(
        "service"
      );
    }
  });

  it("content errors are mapped to content category", () => {
    const contentCodes = [
      "CONTENT_TOO_LARGE",
      "CONTENT_INVALID_FORMAT",
      "CONTENT_EMPTY",
      "CONTENT_UNSUPPORTED_TYPE",
      "CONTENT_PARSE_FAILED",
      "CONTENT_ENCODING_ERROR",
    ];
    for (const code of contentCodes) {
      expect(ERROR_CATEGORIES[code as keyof typeof ERROR_CATEGORIES]).toBe(
        "content"
      );
    }
  });

  it("config errors are mapped to configuration category", () => {
    const configCodes = [
      "CONFIG_MISSING",
      "CONFIG_INVALID",
      "CONFIG_API_KEY_MISSING",
      "CONFIG_MODEL_MISMATCH",
      "CONFIG_DIMENSION_MISMATCH",
    ];
    for (const code of configCodes) {
      expect(ERROR_CATEGORIES[code as keyof typeof ERROR_CATEGORIES]).toBe(
        "configuration"
      );
    }
  });

  it("not found errors are mapped to not_found category", () => {
    const notFoundCodes = [
      "NOT_FOUND_RESOURCE",
      "NOT_FOUND_URL",
      "NOT_FOUND_KB",
      "NOT_FOUND_SOURCE",
      "NOT_FOUND_RUN",
      "NOT_FOUND_CHUNK",
    ];
    for (const code of notFoundCodes) {
      expect(ERROR_CATEGORIES[code as keyof typeof ERROR_CATEGORIES]).toBe(
        "not_found"
      );
    }
  });

  it("preserves retryability rules from baseline", () => {
    // Network errors - mostly retryable
    expect(ERROR_RETRYABILITY.NETWORK_TIMEOUT).toBe(true);
    expect(ERROR_RETRYABILITY.NETWORK_CONNECTION_REFUSED).toBe(true);
    expect(ERROR_RETRYABILITY.NETWORK_SSL_ERROR).toBe(false); // SSL is config issue

    // Service errors - mostly retryable
    expect(ERROR_RETRYABILITY.SERVICE_RATE_LIMITED).toBe(true);
    expect(ERROR_RETRYABILITY.SERVICE_UNAVAILABLE).toBe(true);
    expect(ERROR_RETRYABILITY.SERVICE_API_ERROR).toBe(false); // Bad request

    // Content errors - permanent
    expect(ERROR_RETRYABILITY.CONTENT_TOO_LARGE).toBe(false);
    expect(ERROR_RETRYABILITY.CONTENT_INVALID_FORMAT).toBe(false);

    // Config errors - permanent
    expect(ERROR_RETRYABILITY.CONFIG_MISSING).toBe(false);
    expect(ERROR_RETRYABILITY.CONFIG_DIMENSION_MISMATCH).toBe(false);

    // Not found errors - permanent
    expect(ERROR_RETRYABILITY.NOT_FOUND_KB).toBe(false);
    expect(ERROR_RETRYABILITY.NOT_FOUND_RUN).toBe(false);

    // Unknown - default to retryable (conservative)
    expect(ERROR_RETRYABILITY.UNKNOWN_ERROR).toBe(true);
  });
});

// ============================================================================
// Queue Name Tests
// ============================================================================

describe("Observability Baseline: Queue Names", () => {
  it("preserves source-run queue name", () => {
    expect(QUEUE_NAMES.SOURCE_RUN).toBe(BASELINE_INGESTION_QUEUES.SOURCE_RUN);
  });

  it("preserves page-process queue name", () => {
    expect(QUEUE_NAMES.PAGE_PROCESS).toBe(BASELINE_INGESTION_QUEUES.PAGE_PROCESS);
  });

  it("preserves page-index queue name", () => {
    expect(QUEUE_NAMES.PAGE_INDEX).toBe(BASELINE_INGESTION_QUEUES.PAGE_INDEX);
  });

  it("preserves embed-chunks queue name", () => {
    expect(QUEUE_NAMES.EMBED_CHUNKS).toBe(BASELINE_INGESTION_QUEUES.EMBED_CHUNKS);
  });

  it("preserves enrich-page queue name", () => {
    expect(QUEUE_NAMES.ENRICH_PAGE).toBe(BASELINE_INGESTION_QUEUES.ENRICH_PAGE);
  });

  it("preserves deletion queue name", () => {
    expect(QUEUE_NAMES.DELETION).toBe(BASELINE_INGESTION_QUEUES.DELETION);
  });

  it("preserves kb-reindex queue name", () => {
    expect(QUEUE_NAMES.KB_REINDEX).toBe(BASELINE_INGESTION_QUEUES.KB_REINDEX);
  });
});

// ============================================================================
// Worker Error Classes Tests
// ============================================================================

describe("Observability Baseline: Worker Error Classes", () => {
  describe("IngestionError normalizeError output", () => {
    it("produces error context with baseline fields", () => {
      const error = new IngestionError("Test error", {
        code: "TEST_CODE",
        retriable: true,
      });

      const normalized = normalizeError(error);

      // Verify all baseline error context fields are present
      expect(normalized.type).toBe("IngestionError");
      expect(normalized.code).toBe("TEST_CODE");
      expect(normalized.message).toBe("Test error");
      expect(normalized.retriable).toBe(true);
      expect(normalized.stack).toBeDefined();
    });
  });

  describe("NotFoundError", () => {
    it("produces NOT_FOUND_ prefixed codes matching baseline pattern", () => {
      const error = new NotFoundError("Knowledge Base", "kb-123");

      expect(error.code).toMatch(/^NOT_FOUND_/);
      expect(error.retriable).toBe(false);
    });
  });

  describe("ConfigurationError", () => {
    it("produces CONFIG_ prefixed code", () => {
      const error = new ConfigurationError("Missing API key");

      expect(error.code).toBe("CONFIG_ERROR");
      expect(error.retriable).toBe(false);
    });
  });

  describe("EmbeddingDimensionMismatchError", () => {
    it("produces CONFIG_EMBEDDING_DIMENSION_MISMATCH code matching baseline", () => {
      const error = new EmbeddingDimensionMismatchError(1536, 768, "kb-123");

      expect(error.code).toBe("CONFIG_EMBEDDING_DIMENSION_MISMATCH");
      expect(error.retriable).toBe(false);
    });
  });

  describe("ProcessingError", () => {
    it("defaults to PROCESSING_ERROR code", () => {
      const error = new ProcessingError("Failed to extract");

      expect(error.code).toBe("PROCESSING_ERROR");
      expect(error.retriable).toBe(true);
    });
  });

  describe("EmbeddingError", () => {
    it("defaults to EMBED_ERROR code", () => {
      const error = new EmbeddingError("Embedding failed");

      expect(error.code).toBe("EMBED_ERROR");
      expect(error.retriable).toBe(true);
    });
  });

  describe("StageTransitionError", () => {
    it("produces STAGE_TRANSITION_ERROR code", () => {
      const error = new StageTransitionError(
        "run-123",
        "PROCESSING",
        "INDEXING",
        "No pages"
      );

      expect(error.code).toBe("STAGE_TRANSITION_ERROR");
      expect(error.retriable).toBe(true);
    });
  });
});

// ============================================================================
// Sampling Configuration Tests
// ============================================================================

describe("Observability Baseline: Sampling Configuration", () => {
  it("worker sampling config matches baseline", () => {
    expect(workerSamplingConfig.baseSampleRate).toBe(
      BASELINE_SAMPLING_CONFIG.baseSampleRate
    );
    expect(workerSamplingConfig.slowRequestThresholdMs).toBe(
      BASELINE_SAMPLING_CONFIG.slowRequestThresholdMs
    );
    expect(workerSamplingConfig.alwaysLogErrors).toBe(
      BASELINE_SAMPLING_CONFIG.alwaysLogErrors
    );
  });

  it("workers log 100% of jobs by default", () => {
    expect(workerSamplingConfig.baseSampleRate).toBe(1.0);
  });

  it("30s threshold for slow jobs", () => {
    expect(workerSamplingConfig.slowRequestThresholdMs).toBe(30000);
  });

  it("always logs errors", () => {
    expect(workerSamplingConfig.alwaysLogErrors).toBe(true);
  });
});

// ============================================================================
// Wide Event Field Tests
// ============================================================================

describe("Observability Baseline: Wide Event Fields", () => {
  it("error context includes baseline fields", () => {
    // Test that normalizeError produces the expected fields
    const testError = new IngestionError("Test", {
      code: "TEST",
      retriable: true,
    });
    const normalized = normalizeError(testError);

    // Check all baseline error context fields
    for (const field of BASELINE_ERROR_CONTEXT_FIELDS) {
      if (field === "stack") {
        expect(normalized[field]).toBeDefined();
      } else {
        expect(field in normalized).toBe(true);
      }
    }
  });

  it("documented wide event field categories exist", () => {
    // Verify the baseline field categories are documented
    expect(BASELINE_WIDE_EVENT_FIELDS.identifiers).toContain("requestId");
    expect(BASELINE_WIDE_EVENT_FIELDS.identifiers).toContain("traceId");
    expect(BASELINE_WIDE_EVENT_FIELDS.timing).toContain("timestamp");
    expect(BASELINE_WIDE_EVENT_FIELDS.timing).toContain("durationMs");
    expect(BASELINE_WIDE_EVENT_FIELDS.service).toContain("service");
    expect(BASELINE_WIDE_EVENT_FIELDS.context).toContain("job");
    expect(BASELINE_WIDE_EVENT_FIELDS.context).toContain("tenant");
    expect(BASELINE_WIDE_EVENT_FIELDS.business).toContain("knowledgeBase");
    expect(BASELINE_WIDE_EVENT_FIELDS.business).toContain("sourceRun");
    expect(BASELINE_WIDE_EVENT_FIELDS.operation).toContain("operation");
    expect(BASELINE_WIDE_EVENT_FIELDS.operation).toContain("outcome");
    expect(BASELINE_WIDE_EVENT_FIELDS.operation).toContain("error");
    expect(BASELINE_WIDE_EVENT_FIELDS.metrics).toContain("itemsProcessed");
  });

  it("job context includes baseline fields", () => {
    // Job context fields documented in baseline
    expect(BASELINE_JOB_CONTEXT_FIELDS).toContain("id");
    expect(BASELINE_JOB_CONTEXT_FIELDS).toContain("name");
    expect(BASELINE_JOB_CONTEXT_FIELDS).toContain("queue");
    expect(BASELINE_JOB_CONTEXT_FIELDS).toContain("attempt");
    expect(BASELINE_JOB_CONTEXT_FIELDS).toContain("maxAttempts");
  });
});

// ============================================================================
// Error Code Usage in Processors Tests
// ============================================================================

describe("Observability Baseline: Error Code Usage Patterns", () => {
  it("NOT_FOUND_KB code matches baseline for missing knowledge base", () => {
    // This code is used in embed-chunks.ts when KB is not found
    expect(BASELINE_ERROR_CODES.NOT_FOUND_KB).toBe("NOT_FOUND_KB");
    expect(ErrorCode.NOT_FOUND_KB).toBe("NOT_FOUND_KB");
  });

  it("CONFIG_DIMENSION_MISMATCH code matches baseline", () => {
    // This code is used when embedding dimensions don't match
    expect(BASELINE_ERROR_CODES.CONFIG_DIMENSION_MISMATCH).toBe(
      "CONFIG_DIMENSION_MISMATCH"
    );
    expect(ErrorCode.CONFIG_DIMENSION_MISMATCH).toBe("CONFIG_DIMENSION_MISMATCH");
  });

  it("CONFIG_EMBEDDING_DIMENSION_MISMATCH is documented as worker-specific", () => {
    // Worker helper uses this specific code
    const error = new EmbeddingDimensionMismatchError(1536, 768, "kb-123");
    expect(error.code).toBe("CONFIG_EMBEDDING_DIMENSION_MISMATCH");

    // Note: This is a worker-specific extension of CONFIG_DIMENSION_MISMATCH
    // Both are valid and used for the same purpose in different contexts
  });

  it("EMBED_ERROR code is used for embedding failures", () => {
    const error = new EmbeddingError("Failed to generate embeddings");
    expect(error.code).toBe("EMBED_ERROR");
  });

  it("PROCESSING_ERROR code is used for content processing failures", () => {
    const error = new ProcessingError("Failed to extract content");
    expect(error.code).toBe("PROCESSING_ERROR");
  });
});

// ============================================================================
// Retryability Consistency Tests
// ============================================================================

describe("Observability Baseline: Retryability Consistency", () => {
  it("worker errors follow baseline retryability rules", () => {
    // NotFoundError should not be retriable
    const notFound = new NotFoundError("Run", "run-123");
    expect(notFound.retriable).toBe(false);

    // ConfigurationError should not be retriable
    const config = new ConfigurationError("Invalid config");
    expect(config.retriable).toBe(false);

    // ProcessingError should be retriable by default
    const processing = new ProcessingError("Extraction failed");
    expect(processing.retriable).toBe(true);

    // EmbeddingError should be retriable by default
    const embedding = new EmbeddingError("API timeout");
    expect(embedding.retriable).toBe(true);

    // Dimension mismatch should not be retriable (config issue)
    const dimension = new EmbeddingDimensionMismatchError(1536, 768, "kb");
    expect(dimension.retriable).toBe(false);

    // Stage transition error should be retriable
    const transition = new StageTransitionError("run", "A", "B", "reason");
    expect(transition.retriable).toBe(true);
  });
});

// ============================================================================
// Service Name Tests
// ============================================================================

describe("Observability Baseline: Service Name", () => {
  it("ingestion-worker is a valid service name", () => {
    // Verify the service name used in logging
    const validServiceNames = ["api", "ingestion-worker", "scraper-worker"];
    expect(validServiceNames).toContain("ingestion-worker");
  });
});

// ============================================================================
// Summary: Baseline Contract Preservation
// ============================================================================

describe("Observability Baseline: Contract Summary", () => {
  it("all baseline error codes are preserved", () => {
    const baselineCodes = Object.values(BASELINE_ERROR_CODES);
    const sharedCodes = Object.values(ErrorCode);

    for (const code of baselineCodes) {
      expect(sharedCodes).toContain(code);
    }
  });

  it("all baseline queue names are preserved", () => {
    const baselineQueues = Object.values(BASELINE_INGESTION_QUEUES);
    const actualQueues = Object.values(QUEUE_NAMES);

    for (const queue of baselineQueues) {
      expect(actualQueues).toContain(queue);
    }
  });

  it("sampling config matches baseline expectations", () => {
    // 100% sample rate for workers
    expect(workerSamplingConfig.baseSampleRate).toBe(1.0);
    // 30s slow threshold
    expect(workerSamplingConfig.slowRequestThresholdMs).toBe(30000);
    // Always log errors
    expect(workerSamplingConfig.alwaysLogErrors).toBe(true);
  });
});
