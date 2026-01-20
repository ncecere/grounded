import { describe, expect, it } from "bun:test";
import { RecentRegressionsTable, formatPassRateChange, formatRelativeTime } from "./RecentRegressionsTable";

describe("RecentRegressionsTable module", () => {
  it("should export RecentRegressionsTable component", () => {
    expect(RecentRegressionsTable).toBeDefined();
  });
});

describe("formatPassRateChange", () => {
  it("should clamp and format pass rate ranges", () => {
    expect(formatPassRateChange(120, -10)).toBe("100% → 0%");
  });
});

describe("formatRelativeTime", () => {
  it("should return fallback for empty values", () => {
    expect(formatRelativeTime(null)).toBe("—");
  });

  it("should return relative time for valid timestamps", () => {
    const now = new Date("2026-01-20T12:00:00Z");
    expect(formatRelativeTime("2026-01-20T11:00:00Z", now)).toBe("1 hour ago");
  });
});
