import { describe, expect, it } from "bun:test";
import { buildTestSuiteAnalyticsQuery } from "./Analytics";

describe("buildTestSuiteAnalyticsQuery", () => {
  it("should build a query with start and end dates", () => {
    expect(
      buildTestSuiteAnalyticsQuery({
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      })
    ).toBe("?startDate=2026-01-01&endDate=2026-01-31");
  });

  it("should build a query with only a start date", () => {
    expect(buildTestSuiteAnalyticsQuery({ startDate: "2026-01-01" })).toBe(
      "?startDate=2026-01-01"
    );
  });

  it("should return an empty string when no dates provided", () => {
    expect(buildTestSuiteAnalyticsQuery({})).toBe("");
  });
});
