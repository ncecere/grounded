import {
  formatRunDuration,
  formatRunTimingLabel,
  formatRunTriggerLabel,
  getRunStatusBadge,
} from "./TestRunCard";
import type { TestSuiteRun } from "@/lib/api";

const createRun = (overrides: Partial<TestSuiteRun> = {}): TestSuiteRun => ({
  id: "run-1",
  suiteId: "suite-1",
  suiteName: "Onboarding Suite",
  status: "completed",
  triggeredBy: "manual",
  triggeredByUser: { id: "user-1", name: "Maya" },
  totalCases: 12,
  passedCases: 10,
  failedCases: 1,
  skippedCases: 1,
  passRate: 83.3,
  startedAt: "2026-01-10T10:00:00Z",
  completedAt: "2026-01-10T10:02:00Z",
  durationMs: 120000,
  errorMessage: null,
  createdAt: "2026-01-10T10:00:00Z",
  ...overrides,
});

describe("TestRunCard module exports", () => {
  it("should export TestRunCard component", async () => {
    const module = await import("./TestRunCard");
    expect(module.TestRunCard).toBeDefined();
  });
});

describe("formatRunDuration", () => {
  it("should format seconds for short durations", () => {
    expect(formatRunDuration(4000)).toBe("4s");
  });

  it("should format minutes and seconds", () => {
    expect(formatRunDuration(90000)).toBe("1m 30s");
  });

  it("should format hours and minutes", () => {
    expect(formatRunDuration(3720000)).toBe("1h 2m");
  });
});

describe("formatRunTimingLabel", () => {
  it("should label completed runs", () => {
    const run = createRun({ completedAt: "2026-01-10T10:00:00Z" });
    expect(formatRunTimingLabel(run)).toBe("Completed 1/10/2026");
  });

  it("should label started runs", () => {
    const run = createRun({ completedAt: null, startedAt: "2026-01-11T10:00:00Z" });
    expect(formatRunTimingLabel(run)).toBe("Started 1/11/2026");
  });

  it("should fallback when no timestamps exist", () => {
    const run = createRun({ startedAt: null, completedAt: null });
    expect(formatRunTimingLabel(run)).toBe("Not started");
  });
});

describe("formatRunTriggerLabel", () => {
  it("should label scheduled runs", () => {
    const run = createRun({ triggeredBy: "schedule" });
    expect(formatRunTriggerLabel(run)).toBe("Scheduled run");
  });

  it("should include user names when available", () => {
    const run = createRun({ triggeredBy: "manual" });
    expect(formatRunTriggerLabel(run)).toBe("Manual run by Maya");
  });

  it("should fallback to manual run label", () => {
    const run = createRun({ triggeredByUser: null });
    expect(formatRunTriggerLabel(run)).toBe("Manual run");
  });
});

describe("getRunStatusBadge", () => {
  it("should label pending runs", () => {
    const run = createRun({ status: "pending" });
    const badge = getRunStatusBadge(run);
    expect(badge.status).toBe("pending");
    expect(badge.label).toBe("Queued");
  });

  it("should label completed runs", () => {
    const run = createRun({ status: "completed" });
    const badge = getRunStatusBadge(run);
    expect(badge.status).toBe("success");
    expect(badge.label).toBe("Completed");
  });
});
