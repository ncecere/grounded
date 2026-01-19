import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  isPlaywrightDownloadsDisabled,
  shouldLogBlockedDownloads,
  getPlaywrightDownloadConfig,
  createBlockedDownloadInfo,
  PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR,
  PLAYWRIGHT_DOWNLOADS_DISABLED_DEFAULT,
  PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_DEFAULT,
  type PlaywrightDownloadConfig,
  type BlockedDownloadInfo,
} from "./index";

describe("Playwright Download Configuration", () => {
  // ============================================================================
  // Constants Tests
  // ============================================================================

  describe("Constants", () => {
    it("should have correct env var name for downloads disabled", () => {
      expect(PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR).toBe("PLAYWRIGHT_DOWNLOADS_DISABLED");
    });

    it("should have correct env var name for log blocked downloads", () => {
      expect(PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR).toBe("PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS");
    });

    it("should have downloads disabled by default", () => {
      expect(PLAYWRIGHT_DOWNLOADS_DISABLED_DEFAULT).toBe(true);
    });

    it("should have log blocked downloads enabled by default", () => {
      expect(PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_DEFAULT).toBe(true);
    });
  });

  // ============================================================================
  // isPlaywrightDownloadsDisabled Tests
  // ============================================================================

  describe("isPlaywrightDownloadsDisabled", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = originalEnv;
      } else {
        delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      }
    });

    it("should return true (disabled) by default when env var is not set", () => {
      expect(isPlaywrightDownloadsDisabled()).toBe(true);
    });

    it("should return false when env var is set to 'false'", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "false";
      expect(isPlaywrightDownloadsDisabled()).toBe(false);
    });

    it("should return false when env var is set to '0'", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "0";
      expect(isPlaywrightDownloadsDisabled()).toBe(false);
    });

    it("should return true when env var is set to 'true'", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "true";
      expect(isPlaywrightDownloadsDisabled()).toBe(true);
    });

    it("should return true when env var is set to '1'", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "1";
      expect(isPlaywrightDownloadsDisabled()).toBe(true);
    });

    it("should return true when env var is set to any other value", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "yes";
      expect(isPlaywrightDownloadsDisabled()).toBe(true);
    });

    it("should return true when env var is set to empty string", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "";
      expect(isPlaywrightDownloadsDisabled()).toBe(true);
    });
  });

  // ============================================================================
  // shouldLogBlockedDownloads Tests
  // ============================================================================

  describe("shouldLogBlockedDownloads", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
      delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = originalEnv;
      } else {
        delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
      }
    });

    it("should return true by default when env var is not set", () => {
      expect(shouldLogBlockedDownloads()).toBe(true);
    });

    it("should return false when env var is set to 'false'", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "false";
      expect(shouldLogBlockedDownloads()).toBe(false);
    });

    it("should return false when env var is set to '0'", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "0";
      expect(shouldLogBlockedDownloads()).toBe(false);
    });

    it("should return true when env var is set to 'true'", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "true";
      expect(shouldLogBlockedDownloads()).toBe(true);
    });

    it("should return true when env var is set to '1'", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "1";
      expect(shouldLogBlockedDownloads()).toBe(true);
    });

    it("should return true when env var is set to any other value", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "yes";
      expect(shouldLogBlockedDownloads()).toBe(true);
    });

    it("should return true when env var is set to empty string", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "";
      expect(shouldLogBlockedDownloads()).toBe(true);
    });
  });

  // ============================================================================
  // getPlaywrightDownloadConfig Tests
  // ============================================================================

  describe("getPlaywrightDownloadConfig", () => {
    let originalDisabledEnv: string | undefined;
    let originalLogEnv: string | undefined;

    beforeEach(() => {
      originalDisabledEnv = process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      originalLogEnv = process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
      delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
    });

    afterEach(() => {
      if (originalDisabledEnv !== undefined) {
        process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = originalDisabledEnv;
      } else {
        delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      }
      if (originalLogEnv !== undefined) {
        process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = originalLogEnv;
      } else {
        delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
      }
    });

    it("should return default config when no env vars are set", () => {
      const config = getPlaywrightDownloadConfig();
      expect(config.downloadsDisabled).toBe(true);
      expect(config.logBlockedDownloads).toBe(true);
    });

    it("should return config with downloads enabled when env var is false", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "false";
      const config = getPlaywrightDownloadConfig();
      expect(config.downloadsDisabled).toBe(false);
      expect(config.logBlockedDownloads).toBe(true);
    });

    it("should return config with logging disabled when env var is false", () => {
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "false";
      const config = getPlaywrightDownloadConfig();
      expect(config.downloadsDisabled).toBe(true);
      expect(config.logBlockedDownloads).toBe(false);
    });

    it("should return config with both disabled when both env vars are false", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "false";
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "false";
      const config = getPlaywrightDownloadConfig();
      expect(config.downloadsDisabled).toBe(false);
      expect(config.logBlockedDownloads).toBe(false);
    });

    it("should return valid PlaywrightDownloadConfig type", () => {
      const config: PlaywrightDownloadConfig = getPlaywrightDownloadConfig();
      expect(typeof config.downloadsDisabled).toBe("boolean");
      expect(typeof config.logBlockedDownloads).toBe("boolean");
    });
  });

  // ============================================================================
  // createBlockedDownloadInfo Tests
  // ============================================================================

  describe("createBlockedDownloadInfo", () => {
    it("should create blocked download info with all fields", () => {
      const info = createBlockedDownloadInfo(
        "https://example.com/page",
        "https://example.com/file.pdf",
        "file.pdf"
      );
      expect(info.pageUrl).toBe("https://example.com/page");
      expect(info.downloadUrl).toBe("https://example.com/file.pdf");
      expect(info.suggestedFilename).toBe("file.pdf");
      expect(info.blockedAt).toBeDefined();
      expect(typeof info.blockedAt).toBe("string");
    });

    it("should create blocked download info with only required fields", () => {
      const info = createBlockedDownloadInfo("https://example.com/page");
      expect(info.pageUrl).toBe("https://example.com/page");
      expect(info.downloadUrl).toBeUndefined();
      expect(info.suggestedFilename).toBeUndefined();
      expect(info.blockedAt).toBeDefined();
    });

    it("should create blocked download info with downloadUrl only", () => {
      const info = createBlockedDownloadInfo(
        "https://example.com/page",
        "https://example.com/file.zip"
      );
      expect(info.pageUrl).toBe("https://example.com/page");
      expect(info.downloadUrl).toBe("https://example.com/file.zip");
      expect(info.suggestedFilename).toBeUndefined();
    });

    it("should generate valid ISO timestamp", () => {
      const before = new Date().toISOString();
      const info = createBlockedDownloadInfo("https://example.com");
      const after = new Date().toISOString();

      // Check that blockedAt is a valid ISO timestamp
      expect(() => new Date(info.blockedAt)).not.toThrow();
      expect(info.blockedAt >= before).toBe(true);
      expect(info.blockedAt <= after).toBe(true);
    });

    it("should return valid BlockedDownloadInfo type", () => {
      const info: BlockedDownloadInfo = createBlockedDownloadInfo(
        "https://example.com",
        "https://example.com/file.pdf",
        "file.pdf"
      );
      expect(info).toHaveProperty("pageUrl");
      expect(info).toHaveProperty("blockedAt");
    });
  });

  // ============================================================================
  // PlaywrightDownloadConfig Interface Tests
  // ============================================================================

  describe("PlaywrightDownloadConfig interface", () => {
    it("should allow creating a valid config object", () => {
      const config: PlaywrightDownloadConfig = {
        downloadsDisabled: true,
        logBlockedDownloads: true,
      };
      expect(config.downloadsDisabled).toBe(true);
      expect(config.logBlockedDownloads).toBe(true);
    });

    it("should allow creating config with all combinations", () => {
      const configs: PlaywrightDownloadConfig[] = [
        { downloadsDisabled: true, logBlockedDownloads: true },
        { downloadsDisabled: true, logBlockedDownloads: false },
        { downloadsDisabled: false, logBlockedDownloads: true },
        { downloadsDisabled: false, logBlockedDownloads: false },
      ];
      expect(configs).toHaveLength(4);
    });
  });

  // ============================================================================
  // BlockedDownloadInfo Interface Tests
  // ============================================================================

  describe("BlockedDownloadInfo interface", () => {
    it("should allow creating a full blocked download info object", () => {
      const info: BlockedDownloadInfo = {
        pageUrl: "https://example.com/page",
        downloadUrl: "https://example.com/file.pdf",
        suggestedFilename: "file.pdf",
        blockedAt: new Date().toISOString(),
      };
      expect(info.pageUrl).toBeDefined();
      expect(info.downloadUrl).toBeDefined();
      expect(info.suggestedFilename).toBeDefined();
      expect(info.blockedAt).toBeDefined();
    });

    it("should allow creating a minimal blocked download info object", () => {
      const info: BlockedDownloadInfo = {
        pageUrl: "https://example.com/page",
        blockedAt: new Date().toISOString(),
      };
      expect(info.pageUrl).toBeDefined();
      expect(info.blockedAt).toBeDefined();
      expect(info.downloadUrl).toBeUndefined();
      expect(info.suggestedFilename).toBeUndefined();
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Integration scenarios", () => {
    let originalDisabledEnv: string | undefined;
    let originalLogEnv: string | undefined;

    beforeEach(() => {
      originalDisabledEnv = process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      originalLogEnv = process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
      delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
    });

    afterEach(() => {
      if (originalDisabledEnv !== undefined) {
        process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = originalDisabledEnv;
      } else {
        delete process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR];
      }
      if (originalLogEnv !== undefined) {
        process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = originalLogEnv;
      } else {
        delete process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR];
      }
    });

    it("should simulate default crawl scenario (downloads disabled, logging enabled)", () => {
      const config = getPlaywrightDownloadConfig();
      expect(config.downloadsDisabled).toBe(true);
      expect(config.logBlockedDownloads).toBe(true);

      // Simulate blocked download
      const info = createBlockedDownloadInfo(
        "https://example.com/page",
        "https://example.com/report.pdf",
        "report.pdf"
      );
      expect(info.pageUrl).toBe("https://example.com/page");
    });

    it("should simulate development scenario (downloads enabled, logging disabled)", () => {
      process.env[PLAYWRIGHT_DOWNLOADS_DISABLED_ENV_VAR] = "false";
      process.env[PLAYWRIGHT_LOG_BLOCKED_DOWNLOADS_ENV_VAR] = "false";

      const config = getPlaywrightDownloadConfig();
      expect(config.downloadsDisabled).toBe(false);
      expect(config.logBlockedDownloads).toBe(false);
    });

    it("should work with various file types in blocked download info", () => {
      const fileTypes = [
        { url: "https://example.com/doc.pdf", filename: "doc.pdf" },
        { url: "https://example.com/image.png", filename: "image.png" },
        { url: "https://example.com/archive.zip", filename: "archive.zip" },
        { url: "https://example.com/data.csv", filename: "data.csv" },
        { url: "https://example.com/video.mp4", filename: "video.mp4" },
      ];

      for (const file of fileTypes) {
        const info = createBlockedDownloadInfo(
          "https://example.com/page",
          file.url,
          file.filename
        );
        expect(info.downloadUrl).toBe(file.url);
        expect(info.suggestedFilename).toBe(file.filename);
      }
    });

    it("should handle URLs with special characters", () => {
      const info = createBlockedDownloadInfo(
        "https://example.com/page?query=value&other=123",
        "https://example.com/file%20with%20spaces.pdf",
        "file with spaces.pdf"
      );
      expect(info.pageUrl).toBe("https://example.com/page?query=value&other=123");
      expect(info.downloadUrl).toBe("https://example.com/file%20with%20spaces.pdf");
      expect(info.suggestedFilename).toBe("file with spaces.pdf");
    });

    it("should handle unicode filenames", () => {
      const info = createBlockedDownloadInfo(
        "https://example.com/page",
        "https://example.com/文档.pdf",
        "文档.pdf"
      );
      expect(info.suggestedFilename).toBe("文档.pdf");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge cases", () => {
    it("should handle empty page URL", () => {
      const info = createBlockedDownloadInfo("");
      expect(info.pageUrl).toBe("");
    });

    it("should handle very long URLs", () => {
      const longUrl = "https://example.com/" + "a".repeat(2000);
      const info = createBlockedDownloadInfo(longUrl);
      expect(info.pageUrl).toBe(longUrl);
    });

    it("should handle undefined download URL and filename", () => {
      const info = createBlockedDownloadInfo("https://example.com", undefined, undefined);
      expect(info.downloadUrl).toBeUndefined();
      expect(info.suggestedFilename).toBeUndefined();
    });
  });
});
