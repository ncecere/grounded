import { describe, expect, it } from "bun:test";
import {
  getCheckBadges,
  getLastResultBadge,
  getLastResultTimestampLabel,
} from "./TestCaseCard";
import type { ExpectedBehavior, TestCase, TestCaseResultSummary } from "@/lib/api";

const baseBehavior: ExpectedBehavior = {
  mode: "all",
  checks: [],
};

const createTestCase = (overrides: Partial<TestCase> = {}): TestCase => ({
  id: "case-1",
  suiteId: "suite-1",
  name: "Refund policy",
  description: null,
  question: "What is the refund policy?",
  expectedBehavior: baseBehavior,
  sortOrder: 0,
  isEnabled: true,
  lastResult: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const createResult = (overrides: Partial<TestCaseResultSummary> = {}): TestCaseResultSummary => ({
  status: "passed",
  runId: "run-1",
  createdAt: "2026-01-05T10:00:00Z",
  ...overrides,
});

describe("TestCaseCard module exports", () => {
  it("should export TestCaseCard component", async () => {
    const module = await import("./TestCaseCard");
    expect(module.TestCaseCard).toBeDefined();
  });
});

describe("getCheckBadges", () => {
  it("should return a fallback badge when no checks exist", () => {
    const badges = getCheckBadges(baseBehavior);
    expect(badges[0]?.label).toBe("No checks");
  });

  it("should summarize multiple checks by type", () => {
    const badges = getCheckBadges({
      mode: "all",
      checks: [
        { type: "contains_phrases", phrases: ["refund"] },
        { type: "contains_phrases", phrases: ["policy"] },
        { type: "llm_judge", expectedAnswer: "Answer" },
      ],
    });

    expect(badges.some((badge) => badge.label === "Contains x2")).toBe(true);
    expect(badges.some((badge) => badge.label === "LLM Judge")).toBe(true);
  });
});

describe("getLastResultBadge", () => {
  it("should return default badge for missing results", () => {
    const badge = getLastResultBadge(null);
    expect(badge.status).toBe("default");
    expect(badge.label).toBe("No results");
  });

  it("should map passed results to success", () => {
    const badge = getLastResultBadge(createResult({ status: "passed" }));
    expect(badge.status).toBe("success");
    expect(badge.label).toBe("Passed");
  });
});

describe("getLastResultTimestampLabel", () => {
  it("should return a fallback when no result exists", () => {
    expect(getLastResultTimestampLabel(null)).toBe("Never run");
  });

  it("should format the last run date", () => {
    const label = getLastResultTimestampLabel(createResult());
    expect(label).toBe("Last run 1/5/2026");
  });
});

describe("TestCaseCard sample data", () => {
  it("should allow overriding test case defaults", () => {
    const testCase = createTestCase({ name: "Updated" });
    expect(testCase.name).toBe("Updated");
  });
});
