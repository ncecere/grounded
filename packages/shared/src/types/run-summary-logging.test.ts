import { describe, it, expect } from "bun:test";
import {
  // Interfaces
  type ErrorBreakdownEntry,
  type SkipBreakdownEntry,
  type StageSummary,
  type RunSummaryLog,
  type RunSummaryLoggingConfig,
  type RunSummaryInput,
  type StructuredRunSummaryLog,
  // Functions
  getDefaultRunSummaryLoggingConfig,
  getSkipReasonDescription,
  getSkipReasonStage,
  parseErrorCodeFromMessage,
  getErrorCategoryFromCode,
  isErrorCodeRetryable,
  buildErrorBreakdown,
  buildSkipBreakdown,
  buildStageSummaries,
  createRunSummaryLog,
  getRunSummaryLogLevel,
  createStructuredRunSummaryLog,
  formatRunSummaryLog,
  shouldLogRunSummary,
  createCompactRunSummary,
  // Related types
  SkipReason,
  IngestionStage,
  type StageMetricsData,
  type PageSkipDetails,
} from "./index.js";

// ============================================================================
// getDefaultRunSummaryLoggingConfig tests
// ============================================================================

describe("getDefaultRunSummaryLoggingConfig", () => {
  it("should return a valid config object", () => {
    const config = getDefaultRunSummaryLoggingConfig();

    expect(config).toBeDefined();
    expect(typeof config.includeStageBreakdown).toBe("boolean");
    expect(typeof config.maxSampleUrls).toBe("number");
    expect(typeof config.logSuccessfulRuns).toBe("boolean");
    expect(typeof config.minPagesForLogging).toBe("number");
    expect(typeof config.includeErrorBreakdown).toBe("boolean");
    expect(typeof config.includeSkipBreakdown).toBe("boolean");
  });

  it("should have stage breakdown enabled by default", () => {
    const config = getDefaultRunSummaryLoggingConfig();
    expect(config.includeStageBreakdown).toBe(true);
  });

  it("should have reasonable max sample URLs", () => {
    const config = getDefaultRunSummaryLoggingConfig();
    expect(config.maxSampleUrls).toBeGreaterThan(0);
    expect(config.maxSampleUrls).toBeLessThanOrEqual(20);
  });

  it("should log successful runs by default", () => {
    const config = getDefaultRunSummaryLoggingConfig();
    expect(config.logSuccessfulRuns).toBe(true);
  });

  it("should have zero minimum pages by default", () => {
    const config = getDefaultRunSummaryLoggingConfig();
    expect(config.minPagesForLogging).toBe(0);
  });

  it("should include error breakdown by default", () => {
    const config = getDefaultRunSummaryLoggingConfig();
    expect(config.includeErrorBreakdown).toBe(true);
  });

  it("should include skip breakdown by default", () => {
    const config = getDefaultRunSummaryLoggingConfig();
    expect(config.includeSkipBreakdown).toBe(true);
  });
});

// ============================================================================
// getSkipReasonDescription tests
// ============================================================================

