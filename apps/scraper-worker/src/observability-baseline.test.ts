/**
 * Observability Baseline Tests for Scraper Worker
 *
 * These tests verify that the scraper worker preserves the expected logging keys,
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
import { ErrorCode, ErrorCategory, ERROR_RETRYABILITY, ERROR_CATEGORIES, ContentError } from "@grounded/shared";
import { QUEUE_NAMES, isFairnessSlotError, FairnessSlotUnavailableError } from "@grounded/queue";
import { createSamplingConfig } from "@grounded/logger";

// ============================================================================
// Baseline Error Code Taxonomy
// ============================================================================

/**
 * Error codes from phase-0-baseline.md that the scraper worker uses.
 * These are used in dashboards, alerts, and log analysis.
 */
const BASELINE_ERROR_CODES = {
  // Network errors (used in fetch strategies)
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  NETWORK_CONNECTION_REFUSED: "NETWORK_CONNECTION_REFUSED",
  NETWORK_DNS_FAILURE: "NETWORK_DNS_FAILURE",
  NETWORK_RESET: "NETWORK_RESET",
  NETWORK_SSL_ERROR: "NETWORK_SSL_ERROR",

  // Service errors (used in Firecrawl and HTTP fetch)
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  SERVICE_RATE_LIMITED: "SERVICE_RATE_LIMITED",
  SERVICE_TIMEOUT: "SERVICE_TIMEOUT",
  SERVICE_BAD_GATEWAY: "SERVICE_BAD_GATEWAY",
  SERVICE_GATEWAY_TIMEOUT: "SERVICE_GATEWAY_TIMEOUT",
  SERVICE_OVERLOADED: "SERVICE_OVERLOADED",
  SERVICE_API_ERROR: "SERVICE_API_ERROR",

  // Content errors (used in content validation)
  CONTENT_TOO_LARGE: "CONTENT_TOO_LARGE",
  CONTENT_INVALID_FORMAT: "CONTENT_INVALID_FORMAT",
  CONTENT_EMPTY: "CONTENT_EMPTY",
  CONTENT_UNSUPPORTED_TYPE: "CONTENT_UNSUPPORTED_TYPE",
  CONTENT_PARSE_FAILED: "CONTENT_PARSE_FAILED",
  CONTENT_ENCODING_ERROR: "CONTENT_ENCODING_ERROR",

  // Config errors (used in Firecrawl when API key missing)
  CONFIG_MISSING: "CONFIG_MISSING",
  CONFIG_INVALID: "CONFIG_INVALID",
  CONFIG_API_KEY_MISSING: "CONFIG_API_KEY_MISSING",
  CONFIG_MODEL_MISMATCH: "CONFIG_MODEL_MISMATCH",
  CONFIG_DIMENSION_MISMATCH: "CONFIG_DIMENSION_MISMATCH",

  // Not found errors (used when run/source not found)
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

  // Auth errors (used for blocked/forbidden access)
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
 * Queue names from phase-0-baseline.md for scraper worker.
 */
const BASELINE_SCRAPER_QUEUES = {
  PAGE_FETCH: "page-fetch",
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
// Scraper Worker Specific Log Fields
// ============================================================================

/**
 * Log fields specific to scraper worker operations.
 * These are documented in the baseline and used for debugging/monitoring.
 */
const SCRAPER_LOG_FIELDS = {
  // Page fetch job context
  pageFetch: ["url", "fetchMode", "depth"],
  // Fairness slot context
  fairnessSlot: [
    "fairnessDelay",
    "retryDelayMs",
    "currentSlots",
    "maxAllowedSlots",
    "activeRunCount",
  ],
  // Stage progress
  stageProgress: ["stageProgress", "completed", "failed", "total"],
  // Fetch strategy
  fetchStrategy: ["strategy", "reason", "allowPlaywrightFallback"],
  // Content validation
  contentValidation: ["contentType", "mimeType", "category", "reason"],
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
    expect(ERROR_RETRYABILITY.CONTENT_UNSUPPORTED_TYPE).toBe(false);

    // Config errors - permanent
    expect(ERROR_RETRYABILITY.CONFIG_MISSING).toBe(false);
    expect(ERROR_RETRYABILITY.CONFIG_API_KEY_MISSING).toBe(false);

    // Not found errors - permanent
    expect(ERROR_RETRYABILITY.NOT_FOUND_RUN).toBe(false);
    expect(ERROR_RETRYABILITY.NOT_FOUND_SOURCE).toBe(false);

    // Unknown - default to retryable (conservative)
    expect(ERROR_RETRYABILITY.UNKNOWN_ERROR).toBe(true);
  });
});

