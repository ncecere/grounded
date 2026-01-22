import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  selectStrategy,
  needsJsRendering,
  getJsFrameworkIndicators,
  selectAndFetch,
  MIN_BODY_TEXT_LENGTH,
  MIN_TEXT_WITH_FRAMEWORK,
  type FetchContext,
  type FetchSourceConfig,
  type StrategySelectionResult,
} from "./selection";

// ============================================================================
// Strategy Selection Tests
// ============================================================================

describe("selectStrategy", () => {
  describe("firecrawl mode", () => {
    test("selects firecrawl when fetchMode is firecrawl", () => {
      const result = selectStrategy("firecrawl", {});
      
      expect(result.strategy).toBe("firecrawl");
      expect(result.allowPlaywrightFallback).toBe(false);
      expect(result.reason).toContain("firecrawl");
    });

    test("selects firecrawl when auto mode with firecrawlEnabled", () => {
      const result = selectStrategy("auto", { firecrawlEnabled: true });
      
      expect(result.strategy).toBe("firecrawl");
      expect(result.allowPlaywrightFallback).toBe(false);
      expect(result.reason).toContain("firecrawlEnabled");
    });

    test("does not select firecrawl for auto mode when firecrawlEnabled is false", () => {
      const result = selectStrategy("auto", { firecrawlEnabled: false });
      
      expect(result.strategy).not.toBe("firecrawl");
    });

    test("does not select firecrawl for auto mode when firecrawlEnabled is undefined", () => {
      const result = selectStrategy("auto", {});
      
      expect(result.strategy).not.toBe("firecrawl");
    });
  });

  describe("headless mode", () => {
    test("selects playwright when fetchMode is headless", () => {
      const result = selectStrategy("headless", {});
      
      expect(result.strategy).toBe("playwright");
      expect(result.allowPlaywrightFallback).toBe(false);
      expect(result.reason).toContain("headless");
    });

    test("headless takes precedence over firecrawlEnabled", () => {
      const result = selectStrategy("headless", { firecrawlEnabled: true });
      
      expect(result.strategy).toBe("playwright");
    });
  });

  describe("auto and html modes", () => {
    test("selects http with fallback for auto mode", () => {
      const result = selectStrategy("auto", {});
      
      expect(result.strategy).toBe("http");
      expect(result.allowPlaywrightFallback).toBe(true);
      expect(result.reason).toContain("auto");
    });

    test("selects http with fallback for html mode", () => {
      const result = selectStrategy("html", {});
      
      expect(result.strategy).toBe("http");
      expect(result.allowPlaywrightFallback).toBe(true);
      expect(result.reason).toContain("html");
    });

    test("auto mode without firecrawlEnabled selects http", () => {
      const result = selectStrategy("auto", { firecrawlEnabled: false });
      
      expect(result.strategy).toBe("http");
      expect(result.allowPlaywrightFallback).toBe(true);
    });
  });

  describe("decision tree completeness", () => {
    test("all fetch modes are handled", () => {
      const modes = ["auto", "html", "headless", "firecrawl"] as const;
      
      for (const mode of modes) {
        const result = selectStrategy(mode, {});
        expect(result.strategy).toBeDefined();
        expect(["http", "playwright", "firecrawl"]).toContain(result.strategy);
      }
    });

    test("selection result always has required fields", () => {
      const testCases: Array<{ mode: "auto" | "html" | "headless" | "firecrawl"; config: FetchSourceConfig }> = [
        { mode: "auto", config: {} },
        { mode: "auto", config: { firecrawlEnabled: true } },
        { mode: "html", config: {} },
        { mode: "headless", config: {} },
        { mode: "firecrawl", config: {} },
      ];

      for (const { mode, config } of testCases) {
        const result = selectStrategy(mode, config);
        
        expect(typeof result.strategy).toBe("string");
        expect(typeof result.allowPlaywrightFallback).toBe("boolean");
        expect(typeof result.reason).toBe("string");
        expect(result.reason.length).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================================
// JS Rendering Detection Tests
// ============================================================================

describe("needsJsRendering", () => {
  describe("text content length heuristics", () => {
    test("returns true for empty body", () => {
      const html = "<html><body></body></html>";
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns true for body with very little text", () => {
      const shortText = "a".repeat(MIN_BODY_TEXT_LENGTH - 1);
      const html = `<html><body>${shortText}</body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns false for body with sufficient text", () => {
      const longText = "a".repeat(MIN_BODY_TEXT_LENGTH + 100);
      const html = `<html><body>${longText}</body></html>`;
      expect(needsJsRendering(html)).toBe(false);
    });

    test("strips HTML tags when calculating text length", () => {
      const text = "a".repeat(100);
      // Lots of tags but minimal text
      const html = `<html><body><div><span><a href="#">${text}</a></span></div></body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("handles whitespace-only body", () => {
      const html = "<html><body>   \n\t   </body></html>";
      expect(needsJsRendering(html)).toBe(true);
    });
  });

  describe("JS framework detection", () => {
    const frameworkIndicators = getJsFrameworkIndicators();

    test("exports framework indicators", () => {
      expect(frameworkIndicators.length).toBeGreaterThan(0);
      expect(frameworkIndicators).toContain("data-reactroot");
      expect(frameworkIndicators).toContain("__NEXT_DATA__");
      expect(frameworkIndicators).toContain("__NUXT__");
    });

    test("returns true for React root with sparse content", () => {
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 1);
      const html = `<html><body><div data-reactroot>${text}</div></body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns false for React root with sufficient content", () => {
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK + 100);
      const html = `<html><body><div data-reactroot>${text}</div></body></html>`;
      expect(needsJsRendering(html)).toBe(false);
    });

    test("returns true for Angular app with sparse content", () => {
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 1);
      const html = `<html ng-app="myApp"><body>${text}</body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns true for Next.js with sparse content", () => {
      // Use fewer chars to account for script content that gets extracted
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 10);
      const html = `<html><body>${text}<script id="__NEXT_DATA__">{}</script></body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns true for Nuxt.js with sparse content", () => {
      // Use fewer chars to account for script content that gets extracted
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 20);
      const html = `<html><body>${text}<script>window.__NUXT__={}</script></body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns true for id=app with sparse content", () => {
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 1);
      const html = `<html><body><div id="app">${text}</div></body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("returns true for id=root with sparse content", () => {
      const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 1);
      const html = `<html><body><div id="root">${text}</div></body></html>`;
      expect(needsJsRendering(html)).toBe(true);
    });

    test("all documented framework indicators trigger detection", () => {
      for (const indicator of frameworkIndicators) {
        // Use significantly fewer chars since indicator adds to body text length
        // when it appears as plain text (for testing purposes)
        const text = "a".repeat(MIN_TEXT_WITH_FRAMEWORK - 100);
        const html = `<html><body>${indicator}${text}</body></html>`;
        expect(needsJsRendering(html)).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    test("handles missing body tag", () => {
      const html = "<html><div>Some content</div></html>";
      // Should return true since body extraction returns empty string
      expect(needsJsRendering(html)).toBe(true);
    });

    test("handles malformed HTML gracefully", () => {
      const html = "<html><body>Some text<div>Unclosed";
      // Should not throw
      expect(() => needsJsRendering(html)).not.toThrow();
    });

    test("handles HTML with no tags", () => {
      const html = "Just plain text without any HTML tags";
      // Should return true (no body found)
      expect(needsJsRendering(html)).toBe(true);
    });

    test("body tag matching is case insensitive", () => {
      const text = "a".repeat(MIN_BODY_TEXT_LENGTH + 100);
      const html = `<html><BODY>${text}</BODY></html>`;
      expect(needsJsRendering(html)).toBe(false);
    });
  });
});

// ============================================================================
// Constants Tests
// ============================================================================

describe("constants", () => {
  test("MIN_BODY_TEXT_LENGTH matches baseline (500)", () => {
    expect(MIN_BODY_TEXT_LENGTH).toBe(500);
  });

  test("MIN_TEXT_WITH_FRAMEWORK matches baseline (1000)", () => {
    expect(MIN_TEXT_WITH_FRAMEWORK).toBe(1000);
  });

  test("framework indicators include all baseline values", () => {
    const indicators = getJsFrameworkIndicators();
    const expectedIndicators = [
      "data-reactroot",
      "ng-app",
      "ng-controller",
      "__NEXT_DATA__",
      "__NUXT__",
      "id=\"app\"",
      "id=\"root\"",
    ];

    for (const expected of expectedIndicators) {
      expect(indicators).toContain(expected);
    }
  });
});

// ============================================================================
// selectAndFetch Integration Tests
// ============================================================================

describe("selectAndFetch", () => {
  // Note: Full integration tests require mocking the fetch functions
  // These tests verify the function signature and basic error handling
  
  test("function accepts valid FetchContext", () => {
    // Type check - this should compile
    const context: FetchContext = {
      url: "https://example.com",
      fetchMode: "auto",
      sourceConfig: {},
      browser: {} as any, // Mock browser
    };

    // We can't easily test the actual fetch without mocking,
    // but we can verify the function exists and accepts the right shape
    expect(typeof selectAndFetch).toBe("function");
  });

  test("FetchContext interface includes all required fields", () => {
    // Compile-time check via type annotation
    const context: FetchContext = {
      url: "https://example.com",
      fetchMode: "firecrawl",
      sourceConfig: { firecrawlEnabled: true },
      browser: {} as any,
    };

    expect(context.url).toBeDefined();
    expect(context.fetchMode).toBeDefined();
    expect(context.sourceConfig).toBeDefined();
    expect(context.browser).toBeDefined();
  });
});

// ============================================================================
// Decision Rule Parity Tests
// ============================================================================

describe("decision rule parity with page-fetch.ts", () => {
  /**
   * These tests verify that the selectStrategy function produces the same
   * strategy selection as the original logic in page-fetch.ts lines 102-134
   */

  test("firecrawl mode -> firecrawl strategy (line 103)", () => {
    const result = selectStrategy("firecrawl", {});
    expect(result.strategy).toBe("firecrawl");
  });

  test("auto mode + firecrawlEnabled -> firecrawl strategy (line 103)", () => {
    const result = selectStrategy("auto", { firecrawlEnabled: true });
    expect(result.strategy).toBe("firecrawl");
  });

  test("headless mode -> playwright strategy (line 108-112)", () => {
    const result = selectStrategy("headless", {});
    expect(result.strategy).toBe("playwright");
  });

  test("auto mode (no firecrawl) -> http with fallback (line 113-133)", () => {
    const result = selectStrategy("auto", {});
    expect(result.strategy).toBe("http");
    expect(result.allowPlaywrightFallback).toBe(true);
  });

  test("html mode -> http with fallback", () => {
    const result = selectStrategy("html", {});
    expect(result.strategy).toBe("http");
    expect(result.allowPlaywrightFallback).toBe(true);
  });

  test("needsJsRendering matches page-fetch.ts heuristics (lines 228-259)", () => {
    // Test case: body text < 500 chars returns true
    const sparseHtml = "<html><body>short</body></html>";
    expect(needsJsRendering(sparseHtml)).toBe(true);

    // Test case: body text >= 500 chars with no frameworks returns false
    const longText = "a".repeat(600);
    const fullHtml = `<html><body>${longText}</body></html>`;
    expect(needsJsRendering(fullHtml)).toBe(false);

    // Test case: framework indicator + text < 1000 returns true
    const mediumText = "a".repeat(800);
    const reactHtml = `<html><body><div data-reactroot>${mediumText}</div></body></html>`;
    expect(needsJsRendering(reactHtml)).toBe(true);

    // Test case: framework indicator + text >= 1000 returns false
    const sufficientText = "a".repeat(1100);
    const reactWithContent = `<html><body><div data-reactroot>${sufficientText}</div></body></html>`;
    expect(needsJsRendering(reactWithContent)).toBe(false);
  });
});