describe("getSkipReasonDescription", () => {
  it("should return description for NON_HTML_CONTENT_TYPE", () => {
    const desc = getSkipReasonDescription(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(desc).toContain("Non-HTML");
  });

  it("should return description for CONTENT_UNCHANGED", () => {
    const desc = getSkipReasonDescription(SkipReason.CONTENT_UNCHANGED);
    expect(desc.toLowerCase()).toContain("unchanged");
  });

  it("should return description for ROBOTS_BLOCKED", () => {
    const desc = getSkipReasonDescription(SkipReason.ROBOTS_BLOCKED);
    expect(desc.toLowerCase()).toContain("robots");
  });

  it("should return description for DEPTH_EXCEEDED", () => {
    const desc = getSkipReasonDescription(SkipReason.DEPTH_EXCEEDED);
    expect(desc.toLowerCase()).toContain("depth");
  });

  it("should return description for PATTERN_EXCLUDED", () => {
    const desc = getSkipReasonDescription(SkipReason.PATTERN_EXCLUDED);
    expect(desc.toLowerCase()).toContain("pattern");
  });

  it("should return description for ALREADY_CRAWLED", () => {
    const desc = getSkipReasonDescription(SkipReason.ALREADY_CRAWLED);
    expect(desc.toLowerCase()).toContain("already");
  });
});

// ============================================================================
// getSkipReasonStage tests
// ============================================================================

describe("getSkipReasonStage", () => {
  it("should return FETCH stage for NON_HTML_CONTENT_TYPE", () => {
    const stage = getSkipReasonStage(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(stage).toBe(IngestionStage.FETCH);
  });

  it("should return FETCH stage for CONTENT_UNCHANGED", () => {
    const stage = getSkipReasonStage(SkipReason.CONTENT_UNCHANGED);
    expect(stage).toBe(IngestionStage.FETCH);
  });

  it("should return DISCOVER stage for ROBOTS_BLOCKED", () => {
    const stage = getSkipReasonStage(SkipReason.ROBOTS_BLOCKED);
    expect(stage).toBe(IngestionStage.DISCOVER);
  });

  it("should return DISCOVER stage for DEPTH_EXCEEDED", () => {
    const stage = getSkipReasonStage(SkipReason.DEPTH_EXCEEDED);
    expect(stage).toBe(IngestionStage.DISCOVER);
  });

  it("should return DISCOVER stage for PATTERN_EXCLUDED", () => {
    const stage = getSkipReasonStage(SkipReason.PATTERN_EXCLUDED);
    expect(stage).toBe(IngestionStage.DISCOVER);
  });

  it("should return DISCOVER stage for ALREADY_CRAWLED", () => {
    const stage = getSkipReasonStage(SkipReason.ALREADY_CRAWLED);
    expect(stage).toBe(IngestionStage.DISCOVER);
  });
});

// ============================================================================
// parseErrorCodeFromMessage tests
// ============================================================================

describe("parseErrorCodeFromMessage", () => {
  it("should return UNKNOWN_ERROR for empty message", () => {
    expect(parseErrorCodeFromMessage("")).toBe("UNKNOWN_ERROR");
  });

  it("should detect explicit error codes in message", () => {
    expect(parseErrorCodeFromMessage("Error: NETWORK_TIMEOUT occurred")).toBe("NETWORK_TIMEOUT");
    expect(parseErrorCodeFromMessage("SERVICE_RATE_LIMITED: too many requests")).toBe("SERVICE_RATE_LIMITED");
  });

  it("should detect timeout patterns", () => {
    expect(parseErrorCodeFromMessage("Request timed out")).toBe("NETWORK_TIMEOUT");
    expect(parseErrorCodeFromMessage("ETIMEDOUT connecting to server")).toBe("NETWORK_TIMEOUT");
  });

  it("should detect connection refused patterns", () => {
    expect(parseErrorCodeFromMessage("ECONNREFUSED 127.0.0.1:3000")).toBe("NETWORK_CONNECTION_REFUSED");
    expect(parseErrorCodeFromMessage("Connection refused by server")).toBe("NETWORK_CONNECTION_REFUSED");
  });

  it("should detect DNS failure patterns", () => {
    expect(parseErrorCodeFromMessage("ENOTFOUND example.com")).toBe("NETWORK_DNS_FAILURE");
    expect(parseErrorCodeFromMessage("getaddrinfo ENOTFOUND")).toBe("NETWORK_DNS_FAILURE");
    expect(parseErrorCodeFromMessage("DNS lookup failed")).toBe("NETWORK_DNS_FAILURE");
  });

  it("should detect connection reset patterns", () => {
    expect(parseErrorCodeFromMessage("ECONNRESET")).toBe("NETWORK_RESET");
    expect(parseErrorCodeFromMessage("Connection reset by peer")).toBe("NETWORK_RESET");
  });

  it("should detect SSL/TLS patterns", () => {
    expect(parseErrorCodeFromMessage("SSL certificate error")).toBe("NETWORK_SSL_ERROR");
    expect(parseErrorCodeFromMessage("TLS handshake failed")).toBe("NETWORK_SSL_ERROR");
    expect(parseErrorCodeFromMessage("Certificate verification failed")).toBe("NETWORK_SSL_ERROR");
  });

  it("should detect rate limiting patterns", () => {
    expect(parseErrorCodeFromMessage("429 Too Many Requests")).toBe("SERVICE_RATE_LIMITED");
    expect(parseErrorCodeFromMessage("Rate limit exceeded")).toBe("SERVICE_RATE_LIMITED");
  });

  it("should detect service unavailable patterns", () => {
    expect(parseErrorCodeFromMessage("503 Service Unavailable")).toBe("SERVICE_UNAVAILABLE");
  });

  it("should detect bad gateway patterns", () => {
    expect(parseErrorCodeFromMessage("502 Bad Gateway")).toBe("SERVICE_BAD_GATEWAY");
  });

  it("should detect gateway timeout patterns", () => {
    expect(parseErrorCodeFromMessage("504 Gateway Timeout")).toBe("SERVICE_GATEWAY_TIMEOUT");
  });

  it("should detect not found patterns", () => {
    expect(parseErrorCodeFromMessage("404 Not Found")).toBe("NOT_FOUND_URL");
    expect(parseErrorCodeFromMessage("Page not found")).toBe("NOT_FOUND_URL");
  });

  it("should detect auth patterns", () => {
    expect(parseErrorCodeFromMessage("401 Unauthorized")).toBe("AUTH_UNAUTHORIZED");
    expect(parseErrorCodeFromMessage("403 Forbidden")).toBe("AUTH_FORBIDDEN");
  });

  it("should detect content too large patterns", () => {
    expect(parseErrorCodeFromMessage("413 Payload Too Large")).toBe("CONTENT_TOO_LARGE");
    expect(parseErrorCodeFromMessage("Content too large to process")).toBe("CONTENT_TOO_LARGE");
  });

  it("should detect parse error patterns", () => {
    expect(parseErrorCodeFromMessage("Error parsing HTML")).toBe("CONTENT_PARSE_FAILED");
    expect(parseErrorCodeFromMessage("Parsing failed")).toBe("CONTENT_PARSE_FAILED");
  });

  it("should detect encoding error patterns", () => {
    expect(parseErrorCodeFromMessage("Encoding error")).toBe("CONTENT_ENCODING_ERROR");
    expect(parseErrorCodeFromMessage("Failed to decode content")).toBe("CONTENT_ENCODING_ERROR");
  });

  it("should return UNKNOWN_ERROR for unrecognized messages", () => {
    expect(parseErrorCodeFromMessage("Some random error")).toBe("UNKNOWN_ERROR");
  });
});

// ============================================================================
// getErrorCategoryFromCode tests
// ============================================================================

describe("getErrorCategoryFromCode", () => {
  it("should return network category for NETWORK_ codes", () => {
    expect(getErrorCategoryFromCode("NETWORK_TIMEOUT")).toBe("network");
    expect(getErrorCategoryFromCode("NETWORK_DNS_FAILURE")).toBe("network");
  });

  it("should return service category for SERVICE_ codes", () => {
    expect(getErrorCategoryFromCode("SERVICE_RATE_LIMITED")).toBe("service");
    expect(getErrorCategoryFromCode("SERVICE_UNAVAILABLE")).toBe("service");
  });

  it("should return content category for CONTENT_ codes", () => {
    expect(getErrorCategoryFromCode("CONTENT_TOO_LARGE")).toBe("content");
    expect(getErrorCategoryFromCode("CONTENT_PARSE_FAILED")).toBe("content");
  });

  it("should return configuration category for CONFIG_ codes", () => {
    expect(getErrorCategoryFromCode("CONFIG_MISSING")).toBe("configuration");
    expect(getErrorCategoryFromCode("CONFIG_INVALID")).toBe("configuration");
  });

  it("should return not_found category for NOT_FOUND_ codes", () => {
    expect(getErrorCategoryFromCode("NOT_FOUND_URL")).toBe("not_found");
    expect(getErrorCategoryFromCode("NOT_FOUND_KB")).toBe("not_found");
  });

  it("should return validation category for VALIDATION_ codes", () => {
    expect(getErrorCategoryFromCode("VALIDATION_SCHEMA")).toBe("validation");
    expect(getErrorCategoryFromCode("VALIDATION_URL_INVALID")).toBe("validation");
  });

  it("should return auth category for AUTH_ codes", () => {
    expect(getErrorCategoryFromCode("AUTH_FORBIDDEN")).toBe("auth");
    expect(getErrorCategoryFromCode("AUTH_UNAUTHORIZED")).toBe("auth");
  });

  it("should return system category for SYSTEM_ codes", () => {
    expect(getErrorCategoryFromCode("SYSTEM_DATABASE_ERROR")).toBe("system");
    expect(getErrorCategoryFromCode("SYSTEM_OUT_OF_MEMORY")).toBe("system");
  });

  it("should return unknown category for unrecognized codes", () => {
    expect(getErrorCategoryFromCode("UNKNOWN_ERROR")).toBe("unknown");
    expect(getErrorCategoryFromCode("SOME_RANDOM_CODE")).toBe("unknown");
  });
});

// ============================================================================
// isErrorCodeRetryable tests
// ============================================================================

describe("isErrorCodeRetryable", () => {
  it("should mark network errors as retryable (except SSL)", () => {
    expect(isErrorCodeRetryable("NETWORK_TIMEOUT")).toBe(true);
    expect(isErrorCodeRetryable("NETWORK_CONNECTION_REFUSED")).toBe(true);
    expect(isErrorCodeRetryable("NETWORK_DNS_FAILURE")).toBe(true);
    expect(isErrorCodeRetryable("NETWORK_RESET")).toBe(true);
    expect(isErrorCodeRetryable("NETWORK_SSL_ERROR")).toBe(false);
  });

  it("should mark most service errors as retryable", () => {
    expect(isErrorCodeRetryable("SERVICE_UNAVAILABLE")).toBe(true);
    expect(isErrorCodeRetryable("SERVICE_RATE_LIMITED")).toBe(true);
    expect(isErrorCodeRetryable("SERVICE_TIMEOUT")).toBe(true);
    expect(isErrorCodeRetryable("SERVICE_BAD_GATEWAY")).toBe(true);
    expect(isErrorCodeRetryable("SERVICE_GATEWAY_TIMEOUT")).toBe(true);
    expect(isErrorCodeRetryable("SERVICE_OVERLOADED")).toBe(true);
    expect(isErrorCodeRetryable("SERVICE_API_ERROR")).toBe(false);
  });

  it("should mark content errors as permanent", () => {
    expect(isErrorCodeRetryable("CONTENT_TOO_LARGE")).toBe(false);
    expect(isErrorCodeRetryable("CONTENT_PARSE_FAILED")).toBe(false);
    expect(isErrorCodeRetryable("CONTENT_EMPTY")).toBe(false);
  });

  it("should mark config errors as permanent", () => {
    expect(isErrorCodeRetryable("CONFIG_MISSING")).toBe(false);
    expect(isErrorCodeRetryable("CONFIG_INVALID")).toBe(false);
  });

  it("should mark not_found errors as permanent", () => {
    expect(isErrorCodeRetryable("NOT_FOUND_URL")).toBe(false);
    expect(isErrorCodeRetryable("NOT_FOUND_KB")).toBe(false);
  });

  it("should mark validation errors as permanent", () => {
    expect(isErrorCodeRetryable("VALIDATION_SCHEMA")).toBe(false);
    expect(isErrorCodeRetryable("VALIDATION_URL_INVALID")).toBe(false);
  });

  it("should mark auth errors as permanent", () => {
    expect(isErrorCodeRetryable("AUTH_FORBIDDEN")).toBe(false);
    expect(isErrorCodeRetryable("AUTH_UNAUTHORIZED")).toBe(false);
  });

  it("should handle system errors appropriately", () => {
    expect(isErrorCodeRetryable("SYSTEM_OUT_OF_MEMORY")).toBe(true);
    expect(isErrorCodeRetryable("SYSTEM_DATABASE_ERROR")).toBe(true);
    expect(isErrorCodeRetryable("SYSTEM_DISK_FULL")).toBe(false);
  });

  it("should default unknown errors to retryable", () => {
    expect(isErrorCodeRetryable("UNKNOWN_ERROR")).toBe(true);
    expect(isErrorCodeRetryable("RANDOM_CODE")).toBe(true);
  });
});

// ============================================================================
// buildErrorBreakdown tests
// ============================================================================

describe("buildErrorBreakdown", () => {
  it("should return empty array for no failures", () => {
    const breakdown = buildErrorBreakdown([]);
    expect(breakdown).toEqual([]);
  });

  it("should group failures by error code", () => {
    const failedPages = [
      { url: "https://example.com/1", error: "NETWORK_TIMEOUT" },
      { url: "https://example.com/2", error: "NETWORK_TIMEOUT" },
      { url: "https://example.com/3", error: "404 Not Found" },
    ];

    const breakdown = buildErrorBreakdown(failedPages);

    expect(breakdown).toHaveLength(2);
    expect(breakdown[0].code).toBe("NETWORK_TIMEOUT");
    expect(breakdown[0].count).toBe(2);
    expect(breakdown[1].code).toBe("NOT_FOUND_URL");
    expect(breakdown[1].count).toBe(1);
  });

  it("should sort by count descending", () => {
    const failedPages = [
      { url: "https://example.com/1", error: "404 Not Found" },
      { url: "https://example.com/2", error: "NETWORK_TIMEOUT" },
      { url: "https://example.com/3", error: "NETWORK_TIMEOUT" },
      { url: "https://example.com/4", error: "NETWORK_TIMEOUT" },
    ];

    const breakdown = buildErrorBreakdown(failedPages);

    expect(breakdown[0].code).toBe("NETWORK_TIMEOUT");
    expect(breakdown[0].count).toBe(3);
    expect(breakdown[1].code).toBe("NOT_FOUND_URL");
    expect(breakdown[1].count).toBe(1);
  });

  it("should include category and retryable status", () => {
    const failedPages = [
      { url: "https://example.com/1", error: "NETWORK_TIMEOUT" },
    ];

    const breakdown = buildErrorBreakdown(failedPages);

    expect(breakdown[0].category).toBe("network");
    expect(breakdown[0].retryable).toBe(true);
  });

  it("should limit sample URLs", () => {
    const failedPages = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${i}`,
      error: "NETWORK_TIMEOUT",
    }));

    const breakdown = buildErrorBreakdown(failedPages, 3);

    expect(breakdown[0].sampleUrls).toHaveLength(3);
  });
});

// ============================================================================
// buildSkipBreakdown tests
// ============================================================================

describe("buildSkipBreakdown", () => {
  it("should return empty array for no skips", () => {
    const breakdown = buildSkipBreakdown([]);
    expect(breakdown).toEqual([]);
  });

  it("should group skips by reason", () => {
    const skippedPages = [
      { url: "https://example.com/1", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
      { url: "https://example.com/2", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
      { url: "https://example.com/3", skipDetails: { reason: SkipReason.NON_HTML_CONTENT_TYPE } as PageSkipDetails },
    ];

    const breakdown = buildSkipBreakdown(skippedPages);

    expect(breakdown).toHaveLength(2);
    expect(breakdown[0].reason).toBe(SkipReason.ROBOTS_BLOCKED);
    expect(breakdown[0].count).toBe(2);
    expect(breakdown[1].reason).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(breakdown[1].count).toBe(1);
  });

  it("should default to CONTENT_UNCHANGED when no skip details", () => {
    const skippedPages = [
      { url: "https://example.com/1" },
      { url: "https://example.com/2" },
    ];

    const breakdown = buildSkipBreakdown(skippedPages);

    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].reason).toBe(SkipReason.CONTENT_UNCHANGED);
    expect(breakdown[0].count).toBe(2);
  });

  it("should include description and stage", () => {
    const skippedPages = [
      { url: "https://example.com/1", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED, stage: IngestionStage.DISCOVER } as PageSkipDetails },
    ];

    const breakdown = buildSkipBreakdown(skippedPages);

    expect(breakdown[0].description).toBeDefined();
    expect(breakdown[0].stage).toBe(IngestionStage.DISCOVER);
  });

  it("should limit sample URLs", () => {
    const skippedPages = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/${i}`,
      skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails,
    }));

    const breakdown = buildSkipBreakdown(skippedPages, 3);

    expect(breakdown[0].sampleUrls).toHaveLength(3);
  });
});

