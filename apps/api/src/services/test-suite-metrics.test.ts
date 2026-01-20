import { describe, expect, it } from "bun:test";
import { calculatePassRate, calculateRegressionCount } from "./test-suite-metrics";

describe("calculatePassRate", () => {
  it("returns a percentage when cases are evaluated", () => {
    const value = calculatePassRate({ passedCases: 8, totalCases: 10, skippedCases: 1 });
    expect(value).toBeCloseTo(88.8889, 4);
  });

  it("returns 100 when all cases are skipped", () => {
    const value = calculatePassRate({ passedCases: 0, totalCases: 5, skippedCases: 5 });
    expect(value).toBe(100);
  });
});

describe("calculateRegressionCount", () => {
  it("counts pass rate drops only", () => {
    const value = calculateRegressionCount([90, 92, 91, 91, 80]);
    expect(value).toBe(2);
  });

  it("returns zero when no regressions", () => {
    const value = calculateRegressionCount([85, 85, 90]);
    expect(value).toBe(0);
  });
});