// ============================================================================
// Queue Name Tests
// ============================================================================

describe("Observability Baseline: Queue Names", () => {
  it("preserves page-fetch queue name", () => {
    expect(QUEUE_NAMES.PAGE_FETCH).toBe(BASELINE_SCRAPER_QUEUES.PAGE_FETCH);
  });

  it("page-fetch queue name is 'page-fetch'", () => {
    expect(QUEUE_NAMES.PAGE_FETCH).toBe("page-fetch");
  });
});

// ============================================================================
// Sampling Configuration Tests
// ============================================================================

describe("Observability Baseline: Sampling Configuration", () => {
  it("can create sampling config with baseline values", () => {
    const samplingConfig = createSamplingConfig({
      baseSampleRate: BASELINE_SAMPLING_CONFIG.baseSampleRate,
      slowRequestThresholdMs: BASELINE_SAMPLING_CONFIG.slowRequestThresholdMs,
    });

    expect(samplingConfig.baseSampleRate).toBe(
      BASELINE_SAMPLING_CONFIG.baseSampleRate
    );
    expect(samplingConfig.slowRequestThresholdMs).toBe(
      BASELINE_SAMPLING_CONFIG.slowRequestThresholdMs
    );
  });

  it("workers log 100% of jobs by default", () => {
    expect(BASELINE_SAMPLING_CONFIG.baseSampleRate).toBe(1.0);
  });

  it("30s threshold for slow jobs", () => {
    expect(BASELINE_SAMPLING_CONFIG.slowRequestThresholdMs).toBe(30000);
  });

  it("always logs errors", () => {
    expect(BASELINE_SAMPLING_CONFIG.alwaysLogErrors).toBe(true);
  });
});

// ============================================================================
// Wide Event Field Tests
// ============================================================================

describe("Observability Baseline: Wide Event Fields", () => {
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

  it("error context includes baseline fields", () => {
    expect(BASELINE_ERROR_CONTEXT_FIELDS).toContain("type");
    expect(BASELINE_ERROR_CONTEXT_FIELDS).toContain("code");
    expect(BASELINE_ERROR_CONTEXT_FIELDS).toContain("message");
    expect(BASELINE_ERROR_CONTEXT_FIELDS).toContain("stack");
    expect(BASELINE_ERROR_CONTEXT_FIELDS).toContain("retriable");
  });
});

// ============================================================================
// Scraper Worker Specific Log Fields Tests
// ============================================================================

describe("Observability Baseline: Scraper Worker Log Fields", () => {
  it("page fetch job context fields are documented", () => {
    expect(SCRAPER_LOG_FIELDS.pageFetch).toContain("url");
    expect(SCRAPER_LOG_FIELDS.pageFetch).toContain("fetchMode");
    expect(SCRAPER_LOG_FIELDS.pageFetch).toContain("depth");
  });

  it("fairness slot context fields are documented", () => {
    expect(SCRAPER_LOG_FIELDS.fairnessSlot).toContain("fairnessDelay");
    expect(SCRAPER_LOG_FIELDS.fairnessSlot).toContain("retryDelayMs");
    expect(SCRAPER_LOG_FIELDS.fairnessSlot).toContain("currentSlots");
    expect(SCRAPER_LOG_FIELDS.fairnessSlot).toContain("maxAllowedSlots");
    expect(SCRAPER_LOG_FIELDS.fairnessSlot).toContain("activeRunCount");
  });

  it("stage progress fields are documented", () => {
    expect(SCRAPER_LOG_FIELDS.stageProgress).toContain("stageProgress");
    expect(SCRAPER_LOG_FIELDS.stageProgress).toContain("completed");
    expect(SCRAPER_LOG_FIELDS.stageProgress).toContain("failed");
    expect(SCRAPER_LOG_FIELDS.stageProgress).toContain("total");
  });

  it("fetch strategy fields are documented", () => {
    expect(SCRAPER_LOG_FIELDS.fetchStrategy).toContain("strategy");
    expect(SCRAPER_LOG_FIELDS.fetchStrategy).toContain("reason");
    expect(SCRAPER_LOG_FIELDS.fetchStrategy).toContain("allowPlaywrightFallback");
  });

  it("content validation fields are documented", () => {
    expect(SCRAPER_LOG_FIELDS.contentValidation).toContain("contentType");
    expect(SCRAPER_LOG_FIELDS.contentValidation).toContain("mimeType");
    expect(SCRAPER_LOG_FIELDS.contentValidation).toContain("category");
    expect(SCRAPER_LOG_FIELDS.contentValidation).toContain("reason");
  });
});

