import { describe, it, expect } from "bun:test";
import {
  // Types
  type ConcurrencyCheckResult,
  type CombinedConcurrencyCheckResult,
  type ActiveJobTracker,
  type ConcurrencyLimitOptions,
  type ConcurrencyMetrics,
  // Constants
  DEFAULT_TENANT_CONCURRENCY,
  DEFAULT_DOMAIN_CONCURRENCY,
  DOMAIN_CONCURRENCY_ENV_VAR,
  CONCURRENCY_KEY_PREFIXES,
  CONCURRENCY_KEY_TTL_SECONDS,
  CONCURRENCY_RETRY_DELAY_MS,
  // Functions
  extractDomainFromUrl,
  buildTenantConcurrencyKey,
  buildDomainConcurrencyKey,
  buildTenantDomainConcurrencyKey,
  resolveDomainConcurrency,
  getTenantConcurrencyLimit,
  createConcurrencyLimitOptions,
  getConcurrencyKeyTtl,
  getConcurrencyRetryDelay,
  TenantQuotas,
} from "./index";

describe("Tenant and Domain Concurrency Limit Constants", () => {
  describe("DEFAULT_TENANT_CONCURRENCY", () => {
    it("should have a reasonable default value", () => {
      expect(DEFAULT_TENANT_CONCURRENCY).toBe(5);
    });

    it("should be a positive integer", () => {
      expect(DEFAULT_TENANT_CONCURRENCY).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_TENANT_CONCURRENCY)).toBe(true);
    });
  });

  describe("DEFAULT_DOMAIN_CONCURRENCY", () => {
    it("should have a reasonable default value", () => {
      expect(DEFAULT_DOMAIN_CONCURRENCY).toBe(3);
    });

    it("should be a positive integer", () => {
      expect(DEFAULT_DOMAIN_CONCURRENCY).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_DOMAIN_CONCURRENCY)).toBe(true);
    });

    it("should be lower than tenant concurrency for politeness", () => {
      // Domain limit should be stricter to avoid overwhelming target servers
      expect(DEFAULT_DOMAIN_CONCURRENCY).toBeLessThanOrEqual(DEFAULT_TENANT_CONCURRENCY);
    });
  });

  describe("DOMAIN_CONCURRENCY_ENV_VAR", () => {
    it("should be a valid environment variable name", () => {
      expect(DOMAIN_CONCURRENCY_ENV_VAR).toBe("DOMAIN_CONCURRENCY");
      expect(DOMAIN_CONCURRENCY_ENV_VAR).toMatch(/^[A-Z_]+$/);
    });
  });

  describe("CONCURRENCY_KEY_PREFIXES", () => {
    it("should have tenant prefix", () => {
      expect(CONCURRENCY_KEY_PREFIXES.TENANT).toBe("concurrency:tenant:");
    });

    it("should have domain prefix", () => {
      expect(CONCURRENCY_KEY_PREFIXES.DOMAIN).toBe("concurrency:domain:");
    });

    it("should have tenant_domain prefix", () => {
      expect(CONCURRENCY_KEY_PREFIXES.TENANT_DOMAIN).toBe("concurrency:tenant_domain:");
    });

    it("should have unique prefixes", () => {
      const prefixes = Object.values(CONCURRENCY_KEY_PREFIXES);
      const uniquePrefixes = new Set(prefixes);
      expect(uniquePrefixes.size).toBe(prefixes.length);
    });
  });

  describe("CONCURRENCY_KEY_TTL_SECONDS", () => {
    it("should be 5 minutes (300 seconds)", () => {
      expect(CONCURRENCY_KEY_TTL_SECONDS).toBe(300);
    });

    it("should be long enough for typical fetch operations", () => {
      // 30 seconds is a typical page fetch timeout
      expect(CONCURRENCY_KEY_TTL_SECONDS).toBeGreaterThan(30);
    });
  });

  describe("CONCURRENCY_RETRY_DELAY_MS", () => {
    it("should be 5 seconds", () => {
      expect(CONCURRENCY_RETRY_DELAY_MS).toBe(5000);
    });

    it("should be a reasonable backoff delay", () => {
      expect(CONCURRENCY_RETRY_DELAY_MS).toBeGreaterThanOrEqual(1000);
      expect(CONCURRENCY_RETRY_DELAY_MS).toBeLessThanOrEqual(30000);
    });
  });
});

