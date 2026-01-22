import { describe, it, expect, beforeEach } from "bun:test";
import {
  // JS Rendering Detection
  needsJsRendering,
  extractBodyTextContent,
  detectJsFrameworkIndicators,
  getJsFrameworkIndicators,
  MIN_BODY_TEXT_LENGTH,
  MIN_TEXT_WITH_FRAMEWORK,
  JS_FRAMEWORK_INDICATORS,
  // Content Size Validation
  validateContentSize,
  isContentSizeValid,
  // Re-exports from @grounded/shared
  MAX_PAGE_SIZE_BYTES,
  validateHtmlContentType,
  isContentTypeEnforcementEnabled,
  ContentError,
  ErrorCode,
} from "./content-validation";

// ============================================================================
// JS Rendering Detection Tests
// ============================================================================

describe("content-validation: JS Rendering Detection", () => {
  describe("constants", () => {
    it("should export MIN_BODY_TEXT_LENGTH as 500", () => {
      expect(MIN_BODY_TEXT_LENGTH).toBe(500);
    });

    it("should export MIN_TEXT_WITH_FRAMEWORK as 1000", () => {
      expect(MIN_TEXT_WITH_FRAMEWORK).toBe(1000);
    });

    it("should export JS_FRAMEWORK_INDICATORS array", () => {
      expect(Array.isArray(JS_FRAMEWORK_INDICATORS)).toBe(true);
      expect(JS_FRAMEWORK_INDICATORS.length).toBeGreaterThan(0);
    });

    it("should include common framework indicators", () => {
      expect(JS_FRAMEWORK_INDICATORS).toContain("data-reactroot");
      expect(JS_FRAMEWORK_INDICATORS).toContain("ng-app");
      expect(JS_FRAMEWORK_INDICATORS).toContain("__NEXT_DATA__");
      expect(JS_FRAMEWORK_INDICATORS).toContain("__NUXT__");
      expect(JS_FRAMEWORK_INDICATORS).toContain('id="app"');
      expect(JS_FRAMEWORK_INDICATORS).toContain('id="root"');
    });
  });

  describe("getJsFrameworkIndicators", () => {
    it("should return the same indicators as the constant", () => {
      const indicators = getJsFrameworkIndicators();
      expect(indicators).toEqual(JS_FRAMEWORK_INDICATORS);
    });

    it("should return a readonly array", () => {
      const indicators = getJsFrameworkIndicators();
      expect(Array.isArray(indicators)).toBe(true);
    });
  });

  describe("extractBodyTextContent", () => {
    it("should extract text from body", () => {
      const html = "<html><body><p>Hello World</p></body></html>";
      const text = extractBodyTextContent(html);
      expect(text).toBe("Hello World");
    });

    it("should strip HTML tags", () => {
      const html = "<html><body><div><p>Hello</p><span>World</span></div></body></html>";
      const text = extractBodyTextContent(html);
      expect(text).toBe("HelloWorld");
    });

    it("should handle empty body", () => {
      const html = "<html><body></body></html>";
      const text = extractBodyTextContent(html);
      expect(text).toBe("");
    });

    it("should handle missing body", () => {
      const html = "<html><head><title>Test</title></head></html>";
      const text = extractBodyTextContent(html);
      expect(text).toBe("");
    });

    it("should handle body with attributes", () => {
      const html = '<html><body class="main" id="content"><p>Content</p></body></html>';
      const text = extractBodyTextContent(html);
      expect(text).toBe("Content");
    });

    it("should trim whitespace", () => {
      const html = "<html><body>  \n  Hello World  \n  </body></html>";
      const text = extractBodyTextContent(html);
      expect(text).toBe("Hello World");
    });
  });

  describe("detectJsFrameworkIndicators", () => {
    it("should detect React indicator", () => {
      const html = '<html><body><div data-reactroot>Content</div></body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toContain("data-reactroot");
    });

    it("should detect Angular indicators", () => {
      const html = '<html ng-app><body ng-controller="MainCtrl">Content</body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toContain("ng-app");
      expect(detected).toContain("ng-controller");
    });

    it("should detect Next.js indicator", () => {
      const html = '<html><body><script id="__NEXT_DATA__">{}</script></body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toContain("__NEXT_DATA__");
    });

    it("should detect Nuxt.js indicator", () => {
      const html = '<html><body><script>window.__NUXT__={}</script></body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toContain("__NUXT__");
    });

    it("should detect id=app indicator", () => {
      const html = '<html><body><div id="app">Content</div></body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toContain('id="app"');
    });

    it("should detect id=root indicator", () => {
      const html = '<html><body><div id="root">Content</div></body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toContain('id="root"');
    });

    it("should return empty array for plain HTML", () => {
      const html = "<html><body><p>Just plain content</p></body></html>";
      const detected = detectJsFrameworkIndicators(html);
      expect(detected).toEqual([]);
    });

    it("should detect multiple indicators", () => {
      const html = '<html><body data-reactroot><div id="root">Content</div></body></html>';
      const detected = detectJsFrameworkIndicators(html);
      expect(detected.length).toBeGreaterThanOrEqual(2);
      expect(detected).toContain("data-reactroot");
      expect(detected).toContain('id="root"');
    });
  });

  describe("needsJsRendering", () => {
    describe("text content length heuristic", () => {
      it("should return true for empty body", () => {
        const html = "<html><body></body></html>";
        expect(needsJsRendering(html)).toBe(true);
      });

      it("should return true for very short content", () => {
        const html = "<html><body><p>Loading...</p></body></html>";
        expect(needsJsRendering(html)).toBe(true);
      });

      it("should return true for content under 500 chars", () => {
        const shortContent = "x".repeat(499);
        const html = `<html><body>${shortContent}</body></html>`;
        expect(needsJsRendering(html)).toBe(true);
      });

      it("should return false for content at exactly 500 chars", () => {
        const content = "x".repeat(500);
        const html = `<html><body>${content}</body></html>`;
        expect(needsJsRendering(html)).toBe(false);
      });

      it("should return false for content over 500 chars without framework indicators", () => {
        const content = "x".repeat(600);
        const html = `<html><body>${content}</body></html>`;
        expect(needsJsRendering(html)).toBe(false);
      });
    });

    describe("framework indicator heuristic", () => {
      it("should return true for React app with sparse content", () => {
        const content = "x".repeat(800); // Between 500 and 1000
        const html = `<html><body><div data-reactroot>${content}</div></body></html>`;
        expect(needsJsRendering(html)).toBe(true);
      });

      it("should return true for Next.js app with sparse content", () => {
        const content = "x".repeat(800);
        const html = `<html><body>${content}<script id="__NEXT_DATA__">{}</script></body></html>`;
        expect(needsJsRendering(html)).toBe(true);
      });

      it("should return false for framework app with rich content", () => {
        const content = "x".repeat(1000); // At threshold
        const html = `<html><body><div data-reactroot>${content}</div></body></html>`;
        expect(needsJsRendering(html)).toBe(false);
      });

      it("should return false for framework app with abundant content", () => {
        const content = "x".repeat(2000);
        const html = `<html><body><div data-reactroot>${content}</div></body></html>`;
        expect(needsJsRendering(html)).toBe(false);
      });
    });

    describe("backward compatibility with page-fetch.ts", () => {
      it("should match original heuristic for typical SPA loading state", () => {
        // Typical React/Vue SPA loading state
        const html = '<html><body><div id="root"><div>Loading...</div></div></body></html>';
        expect(needsJsRendering(html)).toBe(true);
      });

      it("should match original heuristic for fully rendered page", () => {
        const richContent = `
          <h1>Welcome to Our Site</h1>
          <p>This is a paragraph with lots of content. ${" lorem ipsum ".repeat(100)}</p>
          <p>Another paragraph with even more content. ${" dolor sit amet ".repeat(100)}</p>
        `;
        const html = `<html><body>${richContent}</body></html>`;
        expect(needsJsRendering(html)).toBe(false);
      });

      it("should detect JS-heavy page even with some content", () => {
        // Next.js page with hydration data but limited visible content
        const html = `
          <html>
            <body>
              <div id="__next">
                <nav>Home | About | Contact</nav>
                <main>Welcome</main>
              </div>
              <script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
            </body>
          </html>
        `;
        expect(needsJsRendering(html)).toBe(true);
      });
    });
  });
});

