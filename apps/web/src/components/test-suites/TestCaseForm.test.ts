import { describe, expect, it } from "bun:test";
import { DEFAULT_TEST_CASE_FORM } from "./TestCaseForm";

describe("TestCaseForm module exports", () => {
  it("should export TestCaseForm component", async () => {
    const module = await import("./TestCaseForm");
    expect(module.TestCaseForm).toBeDefined();
  });
});

describe("DEFAULT_TEST_CASE_FORM", () => {
  it("should default to enabled", () => {
    expect(DEFAULT_TEST_CASE_FORM.isEnabled).toBe(true);
  });

  it("should default to empty strings", () => {
    expect(DEFAULT_TEST_CASE_FORM.name).toBe("");
    expect(DEFAULT_TEST_CASE_FORM.question).toBe("");
  });
});
