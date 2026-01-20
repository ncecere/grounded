import { describe, it, expect } from "bun:test";
import {
  formatPassRate,
  getScheduleLabel,
  getRunStatusBadge,
  getRunTimestampLabel,
} from "./TestSuiteCard";
import type { TestSuite, TestSuiteRunSummary } from "@/lib/api";

const createSuite = (overrides: Partial<TestSuite> = {}): TestSuite => ({
  id: "suite-1",
  agentId: "agent-1",
  name: "Onboarding Suite",
  description: null,
  scheduleType: "manual",
  scheduleTime: null,
  scheduleDayOfWeek: null,
  llmJudgeModelConfigId: null,
  alertOnRegression: false,
  alertThresholdPercent: 10,
  isEnabled: true,
  testCaseCount: 3,
  lastRun: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

const createRunSummary = (overrides: Partial<TestSuiteRunSummary> = {}): TestSuiteRunSummary => ({
  id: "run-1",
  status: "completed",
  passRate: 92,
  completedAt: "2026-01-10T10:00:00Z",
  ...overrides,
});

describe("TestSuiteCard module exports", () => {
  it("should export TestSuiteCard component", async () => {
    const module = await import("./TestSuiteCard");
    expect(module.TestSuiteCard).toBeDefined();
  });
});

describe("formatPassRate", () => {
  it("should round pass rate to nearest whole percent", () => {
    expect(formatPassRate(87.6)).toBe("88%");
  });

  it("should clamp pass rate above 100", () => {
    expect(formatPassRate(132)).toBe("100%");
  });

  it("should clamp pass rate below 0", () => {
    expect(formatPassRate(-5)).toBe("0%");
  });
});

describe("getScheduleLabel", () => {
  it("should label manual schedules", () => {
    const suite = createSuite({ scheduleType: "manual" });
    expect(getScheduleLabel(suite)).toBe("Manual");
  });

  it("should label daily schedules with time", () => {
    const suite = createSuite({ scheduleType: "daily", scheduleTime: "09:00" });
    expect(getScheduleLabel(suite)).toBe("Daily · 09:00");
  });

  it("should label weekly schedules with day and time", () => {
    const suite = createSuite({
      scheduleType: "weekly",
      scheduleDayOfWeek: 1,
      scheduleTime: "14:30",
    });
    expect(getScheduleLabel(suite)).toBe("Weekly · Mon 14:30");
  });
});

describe("getRunStatusBadge", () => {
  it("should return default badge when no runs exist", () => {
    const badge = getRunStatusBadge(null);
    expect(badge.status).toBe("default");
    expect(badge.label).toBe("No runs");
  });

  it("should include pass rate for completed runs", () => {
    const run = createRunSummary({ status: "completed", passRate: 87.6 });
    const badge = getRunStatusBadge(run);
    expect(badge.status).toBe("success");
    expect(badge.label).toBe("Pass 88%");
  });

  it("should label running runs", () => {
    const run = createRunSummary({ status: "running" });
    const badge = getRunStatusBadge(run);
    expect(badge.status).toBe("pending");
    expect(badge.label).toBe("Running");
  });

  it("should label failed runs", () => {
    const run = createRunSummary({ status: "failed" });
    const badge = getRunStatusBadge(run);
    expect(badge.status).toBe("error");
    expect(badge.label).toBe("Failed");
  });
});

describe("getRunTimestampLabel", () => {
  it("should label empty runs as not run", () => {
    expect(getRunTimestampLabel(null)).toBe("Not run yet");
  });

  it("should format completed run dates", () => {
    const run = createRunSummary({ completedAt: "2026-01-10T10:00:00Z" });
    expect(getRunTimestampLabel(run)).toBe("Last run 1/10/2026");
  });

  it("should label running runs", () => {
    const run = createRunSummary({ status: "running", completedAt: null });
    expect(getRunTimestampLabel(run)).toBe("Run in progress");
  });
});
