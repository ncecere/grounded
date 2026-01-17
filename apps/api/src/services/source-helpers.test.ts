import { describe, it, expect } from "bun:test";
import {
  createSourceBaseSchema,
  createSourceWithKbIdSchema,
  updateSourceSchema,
  triggerRunSchema,
  buildSourceUpdateData,
} from "./source-helpers";

// Valid source config using the actual schema structure
const validConfig = {
  mode: "sitemap" as const,
  url: "https://example.com",
  depth: 3,
  excludePatterns: [],
  includePatterns: [],
};

describe("source-helpers", () => {
  describe("createSourceBaseSchema", () => {
    it("should validate a valid source creation payload", () => {
      const validPayload = {
        name: "Test Source",
        type: "web" as const,
        config: validConfig,
        enrichmentEnabled: false,
      };

      const result = createSourceBaseSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject empty name", () => {
      const invalidPayload = {
        name: "",
        type: "web",
        config: validConfig,
      };

      const result = createSourceBaseSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject name over 100 characters", () => {
      const invalidPayload = {
        name: "a".repeat(101),
        type: "web",
        config: validConfig,
      };

      const result = createSourceBaseSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should reject invalid type", () => {
      const invalidPayload = {
        name: "Test Source",
        type: "invalid",
        config: validConfig,
      };

      const result = createSourceBaseSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });

    it("should default enrichmentEnabled to false", () => {
      const payload = {
        name: "Test Source",
        type: "web" as const,
        config: validConfig,
      };

      const result = createSourceBaseSchema.parse(payload);
      expect(result.enrichmentEnabled).toBe(false);
    });
  });

  describe("createSourceWithKbIdSchema", () => {
    it("should require kbId", () => {
      const payloadWithoutKbId = {
        name: "Test Source",
        type: "web",
        config: validConfig,
      };

      const result = createSourceWithKbIdSchema.safeParse(payloadWithoutKbId);
      expect(result.success).toBe(false);
    });

    it("should validate a valid payload with kbId", () => {
      const validPayload = {
        kbId: "123e4567-e89b-12d3-a456-426614174000",
        name: "Test Source",
        type: "web" as const,
        config: validConfig,
      };

      const result = createSourceWithKbIdSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("should reject invalid UUID for kbId", () => {
      const invalidPayload = {
        kbId: "not-a-uuid",
        name: "Test Source",
        type: "web",
        config: validConfig,
      };

      const result = createSourceWithKbIdSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
    });
  });

  describe("updateSourceSchema", () => {
    it("should allow all fields to be optional", () => {
      const result = updateSourceSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should validate name when provided", () => {
      const result = updateSourceSchema.safeParse({ name: "Updated Name" });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Updated Name");
    });

    it("should validate enrichmentEnabled when provided", () => {
      const result = updateSourceSchema.safeParse({ enrichmentEnabled: true });
      expect(result.success).toBe(true);
      expect(result.data?.enrichmentEnabled).toBe(true);
    });

    it("should validate partial config when provided", () => {
      const result = updateSourceSchema.safeParse({
        config: { depth: 5 },
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty name when provided", () => {
      const result = updateSourceSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("triggerRunSchema", () => {
    it("should default forceReindex to false", () => {
      const result = triggerRunSchema.parse({});
      expect(result.forceReindex).toBe(false);
    });

    it("should accept forceReindex true", () => {
      const result = triggerRunSchema.parse({ forceReindex: true });
      expect(result.forceReindex).toBe(true);
    });

    it("should accept forceReindex false", () => {
      const result = triggerRunSchema.parse({ forceReindex: false });
      expect(result.forceReindex).toBe(false);
    });
  });

  describe("buildSourceUpdateData", () => {
    // Using a partial representation that matches the function's usage
    const existingConfig = {
      mode: "sitemap" as const,
      url: "https://example.com",
      depth: 3,
      excludePatterns: ["/admin"],
      includePatterns: [] as string[],
      includeSubdomains: false,
      schedule: null,
      firecrawlEnabled: false,
      respectRobotsTxt: true,
    };

    it("should return empty object when no updates provided", () => {
      const result = buildSourceUpdateData(existingConfig, {});
      expect(result).toEqual({});
    });

    it("should include name when provided", () => {
      const result = buildSourceUpdateData(existingConfig, {
        name: "New Name",
      });
      expect(result.name).toBe("New Name");
    });

    it("should include enrichmentEnabled when provided", () => {
      const result = buildSourceUpdateData(existingConfig, {
        enrichmentEnabled: true,
      });
      expect(result.enrichmentEnabled).toBe(true);
    });

    it("should handle enrichmentEnabled false explicitly", () => {
      const result = buildSourceUpdateData(existingConfig, {
        enrichmentEnabled: false,
      });
      expect(result.enrichmentEnabled).toBe(false);
    });

    it("should merge config with existing config", () => {
      const result = buildSourceUpdateData(existingConfig, {
        config: { depth: 5 },
      });
      expect(result.config).toEqual({
        ...existingConfig,
        depth: 5,
      });
    });

    it("should preserve existing config values when merging", () => {
      const result = buildSourceUpdateData(existingConfig, {
        config: { depth: 10 },
      });
      const mergedConfig = result.config as typeof existingConfig;
      expect(mergedConfig.url).toBe("https://example.com");
      expect(mergedConfig.mode).toBe("sitemap");
      expect(mergedConfig.depth).toBe(10);
      expect(mergedConfig.excludePatterns).toEqual(["/admin"]);
    });

    it("should handle multiple updates at once", () => {
      const result = buildSourceUpdateData(existingConfig, {
        name: "Updated Source",
        enrichmentEnabled: true,
        config: { depth: 10 },
      });
      expect(result.name).toBe("Updated Source");
      expect(result.enrichmentEnabled).toBe(true);
      expect((result.config as typeof existingConfig).depth).toBe(10);
    });
  });
});
