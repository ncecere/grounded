import { describe, it, expect } from "bun:test";
import {
  // Enums and types
  RobotsOverrideType,
  type RobotsOverrideLog,
  type RobotsBlockedUrlLog,
  type RobotsBlockedSummaryLog,
  type RobotsLoggingConfig,
  // Functions
  getDefaultRobotsLoggingConfig,
  createRobotsOverrideLog,
  createRobotsBlockedUrlLog,
  createRobotsBlockedSummaryLog,
  formatRobotsOverrideLog,
  formatRobotsBlockedUrlLog,
  formatRobotsBlockedSummaryLog,
  createStructuredRobotsOverrideLog,
  createStructuredRobotsBlockedSummaryLog,
  shouldLogRobotsOverride,
  shouldLogIndividualBlocks,
  // Related constants
  ROBOTS_USER_AGENT,
} from "./index.js";

// ============================================================================
// RobotsOverrideType enum tests
// ============================================================================

describe("RobotsOverrideType", () => {
  it("should have SOURCE_OVERRIDE value", () => {
    const value: string = RobotsOverrideType.SOURCE_OVERRIDE;
    expect(value).toBe("source_override");
  });

  it("should have GLOBAL_DISABLED value", () => {
    const value: string = RobotsOverrideType.GLOBAL_DISABLED;
    expect(value).toBe("global_disabled");
  });

  it("should have exactly 2 values", () => {
    const values = Object.values(RobotsOverrideType);
    expect(values).toHaveLength(2);
  });
});

// ============================================================================
// getDefaultRobotsLoggingConfig tests
// ============================================================================

describe("getDefaultRobotsLoggingConfig", () => {
  it("should return a valid config object", () => {
    const config = getDefaultRobotsLoggingConfig();

    expect(config).toBeDefined();
    expect(typeof config.logIndividualBlocks).toBe("boolean");
    expect(typeof config.maxSampleSize).toBe("number");
    expect(typeof config.logOverrides).toBe("boolean");
    expect(typeof config.includeDomainList).toBe("boolean");
    expect(typeof config.maxDomainListSize).toBe("number");
  });

  it("should have individual blocks logging disabled by default", () => {
    const config = getDefaultRobotsLoggingConfig();
    expect(config.logIndividualBlocks).toBe(false);
  });

  it("should have override logging enabled by default", () => {
    const config = getDefaultRobotsLoggingConfig();
    expect(config.logOverrides).toBe(true);
  });

  it("should have domain list enabled by default", () => {
    const config = getDefaultRobotsLoggingConfig();
    expect(config.includeDomainList).toBe(true);
  });

  it("should have reasonable sample size", () => {
    const config = getDefaultRobotsLoggingConfig();
    expect(config.maxSampleSize).toBeGreaterThan(0);
    expect(config.maxSampleSize).toBeLessThanOrEqual(100);
  });

  it("should have reasonable domain list size", () => {
    const config = getDefaultRobotsLoggingConfig();
    expect(config.maxDomainListSize).toBeGreaterThan(0);
    expect(config.maxDomainListSize).toBeLessThanOrEqual(100);
  });
});

// ============================================================================
// createRobotsOverrideLog tests
// ============================================================================

