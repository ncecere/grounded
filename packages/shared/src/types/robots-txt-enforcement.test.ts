import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  // Types
  type RobotsTxtRule,
  type RobotsTxtUserAgentGroup,
  type ParsedRobotsTxt,
  type RobotsTxtCheckResult,
  type RobotsTxtEnforcementConfig,
  type RobotsTxtStats,
  // Functions
  isRobotsTxtGloballyDisabled,
  isRobotsTxtDebugEnabled,
  getDefaultRobotsTxtConfig,
  buildRobotsTxtCacheKey,
  getRobotsTxtCacheTtl,
  getRobotsTxtFetchTimeout,
  buildRobotsTxtUrl,
  extractDomainForRobots,
  parseRobotsTxt,
  createRobotsTxtError,
  createRobotsTxtNotFound,
  matchRobotsTxtPattern,
  findRobotsTxtGroup,
  checkUrlAgainstRobotsTxt,
  filterUrlsByRobotsTxt,
  createEmptyRobotsTxtStats,
  updateRobotsTxtStats,
  createRobotsBlockedSkipDetails,
  // Constants
  ROBOTS_USER_AGENT,
  ROBOTS_WILDCARD_USER_AGENT,
  ROBOTS_TXT_CACHE_TTL_SECONDS,
  ROBOTS_TXT_CACHE_KEY_PREFIX,
  ROBOTS_TXT_FETCH_TIMEOUT_MS,
  ROBOTS_TXT_DISABLED_ENV_VAR,
  ROBOTS_TXT_DEBUG_ENV_VAR,
} from "./index.js";
import { SkipReason, IngestionStage } from "./index.js";