// ============================================================================
// Content Size Validation Tests
// ============================================================================

describe("content-validation: Content Size Validation", () => {
  describe("validateContentSize", () => {
    it("should return valid for null content-length", () => {
      const result = validateContentSize(null);
      expect(result.isValid).toBe(true);
      expect(result.contentLength).toBeNull();
      expect(result.maxSize).toBe(MAX_PAGE_SIZE_BYTES);
    });

    it("should return valid for empty string content-length", () => {
      const result = validateContentSize("");
      expect(result.isValid).toBe(true);
      expect(result.contentLength).toBeNull();
    });

    it("should return valid for non-numeric content-length", () => {
      const result = validateContentSize("invalid");
      expect(result.isValid).toBe(true);
      expect(result.contentLength).toBeNull();
    });

    it("should return valid for content within size limit", () => {
      const result = validateContentSize("1000");
      expect(result.isValid).toBe(true);
      expect(result.contentLength).toBe(1000);
      expect(result.maxSize).toBe(MAX_PAGE_SIZE_BYTES);
    });

    it("should return valid for content at exact limit", () => {
      const result = validateContentSize(String(MAX_PAGE_SIZE_BYTES));
      expect(result.isValid).toBe(true);
      expect(result.contentLength).toBe(MAX_PAGE_SIZE_BYTES);
    });

    it("should return invalid for content exceeding limit", () => {
      const overLimit = MAX_PAGE_SIZE_BYTES + 1;
      const result = validateContentSize(String(overLimit));
      expect(result.isValid).toBe(false);
      expect(result.contentLength).toBe(overLimit);
      expect(result.rejectionReason).toBeDefined();
      expect(result.rejectionReason).toContain("exceeds maximum");
    });

    it("should return invalid for very large content", () => {
      const veryLarge = MAX_PAGE_SIZE_BYTES * 10;
      const result = validateContentSize(String(veryLarge));
      expect(result.isValid).toBe(false);
      expect(result.contentLength).toBe(veryLarge);
    });

    it("should handle zero content-length", () => {
      const result = validateContentSize("0");
      expect(result.isValid).toBe(true);
      expect(result.contentLength).toBe(0);
    });
  });

  describe("isContentSizeValid", () => {
    it("should return true for valid content size", () => {
      expect(isContentSizeValid("1000")).toBe(true);
    });

    it("should return true for null content-length", () => {
      expect(isContentSizeValid(null)).toBe(true);
    });

    it("should return false for oversized content", () => {
      const overLimit = MAX_PAGE_SIZE_BYTES + 1;
      expect(isContentSizeValid(String(overLimit))).toBe(false);
    });

    it("should match validateContentSize result", () => {
      const testCases = [
        null,
        "0",
        "1000",
        String(MAX_PAGE_SIZE_BYTES),
        String(MAX_PAGE_SIZE_BYTES + 1),
        "invalid",
      ];

      for (const testCase of testCases) {
        const validation = validateContentSize(testCase);
        expect(isContentSizeValid(testCase)).toBe(validation.isValid);
      }
    });
  });

  describe("MAX_PAGE_SIZE_BYTES constant", () => {
    it("should be exported and be a positive number", () => {
      expect(typeof MAX_PAGE_SIZE_BYTES).toBe("number");
      expect(MAX_PAGE_SIZE_BYTES).toBeGreaterThan(0);
    });

    it("should match the value from @grounded/shared", async () => {
      // Import directly from shared to verify re-export
      const shared = await import("@grounded/shared");
      expect(MAX_PAGE_SIZE_BYTES).toBe(shared.MAX_PAGE_SIZE_BYTES);
    });
  });
});