describe("Domain Extraction Function", () => {
  describe("extractDomainFromUrl", () => {
    it("should extract domain from standard HTTP URL", () => {
      expect(extractDomainFromUrl("https://example.com/page")).toBe("example.com");
    });

    it("should extract domain from URL with port", () => {
      expect(extractDomainFromUrl("https://example.com:8080/page")).toBe("example.com");
    });

    it("should extract domain from URL with subdomain", () => {
      expect(extractDomainFromUrl("https://sub.example.com/page")).toBe("sub.example.com");
    });

    it("should remove www prefix for normalization", () => {
      expect(extractDomainFromUrl("https://www.example.com/page")).toBe("example.com");
    });

    it("should lowercase domain for consistency", () => {
      expect(extractDomainFromUrl("https://EXAMPLE.COM/page")).toBe("example.com");
      expect(extractDomainFromUrl("https://Example.Com/page")).toBe("example.com");
    });

    it("should handle HTTP protocol", () => {
      expect(extractDomainFromUrl("http://example.com/page")).toBe("example.com");
    });

    it("should handle URL with query string", () => {
      expect(extractDomainFromUrl("https://example.com/page?foo=bar")).toBe("example.com");
    });

    it("should handle URL with fragment", () => {
      expect(extractDomainFromUrl("https://example.com/page#section")).toBe("example.com");
    });

    it("should return null for invalid URL", () => {
      expect(extractDomainFromUrl("not-a-url")).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(extractDomainFromUrl("")).toBeNull();
    });

    it("should return null for relative URL", () => {
      expect(extractDomainFromUrl("/path/to/page")).toBeNull();
    });

    it("should handle IP addresses", () => {
      expect(extractDomainFromUrl("https://192.168.1.1/page")).toBe("192.168.1.1");
    });

    it("should handle localhost", () => {
      expect(extractDomainFromUrl("http://localhost:3000/page")).toBe("localhost");
    });

    it("should handle international domains (IDN)", () => {
      // Note: Node URL API handles punycode conversion internally
      expect(extractDomainFromUrl("https://例え.jp/page")).toBe("xn--r8jz45g.jp");
    });
  });
});

describe("Redis Key Building Functions", () => {
  describe("buildTenantConcurrencyKey", () => {
    it("should build key with tenant prefix", () => {
      const key = buildTenantConcurrencyKey("tenant-123");
      expect(key).toBe("concurrency:tenant:tenant-123");
    });

    it("should handle UUID format tenant IDs", () => {
      const key = buildTenantConcurrencyKey("550e8400-e29b-41d4-a716-446655440000");
      expect(key).toBe("concurrency:tenant:550e8400-e29b-41d4-a716-446655440000");
    });
  });

  describe("buildDomainConcurrencyKey", () => {
    it("should build key with domain prefix", () => {
      const key = buildDomainConcurrencyKey("example.com");
      expect(key).toBe("concurrency:domain:example.com");
    });

    it("should handle subdomains", () => {
      const key = buildDomainConcurrencyKey("sub.example.com");
      expect(key).toBe("concurrency:domain:sub.example.com");
    });
  });

  describe("buildTenantDomainConcurrencyKey", () => {
    it("should build combined key with tenant and domain", () => {
      const key = buildTenantDomainConcurrencyKey("tenant-123", "example.com");
      expect(key).toBe("concurrency:tenant_domain:tenant-123:example.com");
    });

    it("should maintain separator between tenant and domain", () => {
      const key = buildTenantDomainConcurrencyKey("t1", "d1");
      expect(key).toBe("concurrency:tenant_domain:t1:d1");
      // Ensure we can parse it back
      const parts = key.replace("concurrency:tenant_domain:", "").split(":");
      expect(parts[0]).toBe("t1");
      expect(parts[1]).toBe("d1");
    });
  });
});

