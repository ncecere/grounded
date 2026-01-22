import { describe, expect, it } from "bun:test";
import {
  createSourceWithKbIdSchema,
  updateSourceSchema,
  triggerRunSchema,
} from "../modules/sources/schema";

// ============================================================================
// Tests for createSourceWithKbIdSchema
// ============================================================================

describe("createSourceWithKbIdSchema", () => {
  const baseConfig = {
    mode: "single" as const,
    url: "https://example.com/docs",
  };

  it("should accept a valid payload with defaults", () => {
    const result = createSourceWithKbIdSchema.parse({
      name: "Docs",
      type: "web",
      kbId: "550e8400-e29b-41d4-a716-446655440000",
      config: baseConfig,
    });

    expect(result.enrichmentEnabled).toBe(false);
    expect(result.config.depth).toBe(3);
    expect(result.config.includePatterns).toEqual([]);
    expect(result.config.excludePatterns).toEqual([]);
    expect(result.config.includeSubdomains).toBe(false);
    expect(result.config.schedule).toBeNull();
    expect(result.config.firecrawlEnabled).toBe(false);
    expect(result.config.respectRobotsTxt).toBe(true);
  });

  it("should reject missing kbId", () => {
    expect(() =>
      createSourceWithKbIdSchema.parse({
        name: "Docs",
        type: "web",
        config: baseConfig,
      })
    ).toThrow();
  });

  it("should reject invalid kbId format", () => {
    expect(() =>
      createSourceWithKbIdSchema.parse({
        name: "Docs",
        type: "web",
        kbId: "not-a-uuid",
        config: baseConfig,
      })
    ).toThrow();
  });

  it("should reject empty name", () => {
    expect(() =>
      createSourceWithKbIdSchema.parse({
        name: "",
        type: "web",
        kbId: "550e8400-e29b-41d4-a716-446655440000",
        config: baseConfig,
      })
    ).toThrow();
  });

  it("should reject invalid config urls", () => {
    expect(() =>
      createSourceWithKbIdSchema.parse({
        name: "Docs",
        type: "web",
        kbId: "550e8400-e29b-41d4-a716-446655440000",
        config: {
          mode: "single",
          url: "not-a-url",
        },
      })
    ).toThrow();
  });
});

// ============================================================================
// Tests for updateSourceSchema
// ============================================================================

describe("updateSourceSchema", () => {
  it("should allow partial updates", () => {
    const result = updateSourceSchema.parse({
      name: "Updated Source",
    });

    expect(result.name).toBe("Updated Source");
    expect(result.config).toBeUndefined();
  });

  it("should allow partial config updates", () => {
    const result = updateSourceSchema.parse({
      config: {
        depth: 5,
      },
    });

    expect(result.config?.depth).toBe(5);
  });

  it("should reject invalid config values", () => {
    expect(() =>
      updateSourceSchema.parse({
        config: {
          depth: 0,
        },
      })
    ).toThrow();
  });
});

// ============================================================================
// Tests for triggerRunSchema
// ============================================================================

describe("triggerRunSchema", () => {
  it("should default forceReindex to false", () => {
    const result = triggerRunSchema.parse({});
    expect(result.forceReindex).toBe(false);
  });

  it("should accept forceReindex true", () => {
    const result = triggerRunSchema.parse({ forceReindex: true });
    expect(result.forceReindex).toBe(true);
  });

  it("should reject non-boolean forceReindex", () => {
    expect(() => triggerRunSchema.parse({ forceReindex: "yes" })).toThrow();
  });
});
