import { describe, it, expect } from "bun:test";
import {
  baseJobSchema,
  webSourceJobConfigSchema,
  uploadSourceJobConfigSchema,
  sourceJobConfigSchema,
  webSourceRunStartJobSchema,
  webSourceDiscoverJobSchema,
  pageFetchJobSchema,
  uploadSourceRunStartJobSchema,
  pageProcessJobSchema,
  pageIndexJobSchema,
  embedChunksBatchJobSchema,
  enrichPageJobSchema,
  sourceRunFinalizeJobSchema,
  hardDeleteObjectJobSchema,
  kbReindexJobSchema,
  validateJobPayload,
  safeValidateJobPayload,
  isWebSourcePayload,
  isUploadSourcePayload,
  type WebSourceJobConfig,
  type UploadSourceJobConfig,
  type WebSourceRunStartJobPayload,
  type UploadSourceRunStartJobPayload,
  type PageFetchJobPayload,
  type PageProcessJobPayload,
  type PageIndexJobPayload,
  type EmbedChunksBatchJobPayload,
  type SourceRunJobPayload,
  type IngestionJobPayload,
  type AnyJobPayload,
} from "./index";

// Test UUIDs for consistent testing
const TEST_TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";
const TEST_SOURCE_ID = "550e8400-e29b-41d4-a716-446655440002";
const TEST_RUN_ID = "550e8400-e29b-41d4-a716-446655440003";
const TEST_KB_ID = "550e8400-e29b-41d4-a716-446655440004";
const TEST_UPLOAD_ID = "550e8400-e29b-41d4-a716-446655440005";
const TEST_CHUNK_ID = "550e8400-e29b-41d4-a716-446655440006";
const TEST_PAGE_ID = "550e8400-e29b-41d4-a716-446655440008";
const TEST_CONTENT_ID = "550e8400-e29b-41d4-a716-446655440009";
const TEST_REQUEST_ID = "550e8400-e29b-41d4-a716-446655440007";