// ============================================================================
// buildStageSummaries tests
// ============================================================================

describe("buildStageSummaries", () => {
  it("should return empty array for no stage data", () => {
    const summaries = buildStageSummaries({});
    expect(summaries).toEqual([]);
  });

  it("should build summaries for stages with data", () => {
    const stageMetrics: Partial<Record<IngestionStage, StageMetricsData>> = {
      [IngestionStage.FETCH]: {
        completed: 80,
        failed: 10,
        skipped: 10,
        latencyStats: { minMs: 0, maxMs: 0, sumMs: 0, count: 0, averageMs: 0 },
      },
    };

    const summaries = buildStageSummaries(stageMetrics);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].stage).toBe(IngestionStage.FETCH);
    expect(summaries[0].completed).toBe(80);
    expect(summaries[0].failed).toBe(10);
    expect(summaries[0].skipped).toBe(10);
    expect(summaries[0].total).toBe(100);
    expect(summaries[0].successRate).toBe(80);
  });

  it("should calculate success rate correctly", () => {
    const stageMetrics: Partial<Record<IngestionStage, StageMetricsData>> = {
      [IngestionStage.EXTRACT]: {
        completed: 7,
        failed: 3,
        skipped: 0,
        latencyStats: { minMs: 0, maxMs: 0, sumMs: 0, count: 0, averageMs: 0 },
      },
    };

    const summaries = buildStageSummaries(stageMetrics);

    expect(summaries[0].successRate).toBe(70);
  });

  it("should handle zero total items", () => {
    const stageMetrics: Partial<Record<IngestionStage, StageMetricsData>> = {
      [IngestionStage.CHUNK]: {
        completed: 0,
        failed: 0,
        skipped: 0,
        latencyStats: { minMs: 0, maxMs: 0, sumMs: 0, count: 0, averageMs: 0 },
      },
    };

    const summaries = buildStageSummaries(stageMetrics);

    expect(summaries[0].successRate).toBe(0);
  });
});

