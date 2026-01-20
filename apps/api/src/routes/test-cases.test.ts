import { describe, expect, it } from "bun:test";
import { z } from "zod";

// ==========================================================================
// Schema Definitions (duplicated from test-suites.ts for isolated testing)
// ==========================================================================

const expectedBehaviorSchema = z.object({
  checks: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("contains_phrases"),
          phrases: z.array(z.string().min(1)).min(1),
          caseSensitive: z.boolean().optional(),
        }),
        z.object({
          type: z.literal("semantic_similarity"),
          expectedAnswer: z.string().min(1),
          threshold: z.number().min(0).max(1),
        }),
        z.object({
          type: z.literal("llm_judge"),
          expectedAnswer: z.string().min(1),
          criteria: z.string().optional(),
        }),
      ])
    )
    .min(1),
  mode: z.enum(["all", "any"]),
});

const createTestCaseSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  question: z.string().min(1).max(4000),
  expectedBehavior: expectedBehaviorSchema,
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().default(true),
});

const updateTestCaseSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  question: z.string().min(1).max(4000).optional(),
  expectedBehavior: expectedBehaviorSchema.optional(),
  sortOrder: z.number().int().min(0).optional(),
  isEnabled: z.boolean().optional(),
});

// ==========================================================================
// Expected Behavior Schema
// ==========================================================================

describe("expectedBehaviorSchema", () => {
  it("accepts contains phrases checks", () => {
    const result = expectedBehaviorSchema.parse({
      mode: "all",
      checks: [{ type: "contains_phrases", phrases: ["hello", "world"], caseSensitive: true }],
    });

    expect(result.checks[0].type).toBe("contains_phrases");
  });

  it("accepts semantic similarity checks", () => {
    const result = expectedBehaviorSchema.parse({
      mode: "any",
      checks: [{ type: "semantic_similarity", expectedAnswer: "Hello", threshold: 0.7 }],
    });

    expect(result.checks[0].type).toBe("semantic_similarity");
  });

  it("accepts llm judge checks with criteria", () => {
    const result = expectedBehaviorSchema.parse({
      mode: "all",
      checks: [
        { type: "llm_judge", expectedAnswer: "Answer", criteria: "Must mention key points" },
      ],
    });

    expect(result.checks[0].type).toBe("llm_judge");
  });

  it("rejects empty checks", () => {
    expect(() => expectedBehaviorSchema.parse({ mode: "all", checks: [] })).toThrow();
  });

  it("rejects invalid semantic similarity thresholds", () => {
    expect(() =>
      expectedBehaviorSchema.parse({
        mode: "all",
        checks: [{ type: "semantic_similarity", expectedAnswer: "Answer", threshold: 1.2 }],
      })
    ).toThrow();
  });
});

// ==========================================================================
// Test Case Schemas
// ==========================================================================

describe("createTestCaseSchema", () => {
  it("defaults isEnabled to true", () => {
    const result = createTestCaseSchema.parse({
      name: "Case",
      question: "Question",
      expectedBehavior: {
        mode: "all",
        checks: [{ type: "contains_phrases", phrases: ["hello"] }],
      },
    });

    expect(result.isEnabled).toBe(true);
  });
});

describe("updateTestCaseSchema", () => {
  it("allows clearing description with null", () => {
    const result = updateTestCaseSchema.parse({ description: null });
    expect(result.description).toBeNull();
  });
});
