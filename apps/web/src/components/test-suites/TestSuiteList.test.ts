import { describe, it, expect } from "bun:test";
import { DEFAULT_EMPTY_STATE } from "./TestSuiteList";

describe("TestSuiteList module exports", () => {
  it("should export TestSuiteList component", async () => {
    const module = await import("./TestSuiteList");
    expect(module.TestSuiteList).toBeDefined();
  });
});

describe("TestSuiteList defaults", () => {
  it("should define default empty state title", () => {
    expect(DEFAULT_EMPTY_STATE.title).toBe("No test suites yet");
  });

  it("should define default empty state description", () => {
    expect(DEFAULT_EMPTY_STATE.description).toBe("Create a test suite to validate agent responses.");
  });
});
