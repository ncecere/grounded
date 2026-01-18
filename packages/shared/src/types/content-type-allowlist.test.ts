import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  // Types
  type ContentTypeValidationResult,
  type ContentTypeValidationConfig,
  // Constants
  HTML_CONTENT_TYPES,
  NON_HTML_CONTENT_TYPES,
  HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR,
  // Functions
  parseContentType,
  isHtmlMimeType,
  isBlockedMimeType,
  validateHtmlContentType,
  getContentTypeValidationConfig,
  isContentTypeEnforcementEnabled,
} from "./index";

describe("HTML Content-Type Allowlist Constants", () => {
  describe("HTML_CONTENT_TYPES", () => {
    it("should include text/html", () => {
      expect(HTML_CONTENT_TYPES).toContain("text/html");
    });

    it("should include application/xhtml+xml", () => {
      expect(HTML_CONTENT_TYPES).toContain("application/xhtml+xml");
    });

    it("should include application/xml", () => {
      expect(HTML_CONTENT_TYPES).toContain("application/xml");
    });

    it("should include text/xml", () => {
      expect(HTML_CONTENT_TYPES).toContain("text/xml");
    });

    it("should have exactly 4 HTML types", () => {
      expect(HTML_CONTENT_TYPES).toHaveLength(4);
    });

    it("should not include non-HTML types", () => {
      expect(HTML_CONTENT_TYPES).not.toContain("application/pdf");
      expect(HTML_CONTENT_TYPES).not.toContain("application/json");
      expect(HTML_CONTENT_TYPES).not.toContain("image/png");
    });
  });

  describe("NON_HTML_CONTENT_TYPES", () => {
    it("should include common document types", () => {
      expect(NON_HTML_CONTENT_TYPES).toContain("application/pdf");
      expect(NON_HTML_CONTENT_TYPES).toContain("application/msword");
      expect(NON_HTML_CONTENT_TYPES).toContain(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
    });

    it("should include common image types", () => {
      expect(NON_HTML_CONTENT_TYPES).toContain("image/jpeg");
      expect(NON_HTML_CONTENT_TYPES).toContain("image/png");
      expect(NON_HTML_CONTENT_TYPES).toContain("image/gif");
      expect(NON_HTML_CONTENT_TYPES).toContain("image/webp");
    });

    it("should include audio/video types", () => {
      expect(NON_HTML_CONTENT_TYPES).toContain("audio/mpeg");
      expect(NON_HTML_CONTENT_TYPES).toContain("video/mp4");
    });

    it("should include archive types", () => {
      expect(NON_HTML_CONTENT_TYPES).toContain("application/zip");
      expect(NON_HTML_CONTENT_TYPES).toContain("application/gzip");
    });

    it("should include binary types", () => {
      expect(NON_HTML_CONTENT_TYPES).toContain("application/octet-stream");
    });

    it("should include data format types", () => {
      expect(NON_HTML_CONTENT_TYPES).toContain("application/json");
      expect(NON_HTML_CONTENT_TYPES).toContain("text/plain");
      expect(NON_HTML_CONTENT_TYPES).toContain("text/css");
      expect(NON_HTML_CONTENT_TYPES).toContain("text/javascript");
      expect(NON_HTML_CONTENT_TYPES).toContain("text/csv");
    });

    it("should not include HTML types", () => {
      expect(NON_HTML_CONTENT_TYPES).not.toContain("text/html");
      expect(NON_HTML_CONTENT_TYPES).not.toContain("application/xhtml+xml");
    });
  });

  describe("HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR", () => {
    it("should have the expected env var name", () => {
      expect(HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR).toBe(
        "HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED"
      );
    });

    it("should be a valid environment variable name", () => {
      expect(HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR).toMatch(/^[A-Z][A-Z0-9_]*$/);
    });
  });
});

describe("parseContentType", () => {
  it("should parse simple content type", () => {
    const result = parseContentType("text/html");
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBeUndefined();
  });

  it("should parse content type with charset", () => {
    const result = parseContentType("text/html; charset=utf-8");
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
  });

  it("should handle charset with quotes", () => {
    const result = parseContentType('text/html; charset="UTF-8"');
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
  });

  it("should handle multiple parameters", () => {
    const result = parseContentType("text/html; charset=utf-8; boundary=something");
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
  });

  it("should normalize to lowercase", () => {
    const result = parseContentType("TEXT/HTML; CHARSET=UTF-8");
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
  });

  it("should handle whitespace", () => {
    const result = parseContentType("  text/html  ;  charset=utf-8  ");
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
  });

  it("should handle empty string", () => {
    const result = parseContentType("");
    expect(result.mimeType).toBe("");
    expect(result.charset).toBeUndefined();
  });

  it("should handle content type without charset parameter", () => {
    const result = parseContentType("application/pdf");
    expect(result.mimeType).toBe("application/pdf");
    expect(result.charset).toBeUndefined();
  });
});

describe("isHtmlMimeType", () => {
  it("should return true for text/html", () => {
    expect(isHtmlMimeType("text/html")).toBe(true);
  });

  it("should return true for application/xhtml+xml", () => {
    expect(isHtmlMimeType("application/xhtml+xml")).toBe(true);
  });

  it("should return true for application/xml", () => {
    expect(isHtmlMimeType("application/xml")).toBe(true);
  });

  it("should return true for text/xml", () => {
    expect(isHtmlMimeType("text/xml")).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(isHtmlMimeType("TEXT/HTML")).toBe(true);
    expect(isHtmlMimeType("Text/Html")).toBe(true);
  });

  it("should return false for non-HTML types", () => {
    expect(isHtmlMimeType("application/pdf")).toBe(false);
    expect(isHtmlMimeType("application/json")).toBe(false);
    expect(isHtmlMimeType("text/plain")).toBe(false);
    expect(isHtmlMimeType("image/png")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(isHtmlMimeType("")).toBe(false);
  });
});

describe("isBlockedMimeType", () => {
  it("should return true for PDF", () => {
    expect(isBlockedMimeType("application/pdf")).toBe(true);
  });

  it("should return true for images", () => {
    expect(isBlockedMimeType("image/jpeg")).toBe(true);
    expect(isBlockedMimeType("image/png")).toBe(true);
    expect(isBlockedMimeType("image/gif")).toBe(true);
  });

  it("should return true for JSON", () => {
    expect(isBlockedMimeType("application/json")).toBe(true);
  });

  it("should return true for plain text", () => {
    expect(isBlockedMimeType("text/plain")).toBe(true);
  });

  it("should return true for JavaScript", () => {
    expect(isBlockedMimeType("text/javascript")).toBe(true);
    expect(isBlockedMimeType("application/javascript")).toBe(true);
  });

  it("should be case insensitive", () => {
    expect(isBlockedMimeType("APPLICATION/PDF")).toBe(true);
    expect(isBlockedMimeType("Image/Png")).toBe(true);
  });

  it("should return false for HTML types", () => {
    expect(isBlockedMimeType("text/html")).toBe(false);
    expect(isBlockedMimeType("application/xhtml+xml")).toBe(false);
  });

  it("should return false for unknown types", () => {
    expect(isBlockedMimeType("application/custom-type")).toBe(false);
    expect(isBlockedMimeType("")).toBe(false);
  });
});

describe("validateHtmlContentType", () => {
  describe("Valid HTML content types", () => {
    it("should validate text/html", () => {
      const result = validateHtmlContentType("text/html");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("text/html");
      expect(result.category).toBe("html");
      expect(result.rejectionReason).toBeUndefined();
    });

    it("should validate text/html with charset", () => {
      const result = validateHtmlContentType("text/html; charset=utf-8");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("text/html");
      expect(result.charset).toBe("utf-8");
      expect(result.category).toBe("html");
    });

    it("should validate application/xhtml+xml", () => {
      const result = validateHtmlContentType("application/xhtml+xml");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("application/xhtml+xml");
      expect(result.category).toBe("html");
    });

    it("should validate application/xml", () => {
      const result = validateHtmlContentType("application/xml");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("application/xml");
      expect(result.category).toBe("html");
    });

    it("should validate text/xml", () => {
      const result = validateHtmlContentType("text/xml");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("text/xml");
      expect(result.category).toBe("html");
    });
  });

  describe("Invalid content types (blocked)", () => {
    it("should reject application/pdf", () => {
      const result = validateHtmlContentType("application/pdf");
      expect(result.isValid).toBe(false);
      expect(result.mimeType).toBe("application/pdf");
      expect(result.category).toBe("non_html");
      expect(result.rejectionReason).toContain("not HTML");
    });

    it("should reject image types", () => {
      const result = validateHtmlContentType("image/png");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("non_html");
    });

    it("should reject application/json", () => {
      const result = validateHtmlContentType("application/json");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("non_html");
    });

    it("should reject text/plain", () => {
      const result = validateHtmlContentType("text/plain");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("non_html");
    });

    it("should reject text/css", () => {
      const result = validateHtmlContentType("text/css");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("non_html");
    });

    it("should reject JavaScript", () => {
      const result = validateHtmlContentType("text/javascript");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("non_html");
    });

    it("should reject binary streams", () => {
      const result = validateHtmlContentType("application/octet-stream");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("non_html");
    });
  });

  describe("Unknown content types", () => {
    it("should reject unknown types", () => {
      const result = validateHtmlContentType("application/custom-type");
      expect(result.isValid).toBe(false);
      expect(result.category).toBe("unknown");
      expect(result.rejectionReason).toContain("not in the HTML allowlist");
    });
  });

  describe("Empty/null content types", () => {
    it("should allow empty content type with unknown category", () => {
      const result = validateHtmlContentType("");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("");
      expect(result.category).toBe("unknown");
    });

    it("should allow null content type", () => {
      const result = validateHtmlContentType(null);
      expect(result.isValid).toBe(true);
      expect(result.category).toBe("unknown");
    });

    it("should allow undefined content type", () => {
      const result = validateHtmlContentType(undefined);
      expect(result.isValid).toBe(true);
      expect(result.category).toBe("unknown");
    });
  });

  describe("Edge cases", () => {
    it("should handle case-insensitive content types", () => {
      const result = validateHtmlContentType("TEXT/HTML");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("text/html");
    });

    it("should preserve raw content type", () => {
      const result = validateHtmlContentType("TEXT/HTML; CHARSET=UTF-8");
      expect(result.rawContentType).toBe("TEXT/HTML; CHARSET=UTF-8");
    });

    it("should handle whitespace in content type", () => {
      const result = validateHtmlContentType("  text/html  ");
      expect(result.isValid).toBe(true);
      expect(result.mimeType).toBe("text/html");
    });
  });
});

describe("getContentTypeValidationConfig", () => {
  const originalEnv = process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
    } else {
      process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = originalEnv;
    }
  });

  it("should return enabled by default", () => {
    delete process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
    const config = getContentTypeValidationConfig();
    expect(config.enabled).toBe(true);
  });

  it("should return disabled when env var is true", () => {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "true";
    const config = getContentTypeValidationConfig();
    expect(config.enabled).toBe(false);
  });

  it("should return disabled when env var is 1", () => {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "1";
    const config = getContentTypeValidationConfig();
    expect(config.enabled).toBe(false);
  });

  it("should return enabled when env var is false", () => {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "false";
    const config = getContentTypeValidationConfig();
    expect(config.enabled).toBe(true);
  });

  it("should include allowed types", () => {
    const config = getContentTypeValidationConfig();
    expect(config.allowedTypes).toBe(HTML_CONTENT_TYPES);
  });

  it("should include blocked types", () => {
    const config = getContentTypeValidationConfig();
    expect(config.blockedTypes).toBe(NON_HTML_CONTENT_TYPES);
  });
});