// ============================================================================
// createRunSummaryLog tests
// ============================================================================

describe("createRunSummaryLog", () => {
  const baseInput: RunSummaryInput = {
    runId: "run-123",
    sourceId: "source-456",
    tenantId: "tenant-789",
    finalStatus: "succeeded",
    runStartedAt: new Date("2024-01-01T10:00:00Z"),
    runFinishedAt: new Date("2024-01-01T10:05:00Z"),
    pages: {
      total: 100,
      succeeded: 80,
      failed: 10,
      skipped: 10,
    },
    failedPages: [],
    skippedPages: [],
  };

  it("should create a valid run summary log", () => {
    const summary = createRunSummaryLog(baseInput);

    expect(summary.event).toBe("run_summary");
    expect(summary.runId).toBe("run-123");
    expect(summary.sourceId).toBe("source-456");
    expect(summary.tenantId).toBe("tenant-789");
    expect(summary.finalStatus).toBe("succeeded");
    expect(summary.runDurationMs).toBe(300000); // 5 minutes
  });

  it("should calculate page statistics correctly", () => {
    const summary = createRunSummaryLog(baseInput);

    expect(summary.pages.total).toBe(100);
    expect(summary.pages.succeeded).toBe(80);
    expect(summary.pages.failed).toBe(10);
    expect(summary.pages.skipped).toBe(10);
    expect(summary.pages.successRate).toBe(80);
  });

  it("should include timestamp", () => {
    const summary = createRunSummaryLog(baseInput);

    expect(summary.timestamp).toBeDefined();
    expect(new Date(summary.timestamp)).toBeInstanceOf(Date);
  });

  it("should include embedding stats when provided", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      embeddings: {
        chunksToEmbed: 500,
        chunksEmbedded: 480,
        chunksFailed: 20,
      },
    };

    const summary = createRunSummaryLog(input);

    expect(summary.embeddings).toBeDefined();
    expect(summary.embeddings!.chunksToEmbed).toBe(500);
    expect(summary.embeddings!.chunksEmbedded).toBe(480);
    expect(summary.embeddings!.chunksFailed).toBe(20);
    expect(summary.embeddings!.completionRate).toBe(96);
  });

  it("should build error breakdown from failed pages", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      failedPages: [
        { url: "https://example.com/1", error: "NETWORK_TIMEOUT" },
        { url: "https://example.com/2", error: "404 Not Found" },
      ],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.errorBreakdown).toHaveLength(2);
    expect(summary.summary.uniqueErrorCodes).toBe(2);
  });

  it("should build skip breakdown from skipped pages", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      skippedPages: [
        { url: "https://example.com/1", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
        { url: "https://example.com/2", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
      ],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.skipBreakdown).toHaveLength(1);
    expect(summary.skipBreakdown[0].count).toBe(2);
    expect(summary.summary.uniqueSkipReasons).toBe(1);
  });

  it("should identify most common error", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      failedPages: [
        { url: "https://example.com/1", error: "NETWORK_TIMEOUT" },
        { url: "https://example.com/2", error: "NETWORK_TIMEOUT" },
        { url: "https://example.com/3", error: "404 Not Found" },
      ],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.summary.mostCommonError).toBeDefined();
    expect(summary.summary.mostCommonError!.code).toBe("NETWORK_TIMEOUT");
    expect(summary.summary.mostCommonError!.count).toBe(2);
  });

  it("should identify most common skip", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      skippedPages: [
        { url: "https://example.com/1", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
        { url: "https://example.com/2", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
        { url: "https://example.com/3", skipDetails: { reason: SkipReason.NON_HTML_CONTENT_TYPE } as PageSkipDetails },
      ],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.summary.mostCommonSkip).toBeDefined();
    expect(summary.summary.mostCommonSkip!.reason).toBe(SkipReason.ROBOTS_BLOCKED);
    expect(summary.summary.mostCommonSkip!.count).toBe(2);
  });

  it("should detect retryable and permanent errors", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      failedPages: [
        { url: "https://example.com/1", error: "NETWORK_TIMEOUT" }, // retryable
        { url: "https://example.com/2", error: "CONTENT_TOO_LARGE" }, // permanent
      ],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.summary.hasRetryableErrors).toBe(true);
    expect(summary.summary.hasPermanentErrors).toBe(true);
  });

  it("should respect config to exclude error breakdown", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      failedPages: [
        { url: "https://example.com/1", error: "NETWORK_TIMEOUT" },
      ],
    };
    const config: RunSummaryLoggingConfig = {
      ...getDefaultRunSummaryLoggingConfig(),
      includeErrorBreakdown: false,
    };

    const summary = createRunSummaryLog(input, config);

    expect(summary.errorBreakdown).toEqual([]);
  });

  it("should respect config to exclude skip breakdown", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      skippedPages: [
        { url: "https://example.com/1", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED } as PageSkipDetails },
      ],
    };
    const config: RunSummaryLoggingConfig = {
      ...getDefaultRunSummaryLoggingConfig(),
      includeSkipBreakdown: false,
    };

    const summary = createRunSummaryLog(input, config);

    expect(summary.skipBreakdown).toEqual([]);
  });

  it("should include stage summaries when requested and available", () => {
    const input: RunSummaryInput = {
      ...baseInput,
      stageMetrics: {
        [IngestionStage.FETCH]: {
          completed: 80,
          failed: 10,
          skipped: 10,
          latencyStats: { minMs: 0, maxMs: 0, sumMs: 0, count: 0, averageMs: 0 },
        },
      },
    };

    const summary = createRunSummaryLog(input);

    expect(summary.stageSummaries).toBeDefined();
    expect(summary.stageSummaries).toHaveLength(1);
  });
});

