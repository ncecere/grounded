import { describe, expect, it } from "bun:test";
import { expectedBehaviorSchema } from "../services/test-suite-import";
import { createTestCaseSchema, updateTestCaseSchema } from "../modules/test-suites/schema";

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
