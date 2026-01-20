import { buildPassRateSeries } from "./PassRateChart";

describe("PassRateChart module exports", () => {
  it("should export PassRateChart component", async () => {
    const module = await import("./PassRateChart");
    expect(module.PassRateChart).toBeDefined();
  });
});

describe("buildPassRateSeries", () => {
  const runs = [
    { date: "2026-01-01", passRate: 92, totalRuns: 3 },
    { date: "2026-01-02", passRate: 81, totalRuns: 2 },
    { date: "2026-01-03", passRate: 88, totalRuns: 1 },
  ];

  it("should mark regressions when pass rate drops", () => {
    const series = buildPassRateSeries(runs, 10);

    expect(series[0].isRegression).toBe(false);
    expect(series[1].isRegression).toBe(true);
    expect(series[2].isRegression).toBe(false);
  });

  it("should clamp pass rates to 0-100", () => {
    const series = buildPassRateSeries(
      [
        { date: "2026-01-04", passRate: 120, totalRuns: 1 },
        { date: "2026-01-05", passRate: -10, totalRuns: 1 },
      ],
      10
    );

    expect(series[0].passRate).toBe(100);
    expect(series[1].passRate).toBe(0);
  });

  it("should limit output to max points", () => {
    const series = buildPassRateSeries(runs, 2);

    expect(series).toHaveLength(2);
    expect(series[0].date).toBe("2026-01-02");
    expect(series[1].date).toBe("2026-01-03");
  });
});