// ============================================================================
// getRunSummaryLogLevel tests
// ============================================================================

describe("getRunSummaryLogLevel", () => {
  it("should return error for failed status", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "failed",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 0, failed: 100, skipped: 0, successRate: 0 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    expect(getRunSummaryLogLevel(summary)).toBe("error");
  });

  it("should return warn for partial status", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "partial",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 80, failed: 20, skipped: 0, successRate: 80 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    expect(getRunSummaryLogLevel(summary)).toBe("warn");
  });

  it("should return warn for embedding_incomplete status", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "embedding_incomplete",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    expect(getRunSummaryLogLevel(summary)).toBe("warn");
  });

  it("should return warn for succeeded with failures", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 95, failed: 5, skipped: 0, successRate: 95 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    expect(getRunSummaryLogLevel(summary)).toBe("warn");
  });

  it("should return info for clean success", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    expect(getRunSummaryLogLevel(summary)).toBe("info");
  });
});

// ============================================================================
// createStructuredRunSummaryLog tests
// ============================================================================

describe("createStructuredRunSummaryLog", () => {
  it("should add level and service to summary", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const structured = createStructuredRunSummaryLog(summary, "my-service");

    expect(structured.level).toBe("info");
    expect(structured.service).toBe("my-service");
  });

  it("should use default service name", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const structured = createStructuredRunSummaryLog(summary);

    expect(structured.service).toBe("ingestion-worker");
  });
});