describe("isContentTypeEnforcementEnabled", () => {
  const originalEnv = process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
    } else {
      process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = originalEnv;
    }
  });

  it("should return true by default", () => {
    delete process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR];
    expect(isContentTypeEnforcementEnabled()).toBe(true);
  });

  it("should return false when disabled with true", () => {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "true";
    expect(isContentTypeEnforcementEnabled()).toBe(false);
  });

  it("should return false when disabled with 1", () => {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "1";
    expect(isContentTypeEnforcementEnabled()).toBe(false);
  });

  it("should return true for any other value", () => {
    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "false";
    expect(isContentTypeEnforcementEnabled()).toBe(true);

    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "0";
    expect(isContentTypeEnforcementEnabled()).toBe(true);

    process.env[HTML_CONTENT_TYPE_ENFORCEMENT_DISABLED_ENV_VAR] = "no";
    expect(isContentTypeEnforcementEnabled()).toBe(true);
  });
});

describe("ContentTypeValidationResult type", () => {
  it("should have the correct shape for valid HTML", () => {
    const result: ContentTypeValidationResult = {
      isValid: true,
      rawContentType: "text/html; charset=utf-8",
      mimeType: "text/html",
      charset: "utf-8",
      category: "html",
    };
    expect(result.isValid).toBe(true);
    expect(result.rejectionReason).toBeUndefined();
  });

  it("should have the correct shape for invalid content", () => {
    const result: ContentTypeValidationResult = {
      isValid: false,
      rawContentType: "application/pdf",
      mimeType: "application/pdf",
      category: "non_html",
      rejectionReason: "Content type is not HTML",
    };
    expect(result.isValid).toBe(false);
    expect(result.rejectionReason).toBeDefined();
  });
});