describe("Robots.txt Enforcement", () => {
  // Store original env values
  let originalDisabled: string | undefined;
  let originalDebug: string | undefined;

  beforeEach(() => {
    originalDisabled = process.env[ROBOTS_TXT_DISABLED_ENV_VAR];
    originalDebug = process.env[ROBOTS_TXT_DEBUG_ENV_VAR];
    delete process.env[ROBOTS_TXT_DISABLED_ENV_VAR];
    delete process.env[ROBOTS_TXT_DEBUG_ENV_VAR];
  });

  afterEach(() => {
    if (originalDisabled !== undefined) {
      process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = originalDisabled;
    } else {
      delete process.env[ROBOTS_TXT_DISABLED_ENV_VAR];
    }
    if (originalDebug !== undefined) {
      process.env[ROBOTS_TXT_DEBUG_ENV_VAR] = originalDebug;
    } else {
      delete process.env[ROBOTS_TXT_DEBUG_ENV_VAR];
    }
  });

  describe("Constants", () => {
    it("should have correct default user agent", () => {
      expect(ROBOTS_USER_AGENT).toBe("Grounded-Bot");
    });

    it("should have correct wildcard user agent", () => {
      expect(ROBOTS_WILDCARD_USER_AGENT).toBe("*");
    });

    it("should have correct cache TTL (1 hour)", () => {
      expect(ROBOTS_TXT_CACHE_TTL_SECONDS).toBe(3600);
    });

    it("should have correct cache key prefix", () => {
      expect(ROBOTS_TXT_CACHE_KEY_PREFIX).toBe("robots_txt_cache:");
    });

    it("should have correct fetch timeout (5 seconds)", () => {
      expect(ROBOTS_TXT_FETCH_TIMEOUT_MS).toBe(5000);
    });

    it("should have correct disabled env var name", () => {
      expect(ROBOTS_TXT_DISABLED_ENV_VAR).toBe("ROBOTS_TXT_DISABLED");
    });

    it("should have correct debug env var name", () => {
      expect(ROBOTS_TXT_DEBUG_ENV_VAR).toBe("ROBOTS_TXT_DEBUG");
    });
  });

  describe("isRobotsTxtGloballyDisabled", () => {
    it("should return false when env var not set", () => {
      expect(isRobotsTxtGloballyDisabled()).toBe(false);
    });

    it("should return true when env var is 'true'", () => {
      process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = "true";
      expect(isRobotsTxtGloballyDisabled()).toBe(true);
    });

    it("should return true when env var is '1'", () => {
      process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = "1";
      expect(isRobotsTxtGloballyDisabled()).toBe(true);
    });

    it("should return false for other values", () => {
      process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = "false";
      expect(isRobotsTxtGloballyDisabled()).toBe(false);
    });
  });

  describe("isRobotsTxtDebugEnabled", () => {
    it("should return false when env var not set", () => {
      expect(isRobotsTxtDebugEnabled()).toBe(false);
    });

    it("should return true when env var is 'true'", () => {
      process.env[ROBOTS_TXT_DEBUG_ENV_VAR] = "true";
      expect(isRobotsTxtDebugEnabled()).toBe(true);
    });

    it("should return true when env var is '1'", () => {
      process.env[ROBOTS_TXT_DEBUG_ENV_VAR] = "1";
      expect(isRobotsTxtDebugEnabled()).toBe(true);
    });
  });

  describe("getDefaultRobotsTxtConfig", () => {
    it("should return config with enforcement enabled by default", () => {
      const config = getDefaultRobotsTxtConfig();
      expect(config.enabled).toBe(true);
      expect(config.userAgent).toBe(ROBOTS_USER_AGENT);
      expect(config.fallbackUserAgent).toBe(ROBOTS_WILDCARD_USER_AGENT);
      expect(config.debugEnabled).toBe(false);
    });

    it("should return config with enforcement disabled when env var set", () => {
      process.env[ROBOTS_TXT_DISABLED_ENV_VAR] = "true";
      const config = getDefaultRobotsTxtConfig();
      expect(config.enabled).toBe(false);
    });

    it("should return config with debug enabled when env var set", () => {
      process.env[ROBOTS_TXT_DEBUG_ENV_VAR] = "true";
      const config = getDefaultRobotsTxtConfig();
      expect(config.debugEnabled).toBe(true);
    });
  });

  describe("buildRobotsTxtCacheKey", () => {
    it("should build correct cache key", () => {
      expect(buildRobotsTxtCacheKey("example.com")).toBe("robots_txt_cache:example.com");
    });

    it("should lowercase domain", () => {
      expect(buildRobotsTxtCacheKey("Example.COM")).toBe("robots_txt_cache:example.com");
    });
  });

  describe("getRobotsTxtCacheTtl", () => {
    it("should return correct TTL", () => {
      expect(getRobotsTxtCacheTtl()).toBe(3600);
    });
  });

  describe("getRobotsTxtFetchTimeout", () => {
    it("should return correct timeout", () => {
      expect(getRobotsTxtFetchTimeout()).toBe(5000);
    });
  });

  describe("buildRobotsTxtUrl", () => {
    it("should build correct robots.txt URL for http", () => {
      expect(buildRobotsTxtUrl("http://example.com/page")).toBe("http://example.com/robots.txt");
    });

    it("should build correct robots.txt URL for https", () => {
      expect(buildRobotsTxtUrl("https://example.com/page/subpage")).toBe("https://example.com/robots.txt");
    });

    it("should preserve port in URL", () => {
      expect(buildRobotsTxtUrl("https://example.com:8080/page")).toBe("https://example.com:8080/robots.txt");
    });

    it("should throw for invalid URL", () => {
      expect(() => buildRobotsTxtUrl("not-a-url")).toThrow("Invalid URL");
    });
  });

  describe("extractDomainForRobots", () => {
    it("should extract domain from URL", () => {
      expect(extractDomainForRobots("https://example.com/page")).toBe("example.com");
    });

    it("should lowercase domain", () => {
      expect(extractDomainForRobots("https://EXAMPLE.COM/page")).toBe("example.com");
    });

    it("should handle subdomain", () => {
      expect(extractDomainForRobots("https://www.example.com/page")).toBe("www.example.com");
    });

    it("should throw for invalid URL", () => {
      expect(() => extractDomainForRobots("not-a-url")).toThrow("Invalid URL");
    });
  });

  describe("parseRobotsTxt", () => {
    it("should parse empty content as valid", () => {
      const result = parseRobotsTxt("");
      expect(result.isValid).toBe(true);
      expect(result.groups).toEqual([]);
      expect(result.sitemaps).toEqual([]);
    });

    it("should parse basic disallow rule", () => {
      const content = `User-agent: *
Disallow: /private/`;
      const result = parseRobotsTxt(content);
      expect(result.isValid).toBe(true);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].userAgents).toEqual(["*"]);
      expect(result.groups[0].rules).toHaveLength(1);
      expect(result.groups[0].rules[0].type).toBe("disallow");
      expect(result.groups[0].rules[0].pattern).toBe("/private/");
    });

    it("should parse allow rule", () => {
      const content = `User-agent: *
Allow: /public/
Disallow: /`;
      const result = parseRobotsTxt(content);
      expect(result.groups[0].rules).toHaveLength(2);
      expect(result.groups[0].rules[0].type).toBe("allow");
      expect(result.groups[0].rules[0].pattern).toBe("/public/");
      expect(result.groups[0].rules[1].type).toBe("disallow");
    });

    it("should parse multiple user agents in one group", () => {
      const content = `User-agent: Googlebot
User-agent: Bingbot
Disallow: /admin/`;
      const result = parseRobotsTxt(content);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].userAgents).toEqual(["Googlebot", "Bingbot"]);
    });

    it("should parse multiple groups", () => {
      const content = `User-agent: Googlebot
Disallow: /google-only/

User-agent: *
Disallow: /private/`;
      const result = parseRobotsTxt(content);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0].userAgents).toEqual(["Googlebot"]);
      expect(result.groups[1].userAgents).toEqual(["*"]);
    });

    it("should parse crawl-delay", () => {
      const content = `User-agent: *
Crawl-delay: 10
Disallow: /`;
      const result = parseRobotsTxt(content);
      expect(result.groups[0].crawlDelay).toBe(10);
    });

    it("should parse sitemap", () => {
      const content = `User-agent: *
Disallow: /private/
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap2.xml`;
      const result = parseRobotsTxt(content);
      expect(result.sitemaps).toEqual([
        "https://example.com/sitemap.xml",
        "https://example.com/sitemap2.xml",
      ]);
    });

    it("should ignore comments", () => {
      const content = `# This is a comment
User-agent: * # inline comment
Disallow: /private/`;
      const result = parseRobotsTxt(content);
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].rules).toHaveLength(1);
    });

    it("should handle Windows line endings", () => {
      const content = "User-agent: *\r\nDisallow: /private/";
      const result = parseRobotsTxt(content);
      expect(result.groups).toHaveLength(1);
    });

    it("should store HTTP status code", () => {
      const result = parseRobotsTxt("User-agent: *\nDisallow: /", 200);
      expect(result.httpStatus).toBe(200);
    });

    it("should store raw content", () => {
      const content = "User-agent: *\nDisallow: /";
      const result = parseRobotsTxt(content);
      expect(result.rawContent).toBe(content);
    });

    it("should have valid fetchedAt timestamp", () => {
      const result = parseRobotsTxt("");
      expect(result.fetchedAt).toBeDefined();
      expect(new Date(result.fetchedAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe("createRobotsTxtError", () => {
    it("should create error result", () => {
      const result = createRobotsTxtError("Connection timeout", 503);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe("Connection timeout");
      expect(result.httpStatus).toBe(503);
      expect(result.groups).toEqual([]);
      expect(result.sitemaps).toEqual([]);
    });

    it("should work without HTTP status", () => {
      const result = createRobotsTxtError("Network error");
      expect(result.error).toBe("Network error");
      expect(result.httpStatus).toBeUndefined();
    });
  });

  describe("createRobotsTxtNotFound", () => {
    it("should create valid result for 404", () => {
      const result = createRobotsTxtNotFound();
      expect(result.isValid).toBe(true);
      expect(result.httpStatus).toBe(404);
      expect(result.groups).toEqual([]);
      expect(result.sitemaps).toEqual([]);
    });
  });

  describe("matchRobotsTxtPattern", () => {
    it("should match exact prefix", () => {
      expect(matchRobotsTxtPattern("/private/page", "/private/")).toBe(true);
    });

    it("should not match different prefix", () => {
      expect(matchRobotsTxtPattern("/public/page", "/private/")).toBe(false);
    });

    it("should match with wildcard", () => {
      expect(matchRobotsTxtPattern("/private/secret/file.html", "/private/*/")).toBe(true);
    });

    it("should match wildcard at end", () => {
      expect(matchRobotsTxtPattern("/admin/users/list", "/admin/*")).toBe(true);
    });

    it("should match $ at end of URL", () => {
      expect(matchRobotsTxtPattern("/exact", "/exact$")).toBe(true);
      expect(matchRobotsTxtPattern("/exact/more", "/exact$")).toBe(false);
    });

    it("should NOT match empty pattern (per robots.txt spec)", () => {
      // Empty pattern in robots.txt means "allow all" - it should NOT match
      // This makes empty Disallow rules ineffective (allowing all URLs)
      expect(matchRobotsTxtPattern("/any/path", "")).toBe(false);
    });

    it("should handle empty path", () => {
      expect(matchRobotsTxtPattern("", "/")).toBe(true);
    });

    it("should match root path", () => {
      expect(matchRobotsTxtPattern("/", "/")).toBe(true);
    });

    it("should match file extensions", () => {
      expect(matchRobotsTxtPattern("/file.pdf", "/*.pdf")).toBe(true);
    });

    it("should match query strings", () => {
      expect(matchRobotsTxtPattern("/search?q=test", "/search")).toBe(true);
    });
  });

  describe("findRobotsTxtGroup", () => {
    const robotsTxt: ParsedRobotsTxt = {
      groups: [
        {
          userAgents: ["Googlebot"],
          rules: [{ type: "disallow", pattern: "/google-only/", originalLine: "Disallow: /google-only/" }],
        },
        {
          userAgents: ["*"],
          rules: [{ type: "disallow", pattern: "/private/", originalLine: "Disallow: /private/" }],
        },
      ],
      sitemaps: [],
      isValid: true,
      fetchedAt: new Date().toISOString(),
    };

    it("should find exact match for user agent", () => {
      const group = findRobotsTxtGroup(robotsTxt, "Googlebot");
      expect(group?.userAgents).toContain("Googlebot");
    });

    it("should be case-insensitive for user agent", () => {
      const group = findRobotsTxtGroup(robotsTxt, "googlebot");
      expect(group?.userAgents).toContain("Googlebot");
    });

    it("should fall back to wildcard", () => {
      const group = findRobotsTxtGroup(robotsTxt, "SomeOtherBot");
      expect(group?.userAgents).toContain("*");
    });

    it("should return undefined when no match", () => {
      const robotsTxtNoWildcard: ParsedRobotsTxt = {
        groups: [
          {
            userAgents: ["Googlebot"],
            rules: [],
          },
        ],
        sitemaps: [],
        isValid: true,
        fetchedAt: new Date().toISOString(),
      };
      const group = findRobotsTxtGroup(robotsTxtNoWildcard, "SomeOtherBot");
      expect(group).toBeUndefined();
    });
  });

  describe("checkUrlAgainstRobotsTxt", () => {
    const robotsTxt: ParsedRobotsTxt = {
      groups: [
        {
          userAgents: ["*"],
          rules: [
            { type: "allow", pattern: "/public/", originalLine: "Allow: /public/" },
            { type: "disallow", pattern: "/private/", originalLine: "Disallow: /private/" },
            { type: "disallow", pattern: "/admin/", originalLine: "Disallow: /admin/" },
          ],
        },
      ],
      sitemaps: [],
      isValid: true,
      fetchedAt: new Date().toISOString(),
    };

    it("should allow URL not matching any rule", () => {
      const result = checkUrlAgainstRobotsTxt(robotsTxt, "https://example.com/page");
      expect(result.isAllowed).toBe(true);
      expect(result.wasEnforced).toBe(true);
    });

    it("should disallow URL matching disallow rule", () => {
      const result = checkUrlAgainstRobotsTxt(robotsTxt, "https://example.com/private/secret");
      expect(result.isAllowed).toBe(false);
      expect(result.wasEnforced).toBe(true);
      expect(result.matchedRule).toBe("/private/");
    });

    it("should allow URL matching allow rule", () => {
      const result = checkUrlAgainstRobotsTxt(robotsTxt, "https://example.com/public/file");
      expect(result.isAllowed).toBe(true);
      expect(result.wasEnforced).toBe(true);
    });

    it("should allow all when enforcement disabled", () => {
      const config: RobotsTxtEnforcementConfig = {
        enabled: false,
        userAgent: ROBOTS_USER_AGENT,
        fallbackUserAgent: ROBOTS_WILDCARD_USER_AGENT,
        debugEnabled: false,
      };
      const result = checkUrlAgainstRobotsTxt(robotsTxt, "https://example.com/private/secret", config);
      expect(result.isAllowed).toBe(true);
      expect(result.wasEnforced).toBe(false);
    });

    it("should allow when robots.txt is invalid", () => {
      const invalidRobotsTxt = createRobotsTxtError("Failed to fetch");
      const result = checkUrlAgainstRobotsTxt(invalidRobotsTxt, "https://example.com/private/secret");
      expect(result.isAllowed).toBe(true);
      expect(result.wasEnforced).toBe(false);
    });

    it("should allow when no groups in robots.txt", () => {
      const emptyRobotsTxt = createRobotsTxtNotFound();
      const result = checkUrlAgainstRobotsTxt(emptyRobotsTxt, "https://example.com/private/secret");
      expect(result.isAllowed).toBe(true);
      expect(result.wasEnforced).toBe(true);
    });

    it("should disallow invalid URL", () => {
      const result = checkUrlAgainstRobotsTxt(robotsTxt, "not-a-url");
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe("Invalid URL");
    });

    it("should use more specific rule when multiple match", () => {
      const robotsTxtWithOverlap: ParsedRobotsTxt = {
        groups: [
          {
            userAgents: ["*"],
            rules: [
              { type: "disallow", pattern: "/private/", originalLine: "Disallow: /private/" },
              { type: "allow", pattern: "/private/public/", originalLine: "Allow: /private/public/" },
            ],
          },
        ],
        sitemaps: [],
        isValid: true,
        fetchedAt: new Date().toISOString(),
      };
      const result = checkUrlAgainstRobotsTxt(robotsTxtWithOverlap, "https://example.com/private/public/file");
      expect(result.isAllowed).toBe(true);
    });
  });

  describe("filterUrlsByRobotsTxt", () => {
    const robotsTxt: ParsedRobotsTxt = {
      groups: [
        {
          userAgents: ["*"],
          rules: [
            { type: "disallow", pattern: "/private/", originalLine: "Disallow: /private/" },
          ],
        },
      ],
      sitemaps: [],
      isValid: true,
      fetchedAt: new Date().toISOString(),
    };

    it("should filter allowed and blocked URLs", () => {
      const urls = [
        "https://example.com/public/page1",
        "https://example.com/private/secret",
        "https://example.com/public/page2",
        "https://example.com/private/another",
      ];
      const result = filterUrlsByRobotsTxt(robotsTxt, urls);
      expect(result.allowed).toHaveLength(2);
      expect(result.blocked).toHaveLength(2);
      expect(result.allowed).toContain("https://example.com/public/page1");
      expect(result.blocked[0].url).toBe("https://example.com/private/secret");
    });

    it("should include reason and rule for blocked URLs", () => {
      const urls = ["https://example.com/private/secret"];
      const result = filterUrlsByRobotsTxt(robotsTxt, urls);
      expect(result.blocked[0].reason).toContain("Blocked by rule");
      expect(result.blocked[0].rule).toBe("/private/");
    });

    it("should handle empty URL list", () => {
      const result = filterUrlsByRobotsTxt(robotsTxt, []);
      expect(result.allowed).toEqual([]);
      expect(result.blocked).toEqual([]);
    });
  });

  describe("createEmptyRobotsTxtStats", () => {
    it("should create empty stats object", () => {
      const stats = createEmptyRobotsTxtStats();
      expect(stats.urlsChecked).toBe(0);
      expect(stats.urlsBlocked).toBe(0);
      expect(stats.domainsChecked).toBe(0);
      expect(stats.blockedByDomain).toEqual({});
    });
  });

  describe("updateRobotsTxtStats", () => {
    it("should update stats correctly", () => {
      let stats = createEmptyRobotsTxtStats();
      stats = updateRobotsTxtStats(stats, "example.com", 10, 3);
      expect(stats.urlsChecked).toBe(10);
      expect(stats.urlsBlocked).toBe(3);
      expect(stats.domainsChecked).toBe(1);
      expect(stats.blockedByDomain["example.com"]).toBe(3);
    });

    it("should accumulate stats across multiple updates", () => {
      let stats = createEmptyRobotsTxtStats();
      stats = updateRobotsTxtStats(stats, "example.com", 10, 3);
      stats = updateRobotsTxtStats(stats, "other.com", 5, 2);
      expect(stats.urlsChecked).toBe(15);
      expect(stats.urlsBlocked).toBe(5);
      expect(stats.domainsChecked).toBe(2);
    });

    it("should handle multiple updates for same domain", () => {
      let stats = createEmptyRobotsTxtStats();
      stats = updateRobotsTxtStats(stats, "example.com", 10, 3);
      stats = updateRobotsTxtStats(stats, "example.com", 5, 2);
      expect(stats.urlsChecked).toBe(15);
      expect(stats.urlsBlocked).toBe(5);
      expect(stats.blockedByDomain["example.com"]).toBe(5);
    });
  });

  describe("createRobotsBlockedSkipDetails", () => {
    it("should create basic skip details", () => {
      const details = createRobotsBlockedSkipDetails("https://example.com/private");
      expect(details.reason).toBe(SkipReason.ROBOTS_BLOCKED);
      expect(details.stage).toBe(IngestionStage.DISCOVER);
      expect(details.description).toBe("URL blocked by robots.txt");
      expect(details.skippedAt).toBeDefined();
    });

    it("should include matched rule in description", () => {
      const details = createRobotsBlockedSkipDetails("https://example.com/private", "/private/");
      expect(details.description).toBe("URL blocked by robots.txt: /private/");
      expect(details.details?.pattern).toBe("/private/");
    });

    it("should include user agent when provided", () => {
      const details = createRobotsBlockedSkipDetails("https://example.com/private", "/private/", "Grounded-Bot");
      expect(details.details).toBeDefined();
    });

    it("should not include details when no rule or user agent provided", () => {
      const details = createRobotsBlockedSkipDetails("https://example.com/private");
      expect(details.details).toBeUndefined();
    });
  });

  describe("Real-world robots.txt examples", () => {
    it("should parse Google's robots.txt style", () => {
      const content = `User-agent: Googlebot
Allow: /search
Disallow: /search?

User-agent: *
Disallow: /admin/
Disallow: /private/
Allow: /public/

Sitemap: https://example.com/sitemap.xml`;

      const result = parseRobotsTxt(content);
      expect(result.isValid).toBe(true);
      expect(result.groups).toHaveLength(2);
      expect(result.sitemaps).toHaveLength(1);
    });

    it("should handle disallow all", () => {
      const content = `User-agent: *
Disallow: /`;

      const result = parseRobotsTxt(content);
      const checkResult = checkUrlAgainstRobotsTxt(result, "https://example.com/any/page");
      expect(checkResult.isAllowed).toBe(false);
    });

    it("should handle allow all (empty disallow)", () => {
      const content = `User-agent: *
Disallow:`;

      const result = parseRobotsTxt(content);
      // Empty disallow pattern matches everything (allows all)
      const checkResult = checkUrlAgainstRobotsTxt(result, "https://example.com/any/page");
      expect(checkResult.isAllowed).toBe(true);
    });

    it("should handle complex wildcards", () => {
      const content = `User-agent: *
Disallow: /*.json$
Disallow: /api/*
Allow: /api/public/*`;

      const result = parseRobotsTxt(content);

      // Should block JSON files
      const jsonCheck = checkUrlAgainstRobotsTxt(result, "https://example.com/data.json");
      expect(jsonCheck.isAllowed).toBe(false);

      // Should not block non-JSON at root
      const htmlCheck = checkUrlAgainstRobotsTxt(result, "https://example.com/data.html");
      expect(htmlCheck.isAllowed).toBe(true);
    });

    it("should handle bot-specific rules", () => {
      const content = `User-agent: Grounded-Bot
Disallow: /grounded-only/

User-agent: *
Disallow: /private/`;

      const result = parseRobotsTxt(content);

      // Grounded-Bot should be blocked from /grounded-only/
      const groundedConfig: RobotsTxtEnforcementConfig = {
        enabled: true,
        userAgent: "Grounded-Bot",
        fallbackUserAgent: "*",
        debugEnabled: false,
      };
      const groundedCheck = checkUrlAgainstRobotsTxt(result, "https://example.com/grounded-only/secret", groundedConfig);
      expect(groundedCheck.isAllowed).toBe(false);

      // Other bots should be allowed to /grounded-only/ but blocked from /private/
      const otherConfig: RobotsTxtEnforcementConfig = {
        enabled: true,
        userAgent: "OtherBot",
        fallbackUserAgent: "*",
        debugEnabled: false,
      };
      const otherCheck = checkUrlAgainstRobotsTxt(result, "https://example.com/grounded-only/secret", otherConfig);
      expect(otherCheck.isAllowed).toBe(true);
    });
  });

  describe("Interface compliance", () => {
    it("RobotsTxtRule should have required fields", () => {
      const rule: RobotsTxtRule = {
        type: "disallow",
        pattern: "/private/",
        originalLine: "Disallow: /private/",
      };
      expect(rule.type).toBe("disallow");
      expect(rule.pattern).toBe("/private/");
      expect(rule.originalLine).toBe("Disallow: /private/");
    });

    it("RobotsTxtUserAgentGroup should have required fields", () => {
      const group: RobotsTxtUserAgentGroup = {
        userAgents: ["*"],
        rules: [],
        crawlDelay: 10,
      };
      expect(group.userAgents).toEqual(["*"]);
      expect(group.rules).toEqual([]);
      expect(group.crawlDelay).toBe(10);
    });

    it("ParsedRobotsTxt should have required fields", () => {
      const parsed: ParsedRobotsTxt = {
        groups: [],
        sitemaps: [],
        isValid: true,
        fetchedAt: new Date().toISOString(),
      };
      expect(parsed.groups).toEqual([]);
      expect(parsed.isValid).toBe(true);
    });

    it("RobotsTxtCheckResult should have required fields", () => {
      const result: RobotsTxtCheckResult = {
        isAllowed: true,
        wasEnforced: true,
        userAgent: "Grounded-Bot",
        reason: "No matching rule",
      };
      expect(result.isAllowed).toBe(true);
      expect(result.wasEnforced).toBe(true);
    });

    it("RobotsTxtEnforcementConfig should have required fields", () => {
      const config: RobotsTxtEnforcementConfig = {
        enabled: true,
        userAgent: "Grounded-Bot",
        fallbackUserAgent: "*",
        debugEnabled: false,
      };
      expect(config.enabled).toBe(true);
      expect(config.userAgent).toBe("Grounded-Bot");
    });

    it("RobotsTxtStats should have required fields", () => {
      const stats: RobotsTxtStats = {
        urlsChecked: 100,
        urlsBlocked: 10,
        domainsChecked: 5,
        blockedByDomain: { "example.com": 5, "other.com": 5 },
      };
      expect(stats.urlsChecked).toBe(100);
      expect(stats.urlsBlocked).toBe(10);
    });
  });
});
