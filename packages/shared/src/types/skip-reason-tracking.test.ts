import { describe, it, expect } from "bun:test";
import {
  PageStatus,
  SkipReason,
  type PageSkipDetails,
  createNonHtmlSkipDetails,
  createContentUnchangedSkipDetails,
  createRobotsBlockedSkipDetails,
  createDepthExceededSkipDetails,
  createPatternExcludedSkipDetails,
  createAlreadyCrawledSkipDetails,
  skipReasonToPageStatus,
  isSkippedStatus,
  pageStatusToSkipReason,
  IngestionStage as IngestionStageConst,
} from "./index";

// ============================================================================
// PageStatus enum tests
// ============================================================================

describe("PageStatus enum", () => {
  it("should have SUCCEEDED status", () => {
    expect(PageStatus.SUCCEEDED).toBe("succeeded");
  });

  it("should have FAILED status", () => {
    expect(PageStatus.FAILED).toBe("failed");
  });

  it("should have SKIPPED_UNCHANGED status", () => {
    expect(PageStatus.SKIPPED_UNCHANGED).toBe("skipped_unchanged");
  });

  it("should have SKIPPED_NON_HTML status", () => {
    expect(PageStatus.SKIPPED_NON_HTML).toBe("skipped_non_html");
  });

  it("should have exactly 4 statuses", () => {
    const statuses = Object.values(PageStatus);
    expect(statuses).toHaveLength(4);
    expect(statuses).toContain("succeeded");
    expect(statuses).toContain("failed");
    expect(statuses).toContain("skipped_unchanged");
    expect(statuses).toContain("skipped_non_html");
  });
});

// ============================================================================
// SkipReason enum tests
// ============================================================================

describe("SkipReason enum", () => {
  it("should have NON_HTML_CONTENT_TYPE reason", () => {
    expect(SkipReason.NON_HTML_CONTENT_TYPE).toBe("non_html_content_type");
  });

  it("should have CONTENT_UNCHANGED reason", () => {
    expect(SkipReason.CONTENT_UNCHANGED).toBe("content_unchanged");
  });

  it("should have ROBOTS_BLOCKED reason", () => {
    expect(SkipReason.ROBOTS_BLOCKED).toBe("robots_blocked");
  });

  it("should have DEPTH_EXCEEDED reason", () => {
    expect(SkipReason.DEPTH_EXCEEDED).toBe("depth_exceeded");
  });

  it("should have PATTERN_EXCLUDED reason", () => {
    expect(SkipReason.PATTERN_EXCLUDED).toBe("pattern_excluded");
  });

  it("should have ALREADY_CRAWLED reason", () => {
    expect(SkipReason.ALREADY_CRAWLED).toBe("already_crawled");
  });

  it("should have exactly 6 skip reasons", () => {
    const reasons = Object.values(SkipReason);
    expect(reasons).toHaveLength(6);
  });
});

// ============================================================================
// createNonHtmlSkipDetails tests
// ============================================================================

describe("createNonHtmlSkipDetails", () => {
  it("should create skip details for a PDF content type", () => {
    const details = createNonHtmlSkipDetails(
      "application/pdf",
      "application/pdf",
      "non_html",
      200
    );

    expect(details.reason).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(details.description).toBe('Content type "application/pdf" is not HTML');
    expect(details.stage).toBe(IngestionStageConst.FETCH);
    expect(typeof details.skippedAt).toBe("string");
    expect(details.details?.contentType).toBe("application/pdf");
    expect(details.details?.mimeType).toBe("application/pdf");
    expect(details.details?.contentCategory).toBe("non_html");
    expect(details.details?.httpStatus).toBe(200);
  });

  it("should create skip details for an image content type", () => {
    const details = createNonHtmlSkipDetails(
      "image/png; charset=utf-8",
      "image/png",
      "non_html"
    );

    expect(details.reason).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(details.description).toBe('Content type "image/png" is not HTML');
    expect(details.details?.contentType).toBe("image/png; charset=utf-8");
    expect(details.details?.mimeType).toBe("image/png");
    expect(details.details?.httpStatus).toBeUndefined();
  });

  it("should create skip details for unknown content type", () => {
    const details = createNonHtmlSkipDetails(
      "application/x-custom",
      "application/x-custom",
      "unknown"
    );

    expect(details.reason).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(details.details?.contentCategory).toBe("unknown");
  });

  it("should create skip details for JSON content type", () => {
    const details = createNonHtmlSkipDetails(
      "application/json",
      "application/json",
      "non_html",
      200
    );

    expect(details.description).toBe('Content type "application/json" is not HTML');
    expect(details.details?.mimeType).toBe("application/json");
  });

  it("should set skippedAt to a valid ISO timestamp", () => {
    const details = createNonHtmlSkipDetails(
      "application/pdf",
      "application/pdf",
      "non_html"
    );

    // Verify it's a valid ISO date string
    const parsed = new Date(details.skippedAt);
    expect(parsed.toISOString()).toBe(details.skippedAt);
  });
});

