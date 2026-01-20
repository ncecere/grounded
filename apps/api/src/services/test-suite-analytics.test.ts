import { describe, expect, it } from "bun:test";
import { buildRegressionEntries, getTrendDirection } from "./test-suite-analytics";

describe("buildRegressionEntries", () => {
  it("returns regressions for runs after startDate", () => {
    const startDate = new Date("2026-01-01T00:00:00.000Z");
    const runs = [
      {
        runId: "run-1",
        suiteId: "suite-1",
        completedAt: new Date("2025-12-31T12:00:00.000Z"),
        passedCases: 9,
        totalCases: 10,
        skippedCases: 0,
      },
      {
        runId: "run-2",
        suiteId: "suite-1",
        completedAt: new Date("2026-01-02T12:00:00.000Z"),
        passedCases: 7,
        totalCases: 10,
        skippedCases: 0,
      },
      {
        runId: "run-3",
        suiteId: "suite-1",
        completedAt: new Date("2026-01-03T12:00:00.000Z"),
        passedCases: 9,
        totalCases: 10,
        skippedCases: 0,
      },
    ];

    const regressions = buildRegressionEntries(runs, startDate);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]?.runId).toBe("run-2");
    expect(regressions[0]?.passRateDrop).toBe(20);
  });
});

describe("getTrendDirection", () => {
  it("returns stable when delta is null", () => {
    expect(getTrendDirection(null)).toBe("stable");
  });

  it("returns up when delta exceeds threshold", () => {
    expect(getTrendDirection(2)).toBe("up");
  });

  it("returns down when delta is negative", () => {
    expect(getTrendDirection(-2)).toBe("down");
  });

  it("returns stable when delta is within threshold", () => {
    expect(getTrendDirection(0.5)).toBe("stable");
  });
});
