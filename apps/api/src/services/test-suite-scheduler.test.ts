import { describe, expect, it } from "bun:test";
import {
  getScheduleWindowStart,
  parseScheduleTime,
  selectRunsForRetentionCleanup,
  shouldRunNow,
  shouldRunRetentionCleanup,
} from "./test-suite-scheduler";

const buildSuite = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "suite-1",
    name: "Daily Suite",
    scheduleType: "daily",
    scheduleTime: "12:30",
    scheduleDayOfWeek: 2,
    isEnabled: true,
    ...overrides,
  } as Parameters<typeof shouldRunNow>[0]);

describe("parseScheduleTime", () => {
  it("parses valid times", () => {
    expect(parseScheduleTime("09:45")).toEqual({ hour: 9, minute: 45 });
  });

  it("defaults invalid values to zero", () => {
    expect(parseScheduleTime("bad")).toEqual({ hour: 0, minute: 0 });
  });
});

describe("shouldRunNow", () => {
  it("runs hourly suites on the hour", () => {
    const suite = buildSuite({ scheduleType: "hourly" });
    expect(shouldRunNow(suite, new Date("2026-01-20T10:00:00Z"))).toBe(true);
    expect(shouldRunNow(suite, new Date("2026-01-20T10:05:00Z"))).toBe(false);
  });

  it("runs daily suites at the configured time", () => {
    const suite = buildSuite({ scheduleType: "daily", scheduleTime: "04:15" });
    expect(shouldRunNow(suite, new Date("2026-01-20T04:15:00Z"))).toBe(true);
    expect(shouldRunNow(suite, new Date("2026-01-20T04:16:00Z"))).toBe(false);
  });

  it("runs weekly suites on the configured weekday", () => {
    const suite = buildSuite({ scheduleType: "weekly", scheduleTime: "18:00", scheduleDayOfWeek: 3 });
    expect(shouldRunNow(suite, new Date("2026-01-21T18:00:00Z"))).toBe(true);
    expect(shouldRunNow(suite, new Date("2026-01-22T18:00:00Z"))).toBe(false);
  });
});

describe("getScheduleWindowStart", () => {
  it("returns week start for weekly schedules", () => {
    const suite = buildSuite({ scheduleType: "weekly" });
    const windowStart = getScheduleWindowStart(suite, new Date("2026-01-14T10:00:00Z"));

    expect(windowStart.toISOString()).toBe("2026-01-11T00:00:00.000Z");
  });
});

describe("shouldRunRetentionCleanup", () => {
  it("matches cleanup time in UTC", () => {
    const settings = { cleanupTime: "02:00", retentionDays: 30, retentionRuns: 30 };
    expect(shouldRunRetentionCleanup(new Date("2026-01-20T02:00:00Z"), settings)).toBe(true);
    expect(shouldRunRetentionCleanup(new Date("2026-01-20T03:00:00Z"), settings)).toBe(false);
  });
});

describe("selectRunsForRetentionCleanup", () => {
  it("keeps recent runs and latest runs", () => {
    const runs = [
      { id: "run-1", createdAt: new Date("2025-12-01T10:00:00Z"), completedAt: null },
      { id: "run-2", createdAt: new Date("2026-01-10T10:00:00Z"), completedAt: null },
      { id: "run-3", createdAt: new Date("2026-01-15T10:00:00Z"), completedAt: null },
    ];
    const cutoffDate = new Date("2025-12-21T00:00:00Z");

    const result = selectRunsForRetentionCleanup(runs, ["run-1"], cutoffDate);

    expect(result.deleteIds).toEqual([]);
    expect(result.keepIds).toEqual(expect.arrayContaining(["run-1", "run-2", "run-3"]));
  });

  it("deletes runs outside retention window", () => {
    const runs = [
      { id: "run-old", createdAt: new Date("2025-10-01T10:00:00Z"), completedAt: null },
      { id: "run-new", createdAt: new Date("2026-01-15T10:00:00Z"), completedAt: null },
    ];
    const cutoffDate = new Date("2025-12-21T00:00:00Z");

    const result = selectRunsForRetentionCleanup(runs, [], cutoffDate);

    expect(result.deleteIds).toEqual(["run-old"]);
    expect(result.keepIds).toEqual(["run-new"]);
  });
});