// ============================================================================
// createContentUnchangedSkipDetails tests
// ============================================================================

describe("createContentUnchangedSkipDetails", () => {
  it("should create skip details for unchanged content", () => {
    const hash = "abc123def456";
    const details = createContentUnchangedSkipDetails(hash);

    expect(details.reason).toBe(SkipReason.CONTENT_UNCHANGED);
    expect(details.description).toBe("Content unchanged since last crawl");
    expect(details.stage).toBe(IngestionStageConst.FETCH);
    expect(typeof details.skippedAt).toBe("string");
    expect(details.details?.contentHash).toBe(hash);
  });

  it("should handle empty hash", () => {
    const details = createContentUnchangedSkipDetails("");

    expect(details.reason).toBe(SkipReason.CONTENT_UNCHANGED);
    expect(details.details?.contentHash).toBe("");
  });
});

// ============================================================================
// createRobotsBlockedSkipDetails tests
// ============================================================================

describe("createRobotsBlockedSkipDetails", () => {
  it("should create skip details for robots-blocked URL", () => {
    const url = "https://example.com/private/page";
    const details = createRobotsBlockedSkipDetails(url);

    expect(details.reason).toBe(SkipReason.ROBOTS_BLOCKED);
    expect(details.description).toBe("URL blocked by robots.txt");
    expect(details.stage).toBe(IngestionStageConst.DISCOVER);
    expect(typeof details.skippedAt).toBe("string");
  });
});

// ============================================================================
// createDepthExceededSkipDetails tests
// ============================================================================

describe("createDepthExceededSkipDetails", () => {
  it("should create skip details for depth exceeded", () => {
    const details = createDepthExceededSkipDetails(5, 3);

    expect(details.reason).toBe(SkipReason.DEPTH_EXCEEDED);
    expect(details.description).toBe("URL depth 5 exceeds maximum 3");
    expect(details.stage).toBe(IngestionStageConst.DISCOVER);
    expect(typeof details.skippedAt).toBe("string");
    expect(details.details?.depth).toBe(5);
    expect(details.details?.maxDepth).toBe(3);
  });

  it("should handle edge case where depth equals max", () => {
    const details = createDepthExceededSkipDetails(3, 3);

    expect(details.description).toBe("URL depth 3 exceeds maximum 3");
    expect(details.details?.depth).toBe(3);
    expect(details.details?.maxDepth).toBe(3);
  });
});

// ============================================================================
// createPatternExcludedSkipDetails tests
// ============================================================================

describe("createPatternExcludedSkipDetails", () => {
  it("should create skip details for pattern exclusion", () => {
    const pattern = "*/admin/*";
    const details = createPatternExcludedSkipDetails(pattern);

    expect(details.reason).toBe(SkipReason.PATTERN_EXCLUDED);
    expect(details.description).toBe("URL excluded by pattern: */admin/*");
    expect(details.stage).toBe(IngestionStageConst.DISCOVER);
    expect(typeof details.skippedAt).toBe("string");
    expect(details.details?.pattern).toBe(pattern);
  });

  it("should handle regex patterns", () => {
    const pattern = "^https://example\\.com/private/.*$";
    const details = createPatternExcludedSkipDetails(pattern);

    expect(details.details?.pattern).toBe(pattern);
  });
});