// ============================================================================
// formatRunSummaryLog tests
// ============================================================================

describe("formatRunSummaryLog", () => {
  it("should format basic summary", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 5000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 80, failed: 10, skipped: 10, successRate: 80 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const formatted = formatRunSummaryLog(summary);

    expect(formatted).toContain("run-123");
    expect(formatted).toContain("SUCCEEDED");
    expect(formatted).toContain("5.00s");
    expect(formatted).toContain("Total: 100");
    expect(formatted).toContain("Succeeded: 80");
    expect(formatted).toContain("Failed: 10");
    expect(formatted).toContain("Skipped: 10");
  });

  it("should include embeddings section when present", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      embeddings: { chunksToEmbed: 500, chunksEmbedded: 480, chunksFailed: 20, completionRate: 96 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const formatted = formatRunSummaryLog(summary);

    expect(formatted).toContain("Embeddings:");
    expect(formatted).toContain("Chunks to Embed: 500");
    expect(formatted).toContain("Chunks Embedded: 480");
  });

  it("should include error breakdown when present", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "partial",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 90, failed: 10, skipped: 0, successRate: 90 },
      errorBreakdown: [
        { code: "NETWORK_TIMEOUT", category: "network", retryable: true, count: 7, sampleUrls: ["https://example.com/1"] },
        { code: "NOT_FOUND_URL", category: "not_found", retryable: false, count: 3, sampleUrls: [] },
      ],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 2, uniqueSkipReasons: 0, hasRetryableErrors: true, hasPermanentErrors: true },
    };

    const formatted = formatRunSummaryLog(summary);

    expect(formatted).toContain("Error Breakdown:");
    expect(formatted).toContain("NETWORK_TIMEOUT");
    expect(formatted).toContain("[retryable]");
    expect(formatted).toContain("NOT_FOUND_URL");
    expect(formatted).toContain("[permanent]");
  });

  it("should include skip breakdown when present", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 90, failed: 0, skipped: 10, successRate: 90 },
      errorBreakdown: [],
      skipBreakdown: [
        { reason: SkipReason.ROBOTS_BLOCKED, description: "Blocked by robots.txt", stage: IngestionStage.DISCOVER, count: 10, sampleUrls: [] },
      ],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 1, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const formatted = formatRunSummaryLog(summary);

    expect(formatted).toContain("Skip Breakdown:");
    expect(formatted).toContain("robots_blocked");
    expect(formatted).toContain("Blocked by robots.txt");
  });
});

// ============================================================================
// shouldLogRunSummary tests
// ============================================================================

describe("shouldLogRunSummary", () => {
  const baseSummary: RunSummaryLog = {
    event: "run_summary",
    runId: "run-123",
    sourceId: "source-456",
    tenantId: "tenant-789",
    timestamp: new Date().toISOString(),
    finalStatus: "succeeded",
    runDurationMs: 1000,
    runStartedAt: new Date().toISOString(),
    runFinishedAt: new Date().toISOString(),
    pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
    errorBreakdown: [],
    skipBreakdown: [],
    summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
  };

  it("should return true by default", () => {
    expect(shouldLogRunSummary(baseSummary)).toBe(true);
  });

  it("should respect minPagesForLogging", () => {
    const smallRunSummary = { ...baseSummary, pages: { ...baseSummary.pages, total: 5 } };
    const config: RunSummaryLoggingConfig = {
      ...getDefaultRunSummaryLoggingConfig(),
      minPagesForLogging: 10,
    };

    expect(shouldLogRunSummary(smallRunSummary, config)).toBe(false);
  });

  it("should respect logSuccessfulRuns setting", () => {
    const config: RunSummaryLoggingConfig = {
      ...getDefaultRunSummaryLoggingConfig(),
      logSuccessfulRuns: false,
    };

    expect(shouldLogRunSummary(baseSummary, config)).toBe(false);
  });

  it("should log failed runs even if logSuccessfulRuns is false", () => {
    const failedSummary = { ...baseSummary, finalStatus: "failed" as const };
    const config: RunSummaryLoggingConfig = {
      ...getDefaultRunSummaryLoggingConfig(),
      logSuccessfulRuns: false,
    };

    expect(shouldLogRunSummary(failedSummary, config)).toBe(true);
  });
});

// ============================================================================
// createCompactRunSummary tests
// ============================================================================

