import { describe, it, expect } from "bun:test";
import { z } from "zod";

// ============================================================================
// Schema Definitions (duplicated from agents.ts for isolated testing)
// ============================================================================

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().default(true),
  citationsEnabled: z.boolean().default(true),
  ragType: z.enum(["simple", "advanced"]).default("simple"),
  kbIds: z.array(z.string().uuid()).optional(),
  llmModelConfigId: z.string().uuid().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  welcomeMessage: z.string().max(200).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  systemPrompt: z.string().max(4000).optional(),
  rerankerEnabled: z.boolean().optional(),
  citationsEnabled: z.boolean().optional(),
  ragType: z.enum(["simple", "advanced"]).optional(),
  isEnabled: z.boolean().optional(),
  llmModelConfigId: z.string().uuid().nullable().optional(),
  kbIds: z.array(z.string().uuid()).optional(),
});

const updateRetrievalConfigSchema = z.object({
  topK: z.number().int().min(1).max(50).optional(),
  candidateK: z.number().int().min(1).max(200).optional(),
  maxCitations: z.number().int().min(1).max(20).optional(),
  rerankerEnabled: z.boolean().optional(),
  rerankerType: z.enum(["heuristic", "cross_encoder"]).optional(),
  similarityThreshold: z.number().min(0).max(1).optional(),
  historyTurns: z.number().int().min(1).max(20).optional(),
  advancedMaxSubqueries: z.number().int().min(1).max(5).optional(),
});

// ============================================================================
// Tests for createAgentSchema
// ============================================================================

describe("createAgentSchema", () => {
  describe("ragType field", () => {
    it("should default ragType to 'simple' when not provided", () => {
      const result = createAgentSchema.parse({ name: "Test Agent" });
      expect(result.ragType).toBe("simple");
    });

    it("should accept 'simple' as ragType", () => {
      const result = createAgentSchema.parse({ name: "Test Agent", ragType: "simple" });
      expect(result.ragType).toBe("simple");
    });

    it("should accept 'advanced' as ragType", () => {
      const result = createAgentSchema.parse({ name: "Test Agent", ragType: "advanced" });
      expect(result.ragType).toBe("advanced");
    });

    it("should reject invalid ragType values", () => {
      expect(() =>
        createAgentSchema.parse({ name: "Test Agent", ragType: "invalid" })
      ).toThrow();
    });

    it("should reject non-string ragType values", () => {
      expect(() =>
        createAgentSchema.parse({ name: "Test Agent", ragType: 123 })
      ).toThrow();
    });
  });

  describe("other fields with defaults", () => {
    it("should set rerankerEnabled to true by default", () => {
      const result = createAgentSchema.parse({ name: "Test Agent" });
      expect(result.rerankerEnabled).toBe(true);
    });

    it("should set citationsEnabled to true by default", () => {
      const result = createAgentSchema.parse({ name: "Test Agent" });
      expect(result.citationsEnabled).toBe(true);
    });
  });

  describe("name field validation", () => {
    it("should reject empty name", () => {
      expect(() => createAgentSchema.parse({ name: "" })).toThrow();
    });

    it("should reject name longer than 100 characters", () => {
      expect(() =>
        createAgentSchema.parse({ name: "a".repeat(101) })
      ).toThrow();
    });

    it("should accept name at max length (100 characters)", () => {
      const result = createAgentSchema.parse({ name: "a".repeat(100) });
      expect(result.name.length).toBe(100);
    });
  });
});

// ============================================================================
// Tests for updateAgentSchema
// ============================================================================

describe("updateAgentSchema", () => {
  describe("ragType field", () => {
    it("should accept 'simple' as ragType", () => {
      const result = updateAgentSchema.parse({ ragType: "simple" });
      expect(result.ragType).toBe("simple");
    });

    it("should accept 'advanced' as ragType", () => {
      const result = updateAgentSchema.parse({ ragType: "advanced" });
      expect(result.ragType).toBe("advanced");
    });

    it("should allow ragType to be omitted", () => {
      const result = updateAgentSchema.parse({ name: "Updated Name" });
      expect(result.ragType).toBeUndefined();
    });

    it("should reject invalid ragType values", () => {
      expect(() => updateAgentSchema.parse({ ragType: "invalid" })).toThrow();
    });
  });

  describe("partial updates", () => {
    it("should allow updating only name", () => {
      const result = updateAgentSchema.parse({ name: "New Name" });
      expect(result.name).toBe("New Name");
      expect(result.description).toBeUndefined();
      expect(result.ragType).toBeUndefined();
    });

    it("should allow updating only ragType", () => {
      const result = updateAgentSchema.parse({ ragType: "advanced" });
      expect(result.ragType).toBe("advanced");
      expect(result.name).toBeUndefined();
    });

    it("should allow empty update (all optional)", () => {
      const result = updateAgentSchema.parse({});
      expect(Object.keys(result).length).toBe(0);
    });
  });
});