// ============================================================================
// Re-exports from @grounded/shared Tests
// ============================================================================

describe("content-validation: Re-exports from @grounded/shared", () => {
  it("should re-export validateHtmlContentType", () => {
    expect(typeof validateHtmlContentType).toBe("function");
  });

  it("should re-export isContentTypeEnforcementEnabled", () => {
    expect(typeof isContentTypeEnforcementEnabled).toBe("function");
  });

  it("should re-export ContentError", () => {
    expect(ContentError).toBeDefined();
    expect(typeof ContentError).toBe("function");
  });

  it("should re-export ErrorCode", () => {
    expect(ErrorCode).toBeDefined();
    expect(typeof ErrorCode).toBe("object");
  });

  it("should have CONTENT_UNSUPPORTED_TYPE in ErrorCode", () => {
    expect(ErrorCode.CONTENT_UNSUPPORTED_TYPE).toBeDefined();
  });
});

// ============================================================================
// Integration Tests with existing callers
// ============================================================================

describe("content-validation: Integration with selection.ts and page-fetch.ts", () => {
  describe("needsJsRendering parity", () => {
    // These tests ensure the extracted function behaves identically
    // to the original implementations in selection.ts and page-fetch.ts

    it("should preserve exact thresholds from original", () => {
      // Original used 500 for min body text
      const borderline499 = "a".repeat(499);
      const borderline500 = "a".repeat(500);
      
      expect(needsJsRendering(`<html><body>${borderline499}</body></html>`)).toBe(true);
      expect(needsJsRendering(`<html><body>${borderline500}</body></html>`)).toBe(false);
    });

    it("should preserve framework detection threshold from original", () => {
      // Original used 1000 for framework indicator threshold
      const borderline999 = "a".repeat(999);
      const borderline1000 = "a".repeat(1000);
      
      const withFramework999 = `<html><body><div data-reactroot>${borderline999}</div></body></html>`;
      const withFramework1000 = `<html><body><div data-reactroot>${borderline1000}</div></body></html>`;
      
      expect(needsJsRendering(withFramework999)).toBe(true);
      expect(needsJsRendering(withFramework1000)).toBe(false);
    });

    it("should match original regex for body extraction", () => {
      // Test various body tag formats
      const testCases = [
        '<html><body>content</body></html>',
        '<html><BODY>content</BODY></html>',
        '<html><body class="foo">content</body></html>',
        '<html><body id="main" data-test="bar">content</body></html>',
      ];

      for (const html of testCases) {
        const text = extractBodyTextContent(html);
        expect(text).toBe("content");
      }
    });
  });

  describe("selection.ts backward compatibility", () => {
    it("should be importable from fetch/selection.ts re-export", async () => {
      const selection = await import("../fetch/selection");
      expect(selection.needsJsRendering).toBeDefined();
      expect(selection.getJsFrameworkIndicators).toBeDefined();
      expect(selection.MIN_BODY_TEXT_LENGTH).toBe(MIN_BODY_TEXT_LENGTH);
      expect(selection.MIN_TEXT_WITH_FRAMEWORK).toBe(MIN_TEXT_WITH_FRAMEWORK);
    });
  });
});