// ============================================================================
// createAlreadyCrawledSkipDetails tests
// ============================================================================

describe("createAlreadyCrawledSkipDetails", () => {
  it("should create skip details for already crawled URL", () => {
    const details = createAlreadyCrawledSkipDetails();

    expect(details.reason).toBe(SkipReason.ALREADY_CRAWLED);
    expect(details.description).toBe("URL already crawled in this run");
    expect(details.stage).toBe(IngestionStageConst.DISCOVER);
    expect(typeof details.skippedAt).toBe("string");
    expect(details.details).toBeUndefined();
  });
});

// ============================================================================
// skipReasonToPageStatus tests
// ============================================================================

describe("skipReasonToPageStatus", () => {
  it("should map NON_HTML_CONTENT_TYPE to SKIPPED_NON_HTML", () => {
    const status = skipReasonToPageStatus(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(status).toBe(PageStatus.SKIPPED_NON_HTML);
  });

  it("should map CONTENT_UNCHANGED to SKIPPED_UNCHANGED", () => {
    const status = skipReasonToPageStatus(SkipReason.CONTENT_UNCHANGED);
    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
  });

  it("should map ROBOTS_BLOCKED to SKIPPED_UNCHANGED (placeholder)", () => {
    const status = skipReasonToPageStatus(SkipReason.ROBOTS_BLOCKED);
    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
  });

  it("should map DEPTH_EXCEEDED to SKIPPED_UNCHANGED (placeholder)", () => {
    const status = skipReasonToPageStatus(SkipReason.DEPTH_EXCEEDED);
    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
  });

  it("should map PATTERN_EXCLUDED to SKIPPED_UNCHANGED (placeholder)", () => {
    const status = skipReasonToPageStatus(SkipReason.PATTERN_EXCLUDED);
    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
  });

  it("should map ALREADY_CRAWLED to SKIPPED_UNCHANGED (placeholder)", () => {
    const status = skipReasonToPageStatus(SkipReason.ALREADY_CRAWLED);
    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
  });

  it("should handle unknown reason by returning SKIPPED_UNCHANGED", () => {
    // Type assertion to test default case
    const status = skipReasonToPageStatus("unknown_reason" as SkipReason);
    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
  });
});

// ============================================================================
// isSkippedStatus tests
// ============================================================================

describe("isSkippedStatus", () => {
  it("should return true for SKIPPED_UNCHANGED", () => {
    expect(isSkippedStatus(PageStatus.SKIPPED_UNCHANGED)).toBe(true);
  });

  it("should return true for SKIPPED_NON_HTML", () => {
    expect(isSkippedStatus(PageStatus.SKIPPED_NON_HTML)).toBe(true);
  });

  it("should return false for SUCCEEDED", () => {
    expect(isSkippedStatus(PageStatus.SUCCEEDED)).toBe(false);
  });

  it("should return false for FAILED", () => {
    expect(isSkippedStatus(PageStatus.FAILED)).toBe(false);
  });
});

// ============================================================================
// pageStatusToSkipReason tests
// ============================================================================

describe("pageStatusToSkipReason", () => {
  it("should return NON_HTML_CONTENT_TYPE for SKIPPED_NON_HTML", () => {
    const reason = pageStatusToSkipReason(PageStatus.SKIPPED_NON_HTML);
    expect(reason).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
  });

  it("should return CONTENT_UNCHANGED for SKIPPED_UNCHANGED", () => {
    const reason = pageStatusToSkipReason(PageStatus.SKIPPED_UNCHANGED);
    expect(reason).toBe(SkipReason.CONTENT_UNCHANGED);
  });

  it("should return undefined for SUCCEEDED", () => {
    const reason = pageStatusToSkipReason(PageStatus.SUCCEEDED);
    expect(reason).toBeUndefined();
  });

  it("should return undefined for FAILED", () => {
    const reason = pageStatusToSkipReason(PageStatus.FAILED);
    expect(reason).toBeUndefined();
  });
});

// ============================================================================
// PageSkipDetails interface tests
// ============================================================================

describe("PageSkipDetails interface", () => {
  it("should accept valid skip details with all fields", () => {
    const details: PageSkipDetails = {
      reason: SkipReason.NON_HTML_CONTENT_TYPE,
      description: "Content type is not HTML",
      stage: IngestionStageConst.FETCH,
      skippedAt: new Date().toISOString(),
      details: {
        contentType: "application/pdf",
        mimeType: "application/pdf",
        contentCategory: "non_html",
        httpStatus: 200,
      },
    };

    expect(details.reason).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(details.details?.contentType).toBe("application/pdf");
    expect(details.details?.httpStatus).toBe(200);
  });

  it("should accept valid skip details without optional details", () => {
    const details: PageSkipDetails = {
      reason: SkipReason.ALREADY_CRAWLED,
      description: "URL already crawled",
      stage: IngestionStageConst.DISCOVER,
      skippedAt: new Date().toISOString(),
    };

    expect(details.reason).toBe(SkipReason.ALREADY_CRAWLED);
    expect(details.details).toBeUndefined();
  });

  it("should accept depth-related details", () => {
    const details: PageSkipDetails = {
      reason: SkipReason.DEPTH_EXCEEDED,
      description: "URL exceeds depth limit",
      stage: IngestionStageConst.DISCOVER,
      skippedAt: new Date().toISOString(),
      details: {
        depth: 10,
        maxDepth: 5,
      },
    };

    expect(details.details?.depth).toBe(10);
    expect(details.details?.maxDepth).toBe(5);
  });

  it("should accept pattern-related details", () => {
    const details: PageSkipDetails = {
      reason: SkipReason.PATTERN_EXCLUDED,
      description: "URL matches exclusion pattern",
      stage: IngestionStageConst.DISCOVER,
      skippedAt: new Date().toISOString(),
      details: {
        pattern: "*/admin/*",
      },
    };

    expect(details.details?.pattern).toBe("*/admin/*");
  });

  it("should accept content hash details", () => {
    const details: PageSkipDetails = {
      reason: SkipReason.CONTENT_UNCHANGED,
      description: "Content unchanged",
      stage: IngestionStageConst.FETCH,
      skippedAt: new Date().toISOString(),
      details: {
        contentHash: "sha256:abc123",
      },
    };

    expect(details.details?.contentHash).toBe("sha256:abc123");
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe("Skip reason tracking integration", () => {
  it("should create skip details and convert to page status correctly", () => {
    // Simulate a non-HTML content skip
    const details = createNonHtmlSkipDetails(
      "application/pdf",
      "application/pdf",
      "non_html",
      200
    );

    // Convert to page status
    const status = skipReasonToPageStatus(details.reason);
    expect(status).toBe(PageStatus.SKIPPED_NON_HTML);

    // Verify it's a skipped status
    expect(isSkippedStatus(status)).toBe(true);

    // Convert back to skip reason
    const reasonBack = pageStatusToSkipReason(status);
    expect(reasonBack).toBe(SkipReason.NON_HTML_CONTENT_TYPE);
    expect(reasonBack).toBe(details.reason);
  });

  it("should support round-trip conversion for unchanged content", () => {
    const details = createContentUnchangedSkipDetails("hash123");
    const status = skipReasonToPageStatus(details.reason);
    const reasonBack = pageStatusToSkipReason(status);

    expect(status).toBe(PageStatus.SKIPPED_UNCHANGED);
    expect(reasonBack).toBe(SkipReason.CONTENT_UNCHANGED);
  });

  it("should track correct stages for different skip types", () => {
    // Fetch stage skips
    const nonHtmlSkip = createNonHtmlSkipDetails("application/pdf", "application/pdf", "non_html");
    const unchangedSkip = createContentUnchangedSkipDetails("hash");
    expect(nonHtmlSkip.stage).toBe(IngestionStageConst.FETCH);
    expect(unchangedSkip.stage).toBe(IngestionStageConst.FETCH);

    // Discover stage skips
    const robotsSkip = createRobotsBlockedSkipDetails("https://example.com");
    const depthSkip = createDepthExceededSkipDetails(5, 3);
    const patternSkip = createPatternExcludedSkipDetails("*/admin/*");
    const alreadyCrawled = createAlreadyCrawledSkipDetails();
    expect(robotsSkip.stage).toBe(IngestionStageConst.DISCOVER);
    expect(depthSkip.stage).toBe(IngestionStageConst.DISCOVER);
    expect(patternSkip.stage).toBe(IngestionStageConst.DISCOVER);
    expect(alreadyCrawled.stage).toBe(IngestionStageConst.DISCOVER);
  });

  it("should distinguish between non-HTML categories", () => {
    const blockedType = createNonHtmlSkipDetails(
      "application/pdf",
      "application/pdf",
      "non_html"
    );
    const unknownType = createNonHtmlSkipDetails(
      "application/x-custom",
      "application/x-custom",
      "unknown"
    );

    expect(blockedType.details?.contentCategory).toBe("non_html");
    expect(unknownType.details?.contentCategory).toBe("unknown");
    // Both should have the same skip reason
    expect(blockedType.reason).toBe(unknownType.reason);
  });
});

// ============================================================================
// Type safety tests
// ============================================================================

describe("Type safety", () => {
  it("SkipReason values should be lowercase strings", () => {
    const reasons = Object.values(SkipReason);
    for (const reason of reasons) {
      // Verify it's lowercase by comparing to lowercase version
      const reasonStr = reason as string;
      expect(reasonStr.toLowerCase()).toBe(reasonStr);
      expect(typeof reason).toBe("string");
    }
  });

  it("PageStatus values should be lowercase strings", () => {
    const statuses = Object.values(PageStatus);
    for (const status of statuses) {
      // Verify it's lowercase by comparing to lowercase version
      const statusStr = status as string;
      expect(statusStr.toLowerCase()).toBe(statusStr);
      expect(typeof status).toBe("string");
    }
  });

  it("all SkipReason values should be unique", () => {
    const reasons = Object.values(SkipReason);
    const uniqueReasons = new Set(reasons);
    expect(uniqueReasons.size).toBe(reasons.length);
  });

  it("all PageStatus values should be unique", () => {
    const statuses = Object.values(PageStatus);
    const uniqueStatuses = new Set(statuses);
    expect(uniqueStatuses.size).toBe(statuses.length);
  });
});

// ============================================================================
// Skip counts compatibility tests
// ============================================================================

describe("Skip counts compatibility", () => {
  it("should have corresponding page status for skip reasons with dedicated tracking", () => {
    // These skip reasons should have dedicated page statuses
    const dedicatedReasons = [
      SkipReason.NON_HTML_CONTENT_TYPE,
      SkipReason.CONTENT_UNCHANGED,
    ];

    for (const reason of dedicatedReasons) {
      const status = skipReasonToPageStatus(reason);
      expect(status).not.toBe(PageStatus.FAILED);
      expect(status).not.toBe(PageStatus.SUCCEEDED);
      expect(isSkippedStatus(status)).toBe(true);
    }
  });

  it("should count non-HTML skips separately from content unchanged skips", () => {
    const nonHtmlStatus = skipReasonToPageStatus(SkipReason.NON_HTML_CONTENT_TYPE);
    const unchangedStatus = skipReasonToPageStatus(SkipReason.CONTENT_UNCHANGED);

    expect(nonHtmlStatus).not.toBe(unchangedStatus);
    expect(nonHtmlStatus).toBe(PageStatus.SKIPPED_NON_HTML);
    expect(unchangedStatus).toBe(PageStatus.SKIPPED_UNCHANGED);
  });
});