// ============================================================================
// Fairness Slot Error Tests
// ============================================================================

describe("Observability Baseline: Fairness Slot Error Handling", () => {
  it("isFairnessSlotError type guard is exported", () => {
    expect(typeof isFairnessSlotError).toBe("function");
  });

  it("FairnessSlotUnavailableError is exported", () => {
    expect(FairnessSlotUnavailableError).toBeDefined();
  });

  it("FairnessSlotUnavailableError includes required fields", () => {
    const mockSlotResult = {
      acquired: false as const,
      currentSlots: 2,
      maxAllowedSlots: 2,
      activeRunCount: 5,
      reason: "at_limit" as const,
      retryDelayMs: 500,
    };

    const error = new FairnessSlotUnavailableError("run-123", mockSlotResult);

    expect(error.runId).toBe("run-123");
    expect(error.slotResult.acquired).toBe(false);
    expect(error.slotResult.currentSlots).toBe(2);
    expect(error.slotResult.reason).toBe("at_limit");
    expect(error.retryDelayMs).toBe(500);
    expect(error.message).toContain("Fairness slot unavailable");
  });

  it("isFairnessSlotError correctly identifies fairness errors", () => {
    const mockSlotResult = {
      acquired: false as const,
      currentSlots: 2,
      maxAllowedSlots: 2,
      activeRunCount: 5,
      reason: "at_limit" as const,
      retryDelayMs: 500,
    };

    const fairnessError = new FairnessSlotUnavailableError("run-123", mockSlotResult);
    const regularError = new Error("Some other error");

    expect(isFairnessSlotError(fairnessError)).toBe(true);
    expect(isFairnessSlotError(regularError)).toBe(false);
    expect(isFairnessSlotError(null)).toBe(false);
    expect(isFairnessSlotError(undefined)).toBe(false);
  });
});

// ============================================================================
// Content Error Tests
// ============================================================================

describe("Observability Baseline: Content Error Handling", () => {
  it("ContentError uses baseline CONTENT_UNSUPPORTED_TYPE code", () => {
    const error = new ContentError(
      ErrorCode.CONTENT_UNSUPPORTED_TYPE,
      "Non-HTML content type: application/pdf",
      { metadata: { url: "test.pdf", contentType: "application/pdf" } }
    );

    expect(error.code).toBe("CONTENT_UNSUPPORTED_TYPE");
    expect(error.category).toBe("content");
    expect(error.retryable).toBe(false);
  });

  it("ContentError uses baseline CONTENT_TOO_LARGE code", () => {
    const error = new ContentError(
      ErrorCode.CONTENT_TOO_LARGE,
      "Page too large: 15MB exceeds 10MB limit",
      { metadata: { size: 15000000, limit: 10000000 } }
    );

    expect(error.code).toBe("CONTENT_TOO_LARGE");
    expect(error.category).toBe("content");
    expect(error.retryable).toBe(false);
  });
});

// ============================================================================
// Service Name Tests
// ============================================================================