describe("createCompactRunSummary", () => {
  it("should create compact summary string", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 5000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 80, failed: 10, skipped: 10, successRate: 80 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const compact = createCompactRunSummary(summary);

    expect(compact).toContain("status=succeeded");
    expect(compact).toContain("pages=80/100");
    expect(compact).toContain("failed=10");
    expect(compact).toContain("skipped=10");
    expect(compact).toContain("duration=5.0s");
  });

  it("should include embedding info when present", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      embeddings: { chunksToEmbed: 500, chunksEmbedded: 480, chunksFailed: 20, completionRate: 96 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    const compact = createCompactRunSummary(summary);

    expect(compact).toContain("embedded=480/500");
  });

  it("should include top error when present", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "partial",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 90, failed: 10, skipped: 0, successRate: 90 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: {
        uniqueErrorCodes: 1,
        uniqueSkipReasons: 0,
        hasRetryableErrors: true,
        hasPermanentErrors: false,
        mostCommonError: { code: "NETWORK_TIMEOUT", count: 10 },
      },
    };

    const compact = createCompactRunSummary(summary);

    expect(compact).toContain("top_error=NETWORK_TIMEOUT(10)");
  });

  it("should include top skip when present", () => {
    const summary: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 90, failed: 0, skipped: 10, successRate: 90 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: {
        uniqueErrorCodes: 0,
        uniqueSkipReasons: 1,
        hasRetryableErrors: false,
        hasPermanentErrors: false,
        mostCommonSkip: { reason: SkipReason.ROBOTS_BLOCKED, count: 10 },
      },
    };

    const compact = createCompactRunSummary(summary);

    expect(compact).toContain("top_skip=robots_blocked(10)");
  });
});

// ============================================================================
// Interface compliance tests
// ============================================================================