describe("createRobotsOverrideLog", () => {
  it("should create log for global disabled override", () => {
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.GLOBAL_DISABLED,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: ["https://example.com/page1", "https://example.com/page2"],
    });

    expect(log.overrideType).toBe(RobotsOverrideType.GLOBAL_DISABLED);
    expect(log.runId).toBe("run-123");
    expect(log.sourceId).toBe("source-456");
    expect(log.tenantId).toBe("tenant-789");
    expect(log.urlCount).toBe(2);
    expect(log.reason).toContain("globally disabled");
    expect(log.reason).toContain("ROBOTS_TXT_DISABLED");
  });

  it("should create log for source override", () => {
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: ["https://example.com/page1"],
    });

    expect(log.overrideType).toBe(RobotsOverrideType.SOURCE_OVERRIDE);
    expect(log.reason).toContain("respectRobotsTxt: false");
  });

  it("should extract unique domains from URLs", () => {
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: [
        "https://example.com/page1",
        "https://example.com/page2",
        "https://other.com/page1",
        "https://third.com/page1",
      ],
    });

    expect(log.urlCount).toBe(4);
    expect(log.domainCount).toBe(3);
    expect(log.domains).toBeDefined();
    expect(log.domains).toContain("example.com");
    expect(log.domains).toContain("other.com");
    expect(log.domains).toContain("third.com");
  });

  it("should include valid timestamp", () => {
    const before = new Date().toISOString();
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: ["https://example.com/page1"],
    });
    const after = new Date().toISOString();

    expect(log.timestamp).toBeDefined();
    expect(log.timestamp >= before).toBe(true);
    expect(log.timestamp <= after).toBe(true);
  });

  it("should limit domain list size based on config", () => {
    const urls = Array.from({ length: 50 }, (_, i) => `https://domain${i}.com/page`);

    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls,
      config: { ...getDefaultRobotsLoggingConfig(), maxDomainListSize: 5 },
    });

    expect(log.domains).toHaveLength(5);
    expect(log.domainCount).toBe(50);
  });

  it("should exclude domain list when configured", () => {
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: ["https://example.com/page1"],
      config: { ...getDefaultRobotsLoggingConfig(), includeDomainList: false },
    });

    expect(log.domains).toBeUndefined();
    expect(log.domainCount).toBe(1);
  });

  it("should handle invalid URLs gracefully", () => {
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: ["https://example.com/page1", "not-a-valid-url", "https://other.com/page"],
    });

    expect(log.urlCount).toBe(3);
    expect(log.domainCount).toBe(2); // Only valid URLs counted
  });

  it("should handle empty URL list", () => {
    const log = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: [],
    });

    expect(log.urlCount).toBe(0);
    expect(log.domainCount).toBe(0);
    expect(log.domains).toEqual([]);
  });
});

// ============================================================================
// createRobotsBlockedUrlLog tests
// ============================================================================

describe("createRobotsBlockedUrlLog", () => {
  it("should create basic blocked URL log", () => {
    const log = createRobotsBlockedUrlLog({
      url: "https://example.com/private/page",
      runId: "run-123",
      tenantId: "tenant-456",
    });

    expect(log.url).toBe("https://example.com/private/page");
    expect(log.domain).toBe("example.com");
    expect(log.runId).toBe("run-123");
    expect(log.tenantId).toBe("tenant-456");
    expect(log.userAgent).toBe(ROBOTS_USER_AGENT);
    expect(log.reason).toBe("URL blocked by robots.txt");
  });

  it("should include matched rule when provided", () => {
    const log = createRobotsBlockedUrlLog({
      url: "https://example.com/private/page",
      runId: "run-123",
      tenantId: "tenant-456",
      matchedRule: "/private/",
    });

    expect(log.matchedRule).toBe("/private/");
  });

  it("should include custom user agent when provided", () => {
    const log = createRobotsBlockedUrlLog({
      url: "https://example.com/private/page",
      runId: "run-123",
      tenantId: "tenant-456",
      userAgent: "CustomBot",
    });

    expect(log.userAgent).toBe("CustomBot");
  });

  it("should include custom reason when provided", () => {
    const log = createRobotsBlockedUrlLog({
      url: "https://example.com/private/page",
      runId: "run-123",
      tenantId: "tenant-456",
      reason: "Blocked by rule: Disallow /private/",
    });

    expect(log.reason).toBe("Blocked by rule: Disallow /private/");
  });

  it("should handle invalid URL for domain extraction", () => {
    const log = createRobotsBlockedUrlLog({
      url: "not-a-valid-url",
      runId: "run-123",
      tenantId: "tenant-456",
    });

    expect(log.domain).toBe("unknown");
  });

  it("should include valid timestamp", () => {
    const before = new Date().toISOString();
    const log = createRobotsBlockedUrlLog({
      url: "https://example.com/page",
      runId: "run-123",
      tenantId: "tenant-456",
    });
    const after = new Date().toISOString();

    expect(log.timestamp >= before).toBe(true);
    expect(log.timestamp <= after).toBe(true);
  });
});

// ============================================================================
// createRobotsBlockedSummaryLog tests
// ============================================================================

