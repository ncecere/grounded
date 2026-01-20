import {
  formatCheckResultDetail,
  formatCheckResultSummary,
  getCheckResultLabel,
} from "./CheckResultDisplay";
import type { CheckResult } from "@/lib/api";

const createCheck = (overrides: Partial<CheckResult> = {}): CheckResult => ({
  checkIndex: 0,
  checkType: "contains_phrases",
  passed: true,
  details: {
    matchedPhrases: ["refund"],
    missingPhrases: [],
  },
  ...overrides,
});

describe("CheckResultDisplay module exports", () => {
  it("should export CheckResultDisplay component", async () => {
    const module = await import("./CheckResultDisplay");
    expect(module.CheckResultDisplay).toBeDefined();
  });
});

describe("getCheckResultLabel", () => {
  it("should label contains phrase checks", () => {
    expect(getCheckResultLabel(createCheck())).toBe("Contains phrases");
  });
});

describe("formatCheckResultSummary", () => {
  it("should summarize phrase matches", () => {
    const summary = formatCheckResultSummary(
      createCheck({ details: { matchedPhrases: ["refund"], missingPhrases: ["policy"] } })
    );
    expect(summary).toBe("1/2 phrases matched");
  });

  it("should summarize semantic similarity", () => {
    const summary = formatCheckResultSummary(
      createCheck({
        checkType: "semantic_similarity",
        details: { similarityScore: 0.82, threshold: 0.75 },
      })
    );
    expect(summary).toBe("Similarity 82% · Threshold 75%");
  });

  it("should summarize llm judge results", () => {
    const summary = formatCheckResultSummary(
      createCheck({
        checkType: "llm_judge",
        details: { judgement: "acceptable" },
      })
    );
    expect(summary).toBe("Judgement: acceptable");
  });
});

describe("formatCheckResultDetail", () => {
  it("should list missing phrases", () => {
    const detail = formatCheckResultDetail(
      createCheck({ details: { matchedPhrases: [], missingPhrases: ["refund", "policy"] } })
    );
    expect(detail).toBe("Missing: refund, policy");
  });

  it("should return reasoning for llm judge", () => {
    const detail = formatCheckResultDetail(
      createCheck({ checkType: "llm_judge", details: { reasoning: "Clear answer." } })
    );
    expect(detail).toBe("Clear answer.");
  });
});