describe("Interface compliance", () => {
  it("ErrorBreakdownEntry should have required fields", () => {
    const entry: ErrorBreakdownEntry = {
      code: "NETWORK_TIMEOUT",
      category: "network",
      retryable: true,
      count: 5,
      sampleUrls: ["https://example.com"],
    };

    expect(entry.code).toBeDefined();
    expect(entry.category).toBeDefined();
    expect(typeof entry.retryable).toBe("boolean");
    expect(typeof entry.count).toBe("number");
    expect(Array.isArray(entry.sampleUrls)).toBe(true);
  });

  it("SkipBreakdownEntry should have required fields", () => {
    const entry: SkipBreakdownEntry = {
      reason: SkipReason.ROBOTS_BLOCKED,
      description: "Blocked by robots.txt",
      stage: IngestionStage.DISCOVER,
      count: 10,
      sampleUrls: [],
    };

    expect(entry.reason).toBeDefined();
    expect(entry.description).toBeDefined();
    expect(entry.stage).toBeDefined();
    expect(typeof entry.count).toBe("number");
    expect(Array.isArray(entry.sampleUrls)).toBe(true);
  });

  it("StageSummary should have required fields", () => {
    const summary: StageSummary = {
      stage: IngestionStage.FETCH,
      completed: 80,
      failed: 10,
      skipped: 10,
      total: 100,
      successRate: 80,
    };

    expect(summary.stage).toBeDefined();
    expect(typeof summary.completed).toBe("number");
    expect(typeof summary.failed).toBe("number");
    expect(typeof summary.skipped).toBe("number");
    expect(typeof summary.total).toBe("number");
    expect(typeof summary.successRate).toBe("number");
  });

  it("RunSummaryLog should have required fields", () => {
    const log: RunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
    };

    expect(log.event).toBe("run_summary");
    expect(log.runId).toBeDefined();
    expect(log.sourceId).toBeDefined();
    expect(log.tenantId).toBeDefined();
    expect(log.timestamp).toBeDefined();
    expect(log.finalStatus).toBeDefined();
    expect(typeof log.runDurationMs).toBe("number");
    expect(log.pages).toBeDefined();
    expect(Array.isArray(log.errorBreakdown)).toBe(true);
    expect(Array.isArray(log.skipBreakdown)).toBe(true);
    expect(log.summary).toBeDefined();
  });

  it("StructuredRunSummaryLog should extend RunSummaryLog", () => {
    const log: StructuredRunSummaryLog = {
      event: "run_summary",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      timestamp: new Date().toISOString(),
      finalStatus: "succeeded",
      runDurationMs: 1000,
      runStartedAt: new Date().toISOString(),
      runFinishedAt: new Date().toISOString(),
      pages: { total: 100, succeeded: 100, failed: 0, skipped: 0, successRate: 100 },
      errorBreakdown: [],
      skipBreakdown: [],
      summary: { uniqueErrorCodes: 0, uniqueSkipReasons: 0, hasRetryableErrors: false, hasPermanentErrors: false },
      level: "info",
      service: "ingestion-worker",
    };

    expect(log.level).toBeDefined();
    expect(log.service).toBeDefined();
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe("Integration tests", () => {
  it("should handle complete run summary workflow", () => {
    // Create input data
    const input: RunSummaryInput = {
      runId: "run-integration-test",
      sourceId: "source-123",
      tenantId: "tenant-456",
      finalStatus: "partial",
      runStartedAt: new Date("2024-01-01T10:00:00Z"),
      runFinishedAt: new Date("2024-01-01T10:10:00Z"),
      pages: {
        total: 100,
        succeeded: 70,
        failed: 20,
        skipped: 10,
      },
      embeddings: {
        chunksToEmbed: 350,
        chunksEmbedded: 340,
        chunksFailed: 10,
      },
      failedPages: [
        { url: "https://example.com/1", error: "NETWORK_TIMEOUT" },
        { url: "https://example.com/2", error: "NETWORK_TIMEOUT" },
        { url: "https://example.com/3", error: "NETWORK_TIMEOUT" },
        { url: "https://example.com/4", error: "404 Not Found" },
        { url: "https://example.com/5", error: "404 Not Found" },
        { url: "https://example.com/6", error: "CONTENT_TOO_LARGE" },
      ],
      skippedPages: [
        { url: "https://example.com/skip1", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED, description: "Blocked", stage: IngestionStage.DISCOVER, skippedAt: new Date().toISOString() } },
        { url: "https://example.com/skip2", skipDetails: { reason: SkipReason.ROBOTS_BLOCKED, description: "Blocked", stage: IngestionStage.DISCOVER, skippedAt: new Date().toISOString() } },
        { url: "https://example.com/skip3", skipDetails: { reason: SkipReason.NON_HTML_CONTENT_TYPE, description: "PDF file", stage: IngestionStage.FETCH, skippedAt: new Date().toISOString() } },
      ],
      stageMetrics: {
        [IngestionStage.FETCH]: {
          completed: 70,
          failed: 20,
          skipped: 10,
          latencyStats: { minMs: 100, maxMs: 5000, sumMs: 70000, count: 70, averageMs: 1000 },
        },
        [IngestionStage.EXTRACT]: {
          completed: 70,
          failed: 0,
          skipped: 0,
          latencyStats: { minMs: 50, maxMs: 200, sumMs: 7000, count: 70, averageMs: 100 },
        },
      },
    };

    // Create summary
    const summary = createRunSummaryLog(input);

    // Verify basic fields
    expect(summary.runId).toBe("run-integration-test");
    expect(summary.finalStatus).toBe("partial");
    expect(summary.runDurationMs).toBe(600000); // 10 minutes

    // Verify page stats
    expect(summary.pages.total).toBe(100);
    expect(summary.pages.succeeded).toBe(70);
    expect(summary.pages.failed).toBe(20);
    expect(summary.pages.skipped).toBe(10);
    expect(summary.pages.successRate).toBe(70);

    // Verify embeddings
    expect(summary.embeddings).toBeDefined();
    expect(summary.embeddings!.chunksToEmbed).toBe(350);
    expect(summary.embeddings!.chunksEmbedded).toBe(340);
    expect(summary.embeddings!.chunksFailed).toBe(10);

    // Verify error breakdown
    expect(summary.errorBreakdown.length).toBeGreaterThan(0);
    expect(summary.summary.uniqueErrorCodes).toBe(3); // NETWORK_TIMEOUT, NOT_FOUND_URL, CONTENT_TOO_LARGE
    expect(summary.summary.mostCommonError!.code).toBe("NETWORK_TIMEOUT");
    expect(summary.summary.mostCommonError!.count).toBe(3);
    expect(summary.summary.hasRetryableErrors).toBe(true);
    expect(summary.summary.hasPermanentErrors).toBe(true);

    // Verify skip breakdown
    expect(summary.skipBreakdown.length).toBe(2);
    expect(summary.summary.uniqueSkipReasons).toBe(2);
    expect(summary.summary.mostCommonSkip!.reason).toBe(SkipReason.ROBOTS_BLOCKED);
    expect(summary.summary.mostCommonSkip!.count).toBe(2);

    // Verify stage summaries
    expect(summary.stageSummaries).toBeDefined();
    expect(summary.stageSummaries!.length).toBe(2);

    // Create structured log
    const structured = createStructuredRunSummaryLog(summary);
    expect(structured.level).toBe("warn"); // partial status

    // Format for human reading
    const formatted = formatRunSummaryLog(summary);
    expect(formatted).toContain("run-integration-test");
    expect(formatted).toContain("PARTIAL");
    expect(formatted).toContain("Error Breakdown:");
    expect(formatted).toContain("Skip Breakdown:");

    // Create compact summary
    const compact = createCompactRunSummary(summary);
    expect(compact).toContain("status=partial");
    expect(compact).toContain("pages=70/100");
    expect(compact).toContain("embedded=340/350");
    expect(compact).toContain("top_error=NETWORK_TIMEOUT(3)");
    expect(compact).toContain("top_skip=robots_blocked(2)");

    // Check if should log
    expect(shouldLogRunSummary(summary)).toBe(true);
  });

  it("should handle successful run with no errors or skips", () => {
    const input: RunSummaryInput = {
      runId: "run-success",
      sourceId: "source-123",
      tenantId: "tenant-456",
      finalStatus: "succeeded",
      runStartedAt: new Date("2024-01-01T10:00:00Z"),
      runFinishedAt: new Date("2024-01-01T10:01:00Z"),
      pages: {
        total: 50,
        succeeded: 50,
        failed: 0,
        skipped: 0,
      },
      failedPages: [],
      skippedPages: [],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.finalStatus).toBe("succeeded");
    expect(summary.pages.successRate).toBe(100);
    expect(summary.errorBreakdown).toEqual([]);
    expect(summary.skipBreakdown).toEqual([]);
    expect(summary.summary.uniqueErrorCodes).toBe(0);
    expect(summary.summary.uniqueSkipReasons).toBe(0);
    expect(summary.summary.hasRetryableErrors).toBe(false);
    expect(summary.summary.hasPermanentErrors).toBe(false);
    expect(summary.summary.mostCommonError).toBeUndefined();
    expect(summary.summary.mostCommonSkip).toBeUndefined();

    expect(getRunSummaryLogLevel(summary)).toBe("info");
  });

  it("should handle failed run with all permanent errors", () => {
    const input: RunSummaryInput = {
      runId: "run-failed",
      sourceId: "source-123",
      tenantId: "tenant-456",
      finalStatus: "failed",
      runStartedAt: new Date("2024-01-01T10:00:00Z"),
      runFinishedAt: new Date("2024-01-01T10:00:30Z"),
      pages: {
        total: 10,
        succeeded: 0,
        failed: 10,
        skipped: 0,
      },
      failedPages: Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/${i}`,
        error: "CONTENT_TOO_LARGE",
      })),
      skippedPages: [],
    };

    const summary = createRunSummaryLog(input);

    expect(summary.finalStatus).toBe("failed");
    expect(summary.pages.successRate).toBe(0);
    expect(summary.errorBreakdown.length).toBe(1);
    expect(summary.errorBreakdown[0].code).toBe("CONTENT_TOO_LARGE");
    expect(summary.errorBreakdown[0].count).toBe(10);
    expect(summary.errorBreakdown[0].retryable).toBe(false);
    expect(summary.summary.hasRetryableErrors).toBe(false);
    expect(summary.summary.hasPermanentErrors).toBe(true);

    expect(getRunSummaryLogLevel(summary)).toBe("error");
  });
});