describe("Concurrency Limit Resolution Functions", () => {
  describe("resolveDomainConcurrency", () => {
    it("should return default when env var is not set", () => {
      const result = resolveDomainConcurrency(() => undefined);
      expect(result).toBe(DEFAULT_DOMAIN_CONCURRENCY);
    });

    it("should use env var value when set", () => {
      const result = resolveDomainConcurrency((key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "10" : undefined
      );
      expect(result).toBe(10);
    });

    it("should ignore invalid env var values", () => {
      const result = resolveDomainConcurrency((key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "invalid" : undefined
      );
      expect(result).toBe(DEFAULT_DOMAIN_CONCURRENCY);
    });

    it("should ignore zero value", () => {
      const result = resolveDomainConcurrency((key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "0" : undefined
      );
      expect(result).toBe(DEFAULT_DOMAIN_CONCURRENCY);
    });

    it("should ignore negative values", () => {
      const result = resolveDomainConcurrency((key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "-5" : undefined
      );
      expect(result).toBe(DEFAULT_DOMAIN_CONCURRENCY);
    });

    it("should handle float values by truncating", () => {
      const result = resolveDomainConcurrency((key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "7.9" : undefined
      );
      expect(result).toBe(7);
    });
  });

  describe("getTenantConcurrencyLimit", () => {
    it("should return default when no quotas provided", () => {
      expect(getTenantConcurrencyLimit()).toBe(DEFAULT_TENANT_CONCURRENCY);
    });

    it("should return default when quotas are empty", () => {
      expect(getTenantConcurrencyLimit({})).toBe(DEFAULT_TENANT_CONCURRENCY);
    });

    it("should use tenant quota when provided", () => {
      const quotas: Partial<TenantQuotas> = { maxCrawlConcurrency: 15 };
      expect(getTenantConcurrencyLimit(quotas)).toBe(15);
    });

    it("should handle quota value of 0", () => {
      const quotas: Partial<TenantQuotas> = { maxCrawlConcurrency: 0 };
      // 0 is a valid limit (blocks all)
      expect(getTenantConcurrencyLimit(quotas)).toBe(0);
    });

    it("should prioritize quota over default", () => {
      const quotas: Partial<TenantQuotas> = { maxCrawlConcurrency: 1 };
      expect(getTenantConcurrencyLimit(quotas)).toBe(1);
    });
  });

  describe("createConcurrencyLimitOptions", () => {
    it("should create default options when no args provided", () => {
      const options = createConcurrencyLimitOptions();
      expect(options.tenantLimit).toBe(DEFAULT_TENANT_CONCURRENCY);
      expect(options.domainLimit).toBe(DEFAULT_DOMAIN_CONCURRENCY);
      expect(options.checkTenantDomainLimit).toBe(false);
      expect(options.tenantDomainLimit).toBeUndefined();
    });

    it("should use tenant quotas when provided", () => {
      const quotas: Partial<TenantQuotas> = { maxCrawlConcurrency: 20 };
      const options = createConcurrencyLimitOptions(quotas);
      expect(options.tenantLimit).toBe(20);
    });

    it("should use env var for domain limit", () => {
      const options = createConcurrencyLimitOptions(undefined, (key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "8" : undefined
      );
      expect(options.domainLimit).toBe(8);
    });

    it("should combine tenant quotas and env var", () => {
      const quotas: Partial<TenantQuotas> = { maxCrawlConcurrency: 12 };
      const options = createConcurrencyLimitOptions(quotas, (key) =>
        key === DOMAIN_CONCURRENCY_ENV_VAR ? "6" : undefined
      );
      expect(options.tenantLimit).toBe(12);
      expect(options.domainLimit).toBe(6);
    });
  });

  describe("getConcurrencyKeyTtl", () => {
    it("should return the configured TTL", () => {
      expect(getConcurrencyKeyTtl()).toBe(CONCURRENCY_KEY_TTL_SECONDS);
    });
  });

  describe("getConcurrencyRetryDelay", () => {
    it("should return the configured retry delay", () => {
      expect(getConcurrencyRetryDelay()).toBe(CONCURRENCY_RETRY_DELAY_MS);
    });
  });
});

describe("Type Interfaces", () => {
  describe("ConcurrencyCheckResult", () => {
    it("should have correct structure", () => {
      const result: ConcurrencyCheckResult = {
        allowed: true,
        current: 3,
        limit: 5,
        key: "concurrency:tenant:test",
      };
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(3);
      expect(result.limit).toBe(5);
      expect(result.key).toBe("concurrency:tenant:test");
      expect(result.reason).toBeUndefined();
    });

    it("should include reason when denied", () => {
      const result: ConcurrencyCheckResult = {
        allowed: false,
        current: 5,
        limit: 5,
        key: "concurrency:tenant:test",
        reason: "tenant_limit",
      };
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("tenant_limit");
    });

    it("should support all reason types", () => {
      const reasons: ConcurrencyCheckResult["reason"][] = [
        "tenant_limit",
        "domain_limit",
        "tenant_domain_limit",
        undefined,
      ];
      reasons.forEach((reason) => {
        const result: ConcurrencyCheckResult = {
          allowed: !reason,
          current: 0,
          limit: 5,
          key: "test",
          reason,
        };
        expect(result.reason).toBe(reason);
      });
    });
  });

  describe("CombinedConcurrencyCheckResult", () => {
    it("should have correct structure for allowed result", () => {
      const result: CombinedConcurrencyCheckResult = {
        allowed: true,
        tenantCheck: { allowed: true, current: 2, limit: 5, key: "t" },
        domainCheck: { allowed: true, current: 1, limit: 3, key: "d" },
      };
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should have correct structure for denied result", () => {
      const result: CombinedConcurrencyCheckResult = {
        allowed: false,
        tenantCheck: { allowed: false, current: 5, limit: 5, key: "t", reason: "tenant_limit" },
        reason: "tenant_limit",
      };
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("tenant_limit");
    });

    it("should support optional tenant domain check", () => {
      const result: CombinedConcurrencyCheckResult = {
        allowed: true,
        tenantCheck: { allowed: true, current: 2, limit: 5, key: "t" },
        domainCheck: { allowed: true, current: 1, limit: 3, key: "d" },
        tenantDomainCheck: { allowed: true, current: 1, limit: 2, key: "td" },
      };
      expect(result.tenantDomainCheck).toBeDefined();
    });
  });

  describe("ActiveJobTracker", () => {
    it("should have correct structure", () => {
      const tracker: ActiveJobTracker = {
        jobId: "job-123",
        tenantId: "tenant-456",
        domain: "example.com",
        startedAt: Date.now(),
      };
      expect(tracker.jobId).toBe("job-123");
      expect(tracker.tenantId).toBe("tenant-456");
      expect(tracker.domain).toBe("example.com");
      expect(typeof tracker.startedAt).toBe("number");
    });
  });

  describe("ConcurrencyLimitOptions", () => {
    it("should allow all optional fields", () => {
      const options: ConcurrencyLimitOptions = {};
      expect(options.tenantLimit).toBeUndefined();
      expect(options.domainLimit).toBeUndefined();
      expect(options.checkTenantDomainLimit).toBeUndefined();
      expect(options.tenantDomainLimit).toBeUndefined();
    });

    it("should allow partial configuration", () => {
      const options: ConcurrencyLimitOptions = {
        tenantLimit: 10,
        domainLimit: 5,
      };
      expect(options.tenantLimit).toBe(10);
      expect(options.domainLimit).toBe(5);
    });

    it("should allow tenant+domain configuration", () => {
      const options: ConcurrencyLimitOptions = {
        checkTenantDomainLimit: true,
        tenantDomainLimit: 2,
      };
      expect(options.checkTenantDomainLimit).toBe(true);
      expect(options.tenantDomainLimit).toBe(2);
    });
  });

  describe("ConcurrencyMetrics", () => {
    it("should have correct structure", () => {
      const metrics: ConcurrencyMetrics = {
        byTenant: new Map([["tenant-1", 3], ["tenant-2", 5]]),
        byDomain: new Map([["example.com", 2], ["test.com", 1]]),
        totalActive: 11,
      };
      expect(metrics.byTenant.get("tenant-1")).toBe(3);
      expect(metrics.byDomain.get("example.com")).toBe(2);
      expect(metrics.totalActive).toBe(11);
    });
  });
});

describe("Integration Scenarios", () => {
  describe("Multi-tenant domain sharing", () => {
    it("should support multiple tenants crawling same domain", () => {
      // Verify that domain keys don't include tenant
      const domainKey1 = buildDomainConcurrencyKey("shared-site.com");
      const domainKey2 = buildDomainConcurrencyKey("shared-site.com");
      expect(domainKey1).toBe(domainKey2);

      // But tenant keys are unique
      const tenantKey1 = buildTenantConcurrencyKey("tenant-1");
      const tenantKey2 = buildTenantConcurrencyKey("tenant-2");
      expect(tenantKey1).not.toBe(tenantKey2);
    });

    it("should allow tenant-specific domain limits when needed", () => {
      // Combined keys allow tenant-specific domain limits
      const key1 = buildTenantDomainConcurrencyKey("tenant-1", "api.example.com");
      const key2 = buildTenantDomainConcurrencyKey("tenant-2", "api.example.com");
      expect(key1).not.toBe(key2);
    });
  });

  describe("URL normalization for consistent tracking", () => {
    it("should track same domain regardless of URL path", () => {
      const domain1 = extractDomainFromUrl("https://example.com/page1");
      const domain2 = extractDomainFromUrl("https://example.com/page2");
      expect(domain1).toBe(domain2);
    });

    it("should track same domain regardless of www prefix", () => {
      const domain1 = extractDomainFromUrl("https://www.example.com/page");
      const domain2 = extractDomainFromUrl("https://example.com/page");
      expect(domain1).toBe(domain2);
    });

    it("should track same domain regardless of case", () => {
      const domain1 = extractDomainFromUrl("https://EXAMPLE.COM/page");
      const domain2 = extractDomainFromUrl("https://example.com/page");
      expect(domain1).toBe(domain2);
    });

    it("should track subdomains separately", () => {
      const domain1 = extractDomainFromUrl("https://api.example.com/endpoint");
      const domain2 = extractDomainFromUrl("https://www.example.com/page");
      expect(domain1).not.toBe(domain2);
    });
  });

  describe("Quota enforcement scenarios", () => {
    it("should allow enterprise tenants higher limits", () => {
      const standardTenant = createConcurrencyLimitOptions();
      const enterpriseTenant = createConcurrencyLimitOptions({ maxCrawlConcurrency: 50 });

      expect(standardTenant.tenantLimit).toBe(DEFAULT_TENANT_CONCURRENCY);
      expect(enterpriseTenant.tenantLimit).toBe(50);
    });

    it("should allow disabling tenant crawling with quota 0", () => {
      const disabledTenant = createConcurrencyLimitOptions({ maxCrawlConcurrency: 0 });
      expect(disabledTenant.tenantLimit).toBe(0);
      // With limit 0, no jobs would be allowed
    });
  });
});
