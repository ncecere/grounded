import { describe, expect, it, mock } from "bun:test";

const embeddings = await import("@grounded/embeddings");
const embeddingMap = new Map<string, number[]>();
const generateEmbeddingMock = mock(async (text: string) => ({
  embedding: embeddingMap.get(text) ?? [0, 1],
}));

const judgeResponses: string[] = [];
const generateTextMock = mock(async () => ({
  text: judgeResponses.shift() ?? "",
}));

mock.module("@grounded/embeddings", () => ({
  ...embeddings,
  generateEmbedding: generateEmbeddingMock,
}));

mock.module("ai", () => ({
  generateText: generateTextMock,
}));

const {
  evaluateContainsPhrases,
  evaluateSemanticSimilarity,
  evaluateLlmJudge,
  evaluateResponse,
} = await import("./test-runner");

describe("test-runner evaluations", () => {
  it("evaluates contains phrases with case-insensitive matching", async () => {
    const result = await evaluateContainsPhrases("Hello World", {
      type: "contains_phrases",
      phrases: ["hello", "world"],
    });

    expect(result.passed).toBe(true);
    expect(result.details).toEqual({
      matchedPhrases: ["hello", "world"],
      missingPhrases: [],
    });
  });

  it("tracks missing phrases when case sensitive", async () => {
    const result = await evaluateContainsPhrases("Hello World", {
      type: "contains_phrases",
      phrases: ["hello"],
      caseSensitive: true,
    });

    expect(result.passed).toBe(false);
    expect(result.details).toEqual({
      matchedPhrases: [],
      missingPhrases: ["hello"],
    });
  });

  it("evaluates semantic similarity against the threshold", async () => {
    embeddingMap.set("response", [1, 0]);
    embeddingMap.set("expected", [1, 0]);

    const result = await evaluateSemanticSimilarity(
      "response",
      {
        type: "semantic_similarity",
        expectedAnswer: "expected",
        threshold: 0.8,
      },
      "model-1"
    );

    expect(result.passed).toBe(true);
    expect(result.details.threshold).toBe(0.8);
    expect(result.details.similarityScore).toBeCloseTo(1);
  });

  it("parses LLM judge output into pass/fail details", async () => {
    judgeResponses.push('{"passed": true, "reasoning": "Matches"}');

    const result = await evaluateLlmJudge(
      "Question",
      "Answer",
      {
        type: "llm_judge",
        expectedAnswer: "Expected",
        criteria: "Must mention X",
      },
      {} as any
    );

    expect(result.passed).toBe(true);
    expect(result.details).toEqual({ judgement: "pass", reasoning: "Matches" });
  });

  it("handles invalid judge JSON responses", async () => {
    judgeResponses.push("not-json");

    const result = await evaluateLlmJudge(
      "Question",
      "Answer",
      {
        type: "llm_judge",
        expectedAnswer: "Expected",
      },
      {} as any
    );

    expect(result.passed).toBe(false);
    expect(result.details).toEqual({
      judgement: "error",
      reasoning: "Invalid JSON response from judge model",
    });
  });

  it("evaluates response using all/any modes", async () => {
    const allResult = await evaluateResponse(
      "Question",
      "Hello World",
      {
        mode: "all",
        checks: [
          { type: "contains_phrases", phrases: ["hello"] },
          { type: "contains_phrases", phrases: ["missing"] },
        ],
      },
      { embeddingModelId: null, llmModel: null }
    );

    const anyResult = await evaluateResponse(
      "Question",
      "Hello World",
      {
        mode: "any",
        checks: [
          { type: "contains_phrases", phrases: ["hello"] },
          { type: "contains_phrases", phrases: ["missing"] },
        ],
      },
      { embeddingModelId: null, llmModel: null }
    );

    expect(allResult.passed).toBe(false);
    expect(anyResult.passed).toBe(true);
  });
});
