import { buildPassRateLineSeries } from "./PassRateLineChart";

describe("PassRateLineChart module exports", () => {
  it("should export PassRateLineChart component", async () => {
    const module = await import("./PassRateLineChart");
    expect(module.PassRateLineChart).toBeDefined();
  });
});

describe("buildPassRateLineSeries", () => {
  const data = [
    { date: "2026-01-01", passRate: 92, totalRuns: 3 },
    { date: "2026-01-02", passRate: 81, totalRuns: 4 },
    { date: "2026-01-03", passRate: 88, totalRuns: 2 },
  ];

  it("should clamp pass rates to 0-100", () => {
    const series = buildPassRateLineSeries(
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
    const series = buildPassRateLineSeries(data, 2);

    expect(series).toHaveLength(2);
    expect(series[0].date).toBe("2026-01-02");
    expect(series[1].date).toBe("2026-01-03");
  });
});