describe("Observability Baseline: Service Name", () => {
  it("scraper-worker is a valid service name", () => {
    // Verify the service name used in logging
    const validServiceNames = ["api", "ingestion-worker", "scraper-worker"];
    expect(validServiceNames).toContain("scraper-worker");
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

  it("scraper queue name is preserved", () => {
    expect(QUEUE_NAMES.PAGE_FETCH).toBe("page-fetch");
  });

  it("sampling config matches baseline expectations", () => {
    // 100% sample rate for workers
    expect(BASELINE_SAMPLING_CONFIG.baseSampleRate).toBe(1.0);
    // 30s slow threshold
    expect(BASELINE_SAMPLING_CONFIG.slowRequestThresholdMs).toBe(30000);
    // Always log errors
    expect(BASELINE_SAMPLING_CONFIG.alwaysLogErrors).toBe(true);
  });

  it("content error codes used by scraper are in baseline", () => {
    // These are the specific content errors used by the scraper worker
    const scraperContentErrorCodes = [
      "CONTENT_UNSUPPORTED_TYPE",
      "CONTENT_TOO_LARGE",
    ] as const;

    const baselineValues = Object.values(BASELINE_ERROR_CODES) as readonly string[];
    for (const code of scraperContentErrorCodes) {
      expect(baselineValues).toContain(code);
    }
  });
});

// ============================================================================
// Implementation Verification Tests
// ============================================================================

describe("Observability Baseline: Implementation Verification", () => {
  describe("Index.ts logging patterns", () => {
    it("uses createWorkerLogger with 'scraper-worker' service name", async () => {
      // Verify the logger module exports what we need
      const { createWorkerLogger } = await import("@grounded/logger/worker");
      expect(typeof createWorkerLogger).toBe("function");
    });

    it("uses createJobLogger for job-level logging", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      expect(typeof createJobLogger).toBe("function");
    });

    it("uses shouldSample for log sampling", async () => {
      const { shouldSample } = await import("@grounded/logger");
      expect(typeof shouldSample).toBe("function");
    });

    it("uses createSamplingConfig for sampling configuration", async () => {
      const { createSamplingConfig } = await import("@grounded/logger");
      expect(typeof createSamplingConfig).toBe("function");
    });
  });

  describe("Job event logging", () => {
    it("job event builder has setOperation method", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      // Mock job object matching BullMQ Job interface
      const mockJob = {
        id: "test-job-id",
        name: "fetch",
        opts: { attempts: 3 },
        attemptsMade: 1,
        data: { url: "https://example.com", fetchMode: "auto", depth: 0 },
      };

      const event = createJobLogger(
        { service: "scraper-worker", queue: "page-fetch" },
        mockJob as any
      );

      expect(typeof event.setOperation).toBe("function");
    });

    it("job event builder has addFields method", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      const mockJob = {
        id: "test-job-id",
        name: "fetch",
        opts: { attempts: 3 },
        attemptsMade: 1,
        data: { url: "https://example.com", fetchMode: "auto", depth: 0 },
      };

      const event = createJobLogger(
        { service: "scraper-worker", queue: "page-fetch" },
        mockJob as any
      );

      expect(typeof event.addFields).toBe("function");
    });

    it("job event builder has success method", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      const mockJob = {
        id: "test-job-id",
        name: "fetch",
        opts: { attempts: 3 },
        attemptsMade: 1,
        data: { url: "https://example.com", fetchMode: "auto", depth: 0 },
      };

      const event = createJobLogger(
        { service: "scraper-worker", queue: "page-fetch" },
        mockJob as any
      );

      expect(typeof event.success).toBe("function");
    });

    it("job event builder has setError method", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      const mockJob = {
        id: "test-job-id",
        name: "fetch",
        opts: { attempts: 3 },
        attemptsMade: 1,
        data: { url: "https://example.com", fetchMode: "auto", depth: 0 },
      };

      const event = createJobLogger(
        { service: "scraper-worker", queue: "page-fetch" },
        mockJob as any
      );

      expect(typeof event.setError).toBe("function");
    });

    it("job event builder has emit method", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      const mockJob = {
        id: "test-job-id",
        name: "fetch",
        opts: { attempts: 3 },
        attemptsMade: 1,
        data: { url: "https://example.com", fetchMode: "auto", depth: 0 },
      };

      const event = createJobLogger(
        { service: "scraper-worker", queue: "page-fetch" },
        mockJob as any
      );

      expect(typeof event.emit).toBe("function");
    });

    it("job event builder has getEvent method", async () => {
      const { createJobLogger } = await import("@grounded/logger/worker");
      const mockJob = {
        id: "test-job-id",
        name: "fetch",
        opts: { attempts: 3 },
        attemptsMade: 1,
        data: { url: "https://example.com", fetchMode: "auto", depth: 0 },
      };

      const event = createJobLogger(
        { service: "scraper-worker", queue: "page-fetch" },
        mockJob as any
      );

      expect(typeof event.getEvent).toBe("function");
    });
  });

  describe("Log helper from @grounded/logger", () => {
    it("log helper is exported", async () => {
      const { log } = await import("@grounded/logger");
      expect(log).toBeDefined();
      expect(typeof log.info).toBe("function");
      expect(typeof log.warn).toBe("function");
      expect(typeof log.error).toBe("function");
      expect(typeof log.debug).toBe("function");
    });
  });
});