// ============================================================================
// Tests for updateRetrievalConfigSchema
// ============================================================================

describe("updateRetrievalConfigSchema", () => {
  describe("historyTurns field", () => {
    it("should accept valid historyTurns values", () => {
      const result = updateRetrievalConfigSchema.parse({ historyTurns: 5 });
      expect(result.historyTurns).toBe(5);
    });

    it("should accept minimum historyTurns (1)", () => {
      const result = updateRetrievalConfigSchema.parse({ historyTurns: 1 });
      expect(result.historyTurns).toBe(1);
    });

    it("should accept maximum historyTurns (20)", () => {
      const result = updateRetrievalConfigSchema.parse({ historyTurns: 20 });
      expect(result.historyTurns).toBe(20);
    });

    it("should reject historyTurns below minimum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ historyTurns: 0 })
      ).toThrow();
    });

    it("should reject historyTurns above maximum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ historyTurns: 21 })
      ).toThrow();
    });

    it("should reject non-integer historyTurns", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ historyTurns: 5.5 })
      ).toThrow();
    });

    it("should allow historyTurns to be omitted", () => {
      const result = updateRetrievalConfigSchema.parse({ topK: 10 });
      expect(result.historyTurns).toBeUndefined();
    });
  });

  describe("advancedMaxSubqueries field", () => {
    it("should accept valid advancedMaxSubqueries values", () => {
      const result = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 3 });
      expect(result.advancedMaxSubqueries).toBe(3);
    });

    it("should accept minimum advancedMaxSubqueries (1)", () => {
      const result = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 1 });
      expect(result.advancedMaxSubqueries).toBe(1);
    });

    it("should accept maximum advancedMaxSubqueries (5)", () => {
      const result = updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 5 });
      expect(result.advancedMaxSubqueries).toBe(5);
    });

    it("should reject advancedMaxSubqueries below minimum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 0 })
      ).toThrow();
    });

    it("should reject advancedMaxSubqueries above maximum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 6 })
      ).toThrow();
    });

    it("should reject non-integer advancedMaxSubqueries", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ advancedMaxSubqueries: 3.5 })
      ).toThrow();
    });

    it("should allow advancedMaxSubqueries to be omitted", () => {
      const result = updateRetrievalConfigSchema.parse({ topK: 10 });
      expect(result.advancedMaxSubqueries).toBeUndefined();
    });
  });

  describe("combined advanced RAG fields", () => {
    it("should accept both historyTurns and advancedMaxSubqueries together", () => {
      const result = updateRetrievalConfigSchema.parse({
        historyTurns: 10,
        advancedMaxSubqueries: 4,
      });
      expect(result.historyTurns).toBe(10);
      expect(result.advancedMaxSubqueries).toBe(4);
    });

    it("should accept advanced RAG fields with other retrieval config fields", () => {
      const result = updateRetrievalConfigSchema.parse({
        topK: 15,
        candidateK: 100,
        historyTurns: 8,
        advancedMaxSubqueries: 2,
        similarityThreshold: 0.7,
      });
      expect(result.topK).toBe(15);
      expect(result.candidateK).toBe(100);
      expect(result.historyTurns).toBe(8);
      expect(result.advancedMaxSubqueries).toBe(2);
      expect(result.similarityThreshold).toBe(0.7);
    });
  });

  describe("existing retrieval config fields", () => {
    it("should accept valid topK", () => {
      const result = updateRetrievalConfigSchema.parse({ topK: 10 });
      expect(result.topK).toBe(10);
    });

    it("should reject topK below minimum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ topK: 0 })
      ).toThrow();
    });

    it("should reject topK above maximum", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ topK: 51 })
      ).toThrow();
    });

    it("should accept valid rerankerType", () => {
      const result = updateRetrievalConfigSchema.parse({ rerankerType: "cross_encoder" });
      expect(result.rerankerType).toBe("cross_encoder");
    });

    it("should reject invalid rerankerType", () => {
      expect(() =>
        updateRetrievalConfigSchema.parse({ rerankerType: "invalid" })
      ).toThrow();
    });
  });
});

// ============================================================================
// Tests for RagType enum behavior
// ============================================================================

describe("RagType enum", () => {
  it("should have exactly two valid values", () => {
    const ragTypeSchema = z.enum(["simple", "advanced"]);

    // Valid values
    expect(() => ragTypeSchema.parse("simple")).not.toThrow();
    expect(() => ragTypeSchema.parse("advanced")).not.toThrow();

    // Invalid values
    expect(() => ragTypeSchema.parse("basic")).toThrow();
    expect(() => ragTypeSchema.parse("complex")).toThrow();
    expect(() => ragTypeSchema.parse("")).toThrow();
  });
});