describe("createRobotsBlockedSummaryLog", () => {
  it("should create basic summary log with no blocked URLs", () => {
    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls: [],
      robotsTxtRespected: true,
    });

    expect(log.runId).toBe("run-123");
    expect(log.sourceId).toBe("source-456");
    expect(log.tenantId).toBe("tenant-789");
    expect(log.totalUrlsChecked).toBe(10);
    expect(log.totalUrlsBlocked).toBe(0);
    expect(log.domainsWithBlocks).toBe(0);
    expect(log.blockedByDomain).toEqual({});
    expect(log.sampleBlockedUrls).toBeUndefined();
    expect(log.robotsTxtRespected).toBe(true);
  });

  it("should create summary log with blocked URLs", () => {
    const blockedUrls = [
      { url: "https://example.com/private/1", reason: "Blocked", rule: "/private/" },
      { url: "https://example.com/private/2", reason: "Blocked", rule: "/private/" },
      { url: "https://other.com/secret", reason: "Blocked", rule: "/secret" },
    ];

    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls,
      robotsTxtRespected: true,
    });

    expect(log.totalUrlsBlocked).toBe(3);
    expect(log.domainsWithBlocks).toBe(2);
    expect(log.blockedByDomain["example.com"]).toBe(2);
    expect(log.blockedByDomain["other.com"]).toBe(1);
  });

  it("should include sample of blocked URLs", () => {
    const blockedUrls = [
      { url: "https://example.com/private/1", reason: "Blocked", rule: "/private/" },
      { url: "https://example.com/private/2", reason: "Blocked", rule: "/private/" },
    ];

    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls,
      robotsTxtRespected: true,
    });

    expect(log.sampleBlockedUrls).toHaveLength(2);
    expect(log.sampleBlockedUrls![0].url).toBe("https://example.com/private/1");
    expect(log.sampleBlockedUrls![0].rule).toBe("/private/");
  });

  it("should limit sample size based on config", () => {
    const blockedUrls = Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/page${i}`,
      reason: "Blocked",
      rule: "/",
    }));

    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      blockedUrls,
      robotsTxtRespected: true,
      config: { ...getDefaultRobotsLoggingConfig(), maxSampleSize: 5 },
    });

    expect(log.sampleBlockedUrls).toHaveLength(5);
    expect(log.totalUrlsBlocked).toBe(20);
  });

  it("should handle override case (robotsTxtRespected: false)", () => {
    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls: [],
      robotsTxtRespected: false,
    });

    expect(log.robotsTxtRespected).toBe(false);
  });

  it("should handle invalid URLs in blocked list", () => {
    const blockedUrls = [
      { url: "https://example.com/page", reason: "Blocked", rule: "/" },
      { url: "not-a-valid-url", reason: "Blocked", rule: "/" },
    ];

    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls,
      robotsTxtRespected: true,
    });

    expect(log.blockedByDomain["example.com"]).toBe(1);
    expect(log.blockedByDomain["unknown"]).toBe(1);
  });

  it("should include valid timestamp", () => {
    const before = new Date().toISOString();
    const log = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls: [],
      robotsTxtRespected: true,
    });
    const after = new Date().toISOString();

    expect(log.timestamp >= before).toBe(true);
    expect(log.timestamp <= after).toBe(true);
  });
});

// ============================================================================
// formatRobotsOverrideLog tests
// ============================================================================

describe("formatRobotsOverrideLog", () => {
  it("should format basic override log", () => {
    const log: RobotsOverrideLog = {
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urlCount: 10,
      domainCount: 2,
      reason: "Test reason",
    };

    const formatted = formatRobotsOverrideLog(log);

    expect(formatted).toContain("[Robots Override]");
    expect(formatted).toContain("source_override");
    expect(formatted).toContain("Run: run-123");
    expect(formatted).toContain("URLs: 10");
    expect(formatted).toContain("Domains: 2");
    expect(formatted).toContain("Reason: Test reason");
  });

  it("should include domain list when present", () => {
    const log: RobotsOverrideLog = {
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urlCount: 10,
      domainCount: 2,
      domains: ["example.com", "other.com"],
      reason: "Test reason",
    };

    const formatted = formatRobotsOverrideLog(log);

    expect(formatted).toContain("Domain list: example.com, other.com");
  });

  it("should not include domain list when empty", () => {
    const log: RobotsOverrideLog = {
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urlCount: 0,
      domainCount: 0,
      domains: [],
      reason: "Test reason",
    };

    const formatted = formatRobotsOverrideLog(log);

    expect(formatted).not.toContain("Domain list:");
  });
});

// ============================================================================
// formatRobotsBlockedUrlLog tests
// ============================================================================

describe("formatRobotsBlockedUrlLog", () => {
  it("should format basic blocked URL log", () => {
    const log: RobotsBlockedUrlLog = {
      timestamp: "2026-01-18T12:00:00Z",
      url: "https://example.com/private/page",
      domain: "example.com",
      runId: "run-123",
      tenantId: "tenant-456",
      userAgent: "Grounded-Bot",
      reason: "Blocked by rule",
    };

    const formatted = formatRobotsBlockedUrlLog(log);

    expect(formatted).toContain("[Robots Blocked]");
    expect(formatted).toContain("https://example.com/private/page");
    expect(formatted).toContain("Domain: example.com");
    expect(formatted).toContain("Run: run-123");
    expect(formatted).toContain("Reason: Blocked by rule");
  });

  it("should include matched rule when present", () => {
    const log: RobotsBlockedUrlLog = {
      timestamp: "2026-01-18T12:00:00Z",
      url: "https://example.com/private/page",
      domain: "example.com",
      runId: "run-123",
      tenantId: "tenant-456",
      matchedRule: "/private/",
      userAgent: "Grounded-Bot",
      reason: "Blocked by rule",
    };

    const formatted = formatRobotsBlockedUrlLog(log);

    expect(formatted).toContain("Rule: /private/");
  });
});

// ============================================================================
// formatRobotsBlockedSummaryLog tests
// ============================================================================

describe("formatRobotsBlockedSummaryLog", () => {
  it("should format basic summary log", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      totalUrlsBlocked: 10,
      domainsWithBlocks: 2,
      blockedByDomain: { "example.com": 7, "other.com": 3 },
      robotsTxtRespected: true,
    };

    const formatted = formatRobotsBlockedSummaryLog(log);

    expect(formatted).toContain("[Robots Summary]");
    expect(formatted).toContain("Run: run-123");
    expect(formatted).toContain("Checked: 100");
    expect(formatted).toContain("Blocked: 10");
    expect(formatted).toContain("Domains with blocks: 2");
    expect(formatted).toContain("example.com: 7");
    expect(formatted).toContain("other.com: 3");
  });

  it("should indicate override when robotsTxtRespected is false", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      totalUrlsBlocked: 0,
      domainsWithBlocks: 0,
      blockedByDomain: {},
      robotsTxtRespected: false,
    };

    const formatted = formatRobotsBlockedSummaryLog(log);

    expect(formatted).toContain("Override active");
  });

  it("should not include domain breakdown when no blocks", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      totalUrlsBlocked: 0,
      domainsWithBlocks: 0,
      blockedByDomain: {},
      robotsTxtRespected: true,
    };

    const formatted = formatRobotsBlockedSummaryLog(log);

    expect(formatted).not.toContain("By domain:");
  });
});

// ============================================================================
// createStructuredRobotsOverrideLog tests
// ============================================================================

describe("createStructuredRobotsOverrideLog", () => {
  it("should create structured log object", () => {
    const log: RobotsOverrideLog = {
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urlCount: 10,
      domainCount: 2,
      domains: ["example.com", "other.com"],
      reason: "Test reason",
    };

    const structured = createStructuredRobotsOverrideLog(log);

    expect(structured.event).toBe("robots_override");
    expect(structured.overrideType).toBe("source_override");
    expect(structured.timestamp).toBe("2026-01-18T12:00:00Z");
    expect(structured.runId).toBe("run-123");
    expect(structured.sourceId).toBe("source-456");
    expect(structured.tenantId).toBe("tenant-789");
    expect(structured.urlCount).toBe(10);
    expect(structured.domainCount).toBe(2);
    expect(structured.domains).toEqual(["example.com", "other.com"]);
    expect(structured.reason).toBe("Test reason");
  });

  it("should be JSON serializable", () => {
    const log: RobotsOverrideLog = {
      overrideType: RobotsOverrideType.GLOBAL_DISABLED,
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urlCount: 5,
      domainCount: 1,
      reason: "Test",
    };

    const structured = createStructuredRobotsOverrideLog(log);
    const serialized = JSON.stringify(structured);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.event).toBe("robots_override");
    expect(deserialized.runId).toBe("run-123");
  });
});

// ============================================================================
// createStructuredRobotsBlockedSummaryLog tests
// ============================================================================

describe("createStructuredRobotsBlockedSummaryLog", () => {
  it("should create structured log object", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      totalUrlsBlocked: 10,
      domainsWithBlocks: 2,
      blockedByDomain: { "example.com": 7, "other.com": 3 },
      sampleBlockedUrls: [{ url: "https://example.com/page", reason: "Blocked", rule: "/" }],
      robotsTxtRespected: true,
    };

    const structured = createStructuredRobotsBlockedSummaryLog(log);

    expect(structured.event).toBe("robots_blocked_summary");
    expect(structured.timestamp).toBe("2026-01-18T12:00:00Z");
    expect(structured.runId).toBe("run-123");
    expect(structured.totalUrlsChecked).toBe(100);
    expect(structured.totalUrlsBlocked).toBe(10);
    expect(structured.blockRate).toBe(10); // 10%
  });

  it("should calculate block rate correctly", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 50,
      totalUrlsBlocked: 25,
      domainsWithBlocks: 1,
      blockedByDomain: { "example.com": 25 },
      robotsTxtRespected: true,
    };

    const structured = createStructuredRobotsBlockedSummaryLog(log);

    expect(structured.blockRate).toBe(50); // 50%
  });

  it("should handle zero URLs checked", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 0,
      totalUrlsBlocked: 0,
      domainsWithBlocks: 0,
      blockedByDomain: {},
      robotsTxtRespected: true,
    };

    const structured = createStructuredRobotsBlockedSummaryLog(log);

    expect(structured.blockRate).toBe(0);
  });

  it("should be JSON serializable", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      totalUrlsBlocked: 10,
      domainsWithBlocks: 2,
      blockedByDomain: { "example.com": 10 },
      robotsTxtRespected: true,
    };

    const structured = createStructuredRobotsBlockedSummaryLog(log);
    const serialized = JSON.stringify(structured);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.event).toBe("robots_blocked_summary");
    expect(deserialized.blockRate).toBe(10);
  });
});

// ============================================================================
// shouldLogRobotsOverride tests
// ============================================================================

describe("shouldLogRobotsOverride", () => {
  it("should return true with default config", () => {
    expect(shouldLogRobotsOverride()).toBe(true);
  });

  it("should return true when logOverrides is true", () => {
    const config: RobotsLoggingConfig = {
      ...getDefaultRobotsLoggingConfig(),
      logOverrides: true,
    };
    expect(shouldLogRobotsOverride(config)).toBe(true);
  });

  it("should return false when logOverrides is false", () => {
    const config: RobotsLoggingConfig = {
      ...getDefaultRobotsLoggingConfig(),
      logOverrides: false,
    };
    expect(shouldLogRobotsOverride(config)).toBe(false);
  });
});

// ============================================================================
// shouldLogIndividualBlocks tests
// ============================================================================

describe("shouldLogIndividualBlocks", () => {
  it("should return false with default config", () => {
    expect(shouldLogIndividualBlocks()).toBe(false);
  });

  it("should return true when logIndividualBlocks is true", () => {
    const config: RobotsLoggingConfig = {
      ...getDefaultRobotsLoggingConfig(),
      logIndividualBlocks: true,
    };
    expect(shouldLogIndividualBlocks(config)).toBe(true);
  });

  it("should return false when logIndividualBlocks is false", () => {
    const config: RobotsLoggingConfig = {
      ...getDefaultRobotsLoggingConfig(),
      logIndividualBlocks: false,
    };
    expect(shouldLogIndividualBlocks(config)).toBe(false);
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe("Robots override logging integration", () => {
  it("should create complete override flow logs", () => {
    const urls = [
      "https://example.com/page1",
      "https://example.com/page2",
      "https://other.com/page1",
    ];

    // Create override log
    const overrideLog = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls,
    });

    // Create summary log (no blocked because override)
    const summaryLog = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: urls.length,
      blockedUrls: [],
      robotsTxtRespected: false,
    });

    // Verify logs are consistent
    expect(overrideLog.urlCount).toBe(summaryLog.totalUrlsChecked);
    expect(summaryLog.robotsTxtRespected).toBe(false);
    expect(summaryLog.totalUrlsBlocked).toBe(0);
  });

  it("should create complete blocked flow logs", () => {
    const blockedUrls = [
      { url: "https://example.com/private/1", reason: "Blocked", rule: "/private/" },
      { url: "https://example.com/private/2", reason: "Blocked", rule: "/private/" },
    ];

    // Create summary log
    const summaryLog = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls,
      robotsTxtRespected: true,
    });

    // Create individual blocked logs
    const blockedLogs = blockedUrls.map((b) =>
      createRobotsBlockedUrlLog({
        url: b.url,
        runId: "run-123",
        tenantId: "tenant-789",
        matchedRule: b.rule,
        reason: b.reason,
      })
    );

    // Verify consistency
    expect(summaryLog.totalUrlsBlocked).toBe(blockedLogs.length);
    expect(summaryLog.robotsTxtRespected).toBe(true);

    for (const log of blockedLogs) {
      expect(log.domain).toBe("example.com");
      expect(log.matchedRule).toBe("/private/");
    }
  });

  it("should format all log types consistently", () => {
    // All formatted logs should use pipe separators
    const overrideLog = createRobotsOverrideLog({
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urls: ["https://example.com/page"],
    });

    const blockedLog = createRobotsBlockedUrlLog({
      url: "https://example.com/private",
      runId: "run-123",
      tenantId: "tenant-789",
    });

    const summaryLog = createRobotsBlockedSummaryLog({
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 10,
      blockedUrls: [],
      robotsTxtRespected: true,
    });

    const formattedOverride = formatRobotsOverrideLog(overrideLog);
    const formattedBlocked = formatRobotsBlockedUrlLog(blockedLog);
    const formattedSummary = formatRobotsBlockedSummaryLog(summaryLog);

    // All should use pipe separator
    expect(formattedOverride).toContain(" | ");
    expect(formattedBlocked).toContain(" | ");
    expect(formattedSummary).toContain(" | ");

    // All should start with bracket tag
    expect(formattedOverride).toMatch(/^\[Robots/);
    expect(formattedBlocked).toMatch(/^\[Robots/);
    expect(formattedSummary).toMatch(/^\[Robots/);
  });
});

// ============================================================================
// Type compliance tests
// ============================================================================

describe("Type compliance", () => {
  it("RobotsOverrideLog should have all required fields", () => {
    const log: RobotsOverrideLog = {
      overrideType: RobotsOverrideType.SOURCE_OVERRIDE,
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      urlCount: 10,
      domainCount: 2,
      reason: "Test",
    };

    // Verify all required fields are present
    expect(log.overrideType).toBeDefined();
    expect(log.timestamp).toBeDefined();
    expect(log.runId).toBeDefined();
    expect(log.sourceId).toBeDefined();
    expect(log.tenantId).toBeDefined();
    expect(log.urlCount).toBeDefined();
    expect(log.domainCount).toBeDefined();
    expect(log.reason).toBeDefined();
  });

  it("RobotsBlockedUrlLog should have all required fields", () => {
    const log: RobotsBlockedUrlLog = {
      timestamp: "2026-01-18T12:00:00Z",
      url: "https://example.com/page",
      domain: "example.com",
      runId: "run-123",
      tenantId: "tenant-456",
      userAgent: "Grounded-Bot",
      reason: "Blocked",
    };

    expect(log.timestamp).toBeDefined();
    expect(log.url).toBeDefined();
    expect(log.domain).toBeDefined();
    expect(log.runId).toBeDefined();
    expect(log.tenantId).toBeDefined();
    expect(log.userAgent).toBeDefined();
    expect(log.reason).toBeDefined();
  });

  it("RobotsBlockedSummaryLog should have all required fields", () => {
    const log: RobotsBlockedSummaryLog = {
      timestamp: "2026-01-18T12:00:00Z",
      runId: "run-123",
      sourceId: "source-456",
      tenantId: "tenant-789",
      totalUrlsChecked: 100,
      totalUrlsBlocked: 10,
      domainsWithBlocks: 2,
      blockedByDomain: {},
      robotsTxtRespected: true,
    };

    expect(log.timestamp).toBeDefined();
    expect(log.runId).toBeDefined();
    expect(log.sourceId).toBeDefined();
    expect(log.tenantId).toBeDefined();
    expect(log.totalUrlsChecked).toBeDefined();
    expect(log.totalUrlsBlocked).toBeDefined();
    expect(log.domainsWithBlocks).toBeDefined();
    expect(log.blockedByDomain).toBeDefined();
    expect(log.robotsTxtRespected).toBeDefined();
  });

  it("RobotsLoggingConfig should have all required fields", () => {
    const config: RobotsLoggingConfig = {
      logIndividualBlocks: false,
      maxSampleSize: 10,
      logOverrides: true,
      includeDomainList: true,
      maxDomainListSize: 20,
    };

    expect(typeof config.logIndividualBlocks).toBe("boolean");
    expect(typeof config.maxSampleSize).toBe("number");
    expect(typeof config.logOverrides).toBe("boolean");
    expect(typeof config.includeDomainList).toBe("boolean");
    expect(typeof config.maxDomainListSize).toBe("number");
  });
});
