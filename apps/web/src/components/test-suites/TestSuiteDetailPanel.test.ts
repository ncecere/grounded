import { describe, it, expect } from "bun:test";
import { DEFAULT_TEST_SUITE_FORM } from "./TestSuiteDetailPanel";

describe("TestSuiteDetailPanel module exports", () => {
  it("should export TestSuiteDetailPanel component", async () => {
    const module = await import("./TestSuiteDetailPanel");
    expect(module.TestSuiteDetailPanel).toBeDefined();
  });
});

describe("DEFAULT_TEST_SUITE_FORM", () => {
  it("should define default schedule type", () => {
    expect(DEFAULT_TEST_SUITE_FORM.scheduleType).toBe("manual");
  });

  it("should enable alerting by default", () => {
    expect(DEFAULT_TEST_SUITE_FORM.alertOnRegression).toBe(true);
  });
});
