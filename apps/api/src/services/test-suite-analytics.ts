import { calculatePassRate } from "./test-suite-metrics";

export type TestSuiteRunSnapshot = {
  runId: string;
  suiteId: string;
  completedAt: Date;
  passedCases: number;
  totalCases: number;
  skippedCases: number;
};

export type RegressionEntry = {
  runId: string;
  suiteId: string;
  completedAt: Date;
  previousPassRate: number;
  currentPassRate: number;
  passRateDrop: number;
};

export type TrendDirection = "up" | "down" | "stable";

export function buildRegressionEntries(
  runs: TestSuiteRunSnapshot[],
  startDate: Date
): RegressionEntry[] {
  const sortedRuns = [...runs].sort(
    (a, b) => a.completedAt.getTime() - b.completedAt.getTime()
  );
  const previousPassRates = new Map<string, number>();
  const regressions: RegressionEntry[] = [];

  for (const run of sortedRuns) {
    const currentPassRate = calculatePassRate({
      passedCases: run.passedCases,
      totalCases: run.totalCases,
      skippedCases: run.skippedCases,
    });

    const previousPassRate = previousPassRates.get(run.suiteId);
    if (
      previousPassRate !== undefined &&
      run.completedAt.getTime() >= startDate.getTime() &&
      currentPassRate < previousPassRate
    ) {
      regressions.push({
        runId: run.runId,
        suiteId: run.suiteId,
        completedAt: run.completedAt,
        previousPassRate,
        currentPassRate,
        passRateDrop: previousPassRate - currentPassRate,
      });
    }

    previousPassRates.set(run.suiteId, currentPassRate);
  }

  return regressions;
}

export function getTrendDirection(
  delta: number | null,
  threshold = 1
): TrendDirection {
  if (delta === null || Math.abs(delta) < threshold) {
    return "stable";
  }

  return delta > 0 ? "up" : "down";
}