describe("ContentTypeValidationConfig type", () => {
  it("should have the correct shape", () => {
    const config: ContentTypeValidationConfig = {
      enabled: true,
      allowedTypes: HTML_CONTENT_TYPES,
      blockedTypes: NON_HTML_CONTENT_TYPES,
    };
    expect(config.enabled).toBe(true);
    expect(config.allowedTypes.length).toBeGreaterThan(0);
    expect(config.blockedTypes.length).toBeGreaterThan(0);
  });
});

describe("Integration scenarios", () => {
  it("should correctly validate typical HTML response", () => {
    // Typical HTML response from a web server
    const result = validateHtmlContentType("text/html; charset=utf-8");
    expect(result.isValid).toBe(true);
    expect(result.mimeType).toBe("text/html");
    expect(result.charset).toBe("utf-8");
  });

  it("should correctly validate XHTML response", () => {
    const result = validateHtmlContentType("application/xhtml+xml; charset=utf-8");
    expect(result.isValid).toBe(true);
    expect(result.mimeType).toBe("application/xhtml+xml");
  });

  it("should correctly reject PDF download link", () => {
    const result = validateHtmlContentType("application/pdf");
    expect(result.isValid).toBe(false);
    expect(result.category).toBe("non_html");
  });

  it("should correctly reject image link", () => {
    const result = validateHtmlContentType("image/jpeg");
    expect(result.isValid).toBe(false);
    expect(result.category).toBe("non_html");
  });

  it("should correctly reject API JSON response", () => {
    const result = validateHtmlContentType("application/json; charset=utf-8");
    expect(result.isValid).toBe(false);
    expect(result.mimeType).toBe("application/json");
    expect(result.category).toBe("non_html");
  });

  it("should correctly reject ZIP download", () => {
    const result = validateHtmlContentType("application/zip");
    expect(result.isValid).toBe(false);
    expect(result.category).toBe("non_html");
  });

  it("should correctly handle XML (allowed as HTML-like)", () => {
    // XML is allowed because some sites serve HTML as XML
    const result = validateHtmlContentType("application/xml; charset=utf-8");
    expect(result.isValid).toBe(true);
    expect(result.mimeType).toBe("application/xml");
  });

  it("should correctly reject executable downloads", () => {
    const result = validateHtmlContentType("application/x-executable");
    expect(result.isValid).toBe(false);
    expect(result.category).toBe("non_html");
  });
});
