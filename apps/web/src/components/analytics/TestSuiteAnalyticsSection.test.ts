import { describe, expect, it } from "bun:test";
import {
  TestSuiteAnalyticsSection,
  formatOverallPassRate,
  getOverallPassRateColor,
  isTestSuiteAnalyticsEmpty,
  toAgentTestHealthRows,
  toRecentRegressionRows,
  type TestSuiteAnalyticsResponse,
} from "./TestSuiteAnalyticsSection";

describe("TestSuiteAnalyticsSection module", () => {
  it("should export TestSuiteAnalyticsSection component", () => {
    expect(TestSuiteAnalyticsSection).toBeDefined();
  });
});

describe("isTestSuiteAnalyticsEmpty", () => {
  it("should treat missing or zero-suite data as empty", () => {
    const empty: TestSuiteAnalyticsResponse = {
      summary: { totalSuites: 0, totalCases: 0, totalRuns: 0, overallPassRate: 0 },
      passRateOverTime: [],
      agents: [],
      recentRegressions: [],
    };

    expect(isTestSuiteAnalyticsEmpty()).toBe(true);
    expect(isTestSuiteAnalyticsEmpty(empty)).toBe(true);

    const populated = {
      ...empty,
      summary: { ...empty.summary, totalSuites: 2, totalCases: 4 },
    };

    expect(isTestSuiteAnalyticsEmpty(populated)).toBe(false);
  });
});

describe("formatOverallPassRate", () => {
  it("should clamp values and format percentages", () => {
    expect(formatOverallPassRate(88.6)).toBe("89%");
    expect(formatOverallPassRate(120)).toBe("100%");
    expect(formatOverallPassRate(-5)).toBe("0%");
  });
});

describe("getOverallPassRateColor", () => {
  it("should return muted when no runs", () => {
    expect(getOverallPassRateColor(90, false)).toBe("muted");
  });

  it("should select severity colors based on pass rate", () => {
    expect(getOverallPassRateColor(82, true)).toBe("green");
    expect(getOverallPassRateColor(65, true)).toBe("warning");
    expect(getOverallPassRateColor(42, true)).toBe("destructive");
  });
});

describe("toAgentTestHealthRows", () => {
  it("should map agent analytics rows", () => {
    const rows = toAgentTestHealthRows([
      {
        agentId: "agent-1",
        agentName: "Alpha",
        suiteCount: 2,
        caseCount: 8,
        runCount: 4,
        passRate: 86,
        previousPassRate: 88,
        passRateChange: -2,
      },
    ]);

    expect(rows[0].agentName).toBe("Alpha");
    expect(rows[0].passRateChange).toBe(-2);
    expect(rows[0].lastRunAt).toBeNull();
  });
});

describe("toRecentRegressionRows", () => {
  it("should map regression entries with fallbacks", () => {
    const rows = toRecentRegressionRows([
      {
        runId: "run-1",
        suiteId: "suite-1",
        suiteName: "Billing",
        agentId: null,
        agentName: "Support",
        completedAt: "2026-01-20T10:00:00Z",
        previousPassRate: 90,
        currentPassRate: 60,
        passRateDrop: 30,
      },
    ]);

    expect(rows[0].failedAt).toBe("2026-01-20T10:00:00Z");
    expect(rows[0].agentId).toBe("unknown-agent");
  });
});