describe("Job Payload Schemas", () => {
  describe("baseJobSchema", () => {
    it("should accept empty object", () => {
      const result = baseJobSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should accept valid requestId", () => {
      const result = baseJobSchema.safeParse({ requestId: TEST_REQUEST_ID });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requestId).toBe(TEST_REQUEST_ID);
      }
    });

    it("should accept valid traceId", () => {
      const result = baseJobSchema.safeParse({ traceId: "trace-123-abc" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.traceId).toBe("trace-123-abc");
      }
    });

    it("should reject invalid requestId format", () => {
      const result = baseJobSchema.safeParse({ requestId: "not-a-uuid" });
      expect(result.success).toBe(false);
    });
  });

  describe("webSourceJobConfigSchema", () => {
    it("should accept valid web source config", () => {
      const config: WebSourceJobConfig = {
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
        depth: 3,
        includePatterns: [],
        excludePatterns: [],
        includeSubdomains: false,
        respectRobotsTxt: true,
      };
      const result = webSourceJobConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should apply default values", () => {
      const minimalConfig = {
        sourceType: "web",
        mode: "single",
        fetchMode: "html",
      };
      const result = webSourceJobConfigSchema.safeParse(minimalConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.depth).toBe(3);
        expect(result.data.includePatterns).toEqual([]);
        expect(result.data.excludePatterns).toEqual([]);
        expect(result.data.includeSubdomains).toBe(false);
        expect(result.data.respectRobotsTxt).toBe(true);
      }
    });

    it("should accept all valid modes", () => {
      const modes = ["single", "list", "sitemap", "domain"] as const;
      for (const mode of modes) {
        const result = webSourceJobConfigSchema.safeParse({
          sourceType: "web",
          mode,
          fetchMode: "auto",
        });
        expect(result.success).toBe(true);
      }
    });

    it("should accept all valid fetchModes", () => {
      const fetchModes = ["auto", "html", "headless", "firecrawl"] as const;
      for (const fetchMode of fetchModes) {
        const result = webSourceJobConfigSchema.safeParse({
          sourceType: "web",
          mode: "single",
          fetchMode,
        });
        expect(result.success).toBe(true);
      }
    });

    it("should enforce depth constraints", () => {
      // Too low
      const tooLow = webSourceJobConfigSchema.safeParse({
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
        depth: 0,
      });
      expect(tooLow.success).toBe(false);

      // Too high
      const tooHigh = webSourceJobConfigSchema.safeParse({
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
        depth: 11,
      });
      expect(tooHigh.success).toBe(false);

      // Valid
      const valid = webSourceJobConfigSchema.safeParse({
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
        depth: 5,
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("uploadSourceJobConfigSchema", () => {
    it("should accept valid upload source config", () => {
      const config: UploadSourceJobConfig = {
        sourceType: "upload",
        uploadId: TEST_UPLOAD_ID,
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      };
      const result = uploadSourceJobConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should reject missing required fields", () => {
      const missingUploadId = uploadSourceJobConfigSchema.safeParse({
        sourceType: "upload",
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      });
      expect(missingUploadId.success).toBe(false);
    });

    it("should reject invalid uploadId format", () => {
      const result = uploadSourceJobConfigSchema.safeParse({
        sourceType: "upload",
        uploadId: "not-a-uuid",
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative sizeBytes", () => {
      const result = uploadSourceJobConfigSchema.safeParse({
        sourceType: "upload",
        uploadId: TEST_UPLOAD_ID,
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: -1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sourceJobConfigSchema (discriminated union)", () => {
    it("should correctly parse web source config", () => {
      const webConfig = {
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
      };
      const result = sourceJobConfigSchema.safeParse(webConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sourceType).toBe("web");
      }
    });

    it("should correctly parse upload source config", () => {
      const uploadConfig = {
        sourceType: "upload",
        uploadId: TEST_UPLOAD_ID,
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      };
      const result = sourceJobConfigSchema.safeParse(uploadConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sourceType).toBe("upload");
      }
    });

    it("should reject invalid sourceType", () => {
      const invalidConfig = {
        sourceType: "invalid",
        mode: "single",
      };
      const result = sourceJobConfigSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("webSourceRunStartJobSchema", () => {
    it("should accept valid payload", () => {
      const payload: WebSourceRunStartJobPayload = {
        tenantId: TEST_TENANT_ID,
        sourceId: TEST_SOURCE_ID,
        runId: TEST_RUN_ID,
      };
      const result = webSourceRunStartJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept payload with optional sourceConfig", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        sourceId: TEST_SOURCE_ID,
        runId: TEST_RUN_ID,
        sourceConfig: {
          sourceType: "web",
          mode: "domain",
          fetchMode: "headless",
        },
      };
      const result = webSourceRunStartJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should reject invalid tenant ID", () => {
      const payload = {
        tenantId: "not-a-uuid",
        sourceId: TEST_SOURCE_ID,
        runId: TEST_RUN_ID,
      };
      const result = webSourceRunStartJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("webSourceDiscoverJobSchema", () => {
    it("should accept minimal payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
      };
      const result = webSourceDiscoverJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept payload with crawlConfig", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        crawlConfig: {
          mode: "sitemap",
          url: "https://example.com/sitemap.xml",
          depth: 5,
          includePatterns: ["/docs/*"],
          excludePatterns: ["/admin/*"],
          includeSubdomains: true,
        },
      };
      const result = webSourceDiscoverJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("pageFetchJobSchema", () => {
    it("should accept valid payload", () => {
      const payload: PageFetchJobPayload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com/page",
        fetchMode: "auto",
      };
      const result = pageFetchJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept payload with depth and parentUrl", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com/page",
        fetchMode: "html",
        depth: 2,
        parentUrl: "https://example.com/",
      };
      const result = pageFetchJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should reject invalid URL", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "not-a-url",
        fetchMode: "auto",
      };
      const result = pageFetchJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("should reject negative depth", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com/page",
        fetchMode: "auto",
        depth: -1,
      };
      const result = pageFetchJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("uploadSourceRunStartJobSchema", () => {
    it("should accept valid payload", () => {
      const payload: UploadSourceRunStartJobPayload = {
        tenantId: TEST_TENANT_ID,
        sourceId: TEST_SOURCE_ID,
        runId: TEST_RUN_ID,
        uploadConfig: {
          sourceType: "upload",
          uploadId: TEST_UPLOAD_ID,
          filename: "document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1024,
        },
      };
      const result = uploadSourceRunStartJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should require uploadConfig", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        sourceId: TEST_SOURCE_ID,
        runId: TEST_RUN_ID,
      };
      const result = uploadSourceRunStartJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("pageProcessJobSchema", () => {
    it("should accept web source payload", () => {
      const payload: PageProcessJobPayload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com/page",
        content: "<html><body>Content</body></html>",
        title: "Page Title",
        sourceType: "web",
        depth: 1,
      };
      const result = pageProcessJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept upload source payload", () => {
      const payload: PageProcessJobPayload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: `upload://${TEST_UPLOAD_ID}/document.pdf`,
        content: "Extracted document text content",
        title: "document.pdf",
        sourceType: "upload",
        uploadMetadata: {
          uploadId: TEST_UPLOAD_ID,
          filename: "document.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
        },
      };
      const result = pageProcessJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept null title", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com/page",
        content: "<html></html>",
        title: null,
      };
      const result = pageProcessJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept upload:// URL scheme", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: `upload://${TEST_UPLOAD_ID}/file.txt`,
        content: "File content",
        title: "file.txt",
      };
      const result = pageProcessJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("pageIndexJobSchema", () => {
    it("should accept valid payload", () => {
      const payload: PageIndexJobPayload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        pageId: TEST_PAGE_ID,
        contentId: TEST_CONTENT_ID,
      };
      const result = pageIndexJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should reject missing contentId", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        pageId: TEST_PAGE_ID,
      };
      const result = pageIndexJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("embedChunksBatchJobSchema", () => {
    it("should accept valid payload", () => {
      const payload: EmbedChunksBatchJobPayload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [TEST_CHUNK_ID],
      };
      const result = embedChunksBatchJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept payload with runId and embeddingConfig", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [TEST_CHUNK_ID],
        runId: TEST_RUN_ID,
        embeddingConfig: {
          modelId: "text-embedding-3-small",
          dimensions: 1536,
        },
      };
      const result = embedChunksBatchJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should reject empty chunkIds array", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [],
      };
      const result = embedChunksBatchJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("should reject invalid chunk ID format", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: ["not-a-uuid"],
      };
      const result = embedChunksBatchJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("enrichPageJobSchema", () => {
    it("should accept valid payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [TEST_CHUNK_ID],
      };
      const result = enrichPageJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept payload with sourceType", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [TEST_CHUNK_ID],
        sourceType: "upload",
      };
      const result = enrichPageJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("sourceRunFinalizeJobSchema", () => {
    it("should accept valid payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
      };
      const result = sourceRunFinalizeJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept payload with sourceType", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        sourceType: "web",
      };
      const result = sourceRunFinalizeJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("hardDeleteObjectJobSchema", () => {
    it("should accept valid payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        objectType: "kb",
        objectId: TEST_KB_ID,
      };
      const result = hardDeleteObjectJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should apply default cascade value", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        objectType: "source",
        objectId: TEST_SOURCE_ID,
      };
      const result = hardDeleteObjectJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cascade).toBe(true);
      }
    });

    it("should accept all valid objectTypes", () => {
      const objectTypes = ["kb", "source", "agent", "tenant"] as const;
      for (const objectType of objectTypes) {
        const result = hardDeleteObjectJobSchema.safeParse({
          tenantId: TEST_TENANT_ID,
          objectType,
          objectId: TEST_SOURCE_ID,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("kbReindexJobSchema", () => {
    it("should accept valid payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        newEmbeddingModelId: "text-embedding-3-large",
        newEmbeddingDimensions: 3072,
      };
      const result = kbReindexJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should accept null tenantId for global KBs", () => {
      const payload = {
        tenantId: null,
        kbId: TEST_KB_ID,
        newEmbeddingModelId: "text-embedding-3-small",
        newEmbeddingDimensions: 1536,
      };
      const result = kbReindexJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should apply default deleteOldEmbeddings value", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        newEmbeddingModelId: "text-embedding-3-small",
        newEmbeddingDimensions: 1536,
      };
      const result = kbReindexJobSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.deleteOldEmbeddings).toBe(true);
      }
    });

    it("should reject non-positive dimensions", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        newEmbeddingModelId: "text-embedding-3-small",
        newEmbeddingDimensions: 0,
      };
      const result = kbReindexJobSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("validateJobPayload helper", () => {
    it("should return validated data for valid payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
      };
      const result = validateJobPayload(sourceRunFinalizeJobSchema, payload);
      expect(result.tenantId).toBe(TEST_TENANT_ID);
      expect(result.runId).toBe(TEST_RUN_ID);
    });

    it("should throw for invalid payload", () => {
      const payload = {
        tenantId: "not-a-uuid",
        runId: TEST_RUN_ID,
      };
      expect(() => validateJobPayload(sourceRunFinalizeJobSchema, payload)).toThrow();
    });
  });

  describe("safeValidateJobPayload helper", () => {
    it("should return success result for valid payload", () => {
      const payload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
      };
      const result = safeValidateJobPayload(sourceRunFinalizeJobSchema, payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tenantId).toBe(TEST_TENANT_ID);
      }
    });

    it("should return error result for invalid payload", () => {
      const payload = {
        tenantId: "not-a-uuid",
        runId: TEST_RUN_ID,
      };
      const result = safeValidateJobPayload(sourceRunFinalizeJobSchema, payload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe("isWebSourcePayload type guard", () => {
    it("should return true for web source config", () => {
      const config: WebSourceJobConfig = {
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
        depth: 3,
        includePatterns: [],
        excludePatterns: [],
        includeSubdomains: false,
        respectRobotsTxt: true,
      };
      expect(isWebSourcePayload(config)).toBe(true);
    });

    it("should return false for upload source config", () => {
      const config: UploadSourceJobConfig = {
        sourceType: "upload",
        uploadId: TEST_UPLOAD_ID,
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      };
      expect(isWebSourcePayload(config)).toBe(false);
    });
  });

  describe("isUploadSourcePayload type guard", () => {
    it("should return true for upload source config", () => {
      const config: UploadSourceJobConfig = {
        sourceType: "upload",
        uploadId: TEST_UPLOAD_ID,
        filename: "document.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
      };
      expect(isUploadSourcePayload(config)).toBe(true);
    });

    it("should return false for web source config", () => {
      const config: WebSourceJobConfig = {
        sourceType: "web",
        mode: "single",
        fetchMode: "auto",
        depth: 3,
        includePatterns: [],
        excludePatterns: [],
        includeSubdomains: false,
        respectRobotsTxt: true,
      };
      expect(isUploadSourcePayload(config)).toBe(false);
    });
  });

  describe("Type Compatibility", () => {
    it("should allow SourceRunJobPayload union assignment", () => {
      const webStartPayload: WebSourceRunStartJobPayload = {
        tenantId: TEST_TENANT_ID,
        sourceId: TEST_SOURCE_ID,
        runId: TEST_RUN_ID,
      };
      const _sourceRunJob: SourceRunJobPayload = webStartPayload;
      expect(_sourceRunJob).toBeDefined();
    });

    it("should allow IngestionJobPayload union assignment", () => {
      const pageFetchPayload: PageFetchJobPayload = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com",
        fetchMode: "auto",
      };
      const _ingestionJob: IngestionJobPayload = pageFetchPayload;
      expect(_ingestionJob).toBeDefined();
    });

    it("should allow AnyJobPayload union assignment", () => {
      const embedPayload: EmbedChunksBatchJobPayload = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [TEST_CHUNK_ID],
      };
      const _anyJob: AnyJobPayload = embedPayload;
      expect(_anyJob).toBeDefined();
    });
  });

  describe("Backwards Compatibility", () => {
    it("should accept legacy-style payloads without new optional fields", () => {
      // Test that existing code patterns still work
      const legacyPageProcess = {
        tenantId: TEST_TENANT_ID,
        runId: TEST_RUN_ID,
        url: "https://example.com",
        content: "<html></html>",
        title: "Test",
        // No sourceType or uploadMetadata
      };
      const result = pageProcessJobSchema.safeParse(legacyPageProcess);
      expect(result.success).toBe(true);
    });

    it("should accept legacy-style embed job without embeddingConfig", () => {
      const legacyEmbed = {
        tenantId: TEST_TENANT_ID,
        kbId: TEST_KB_ID,
        chunkIds: [TEST_CHUNK_ID],
        runId: TEST_RUN_ID,
        // No embeddingConfig
      };
      const result = embedChunksBatchJobSchema.safeParse(legacyEmbed);
      expect(result.success).toBe(true);
    });
  });
});
