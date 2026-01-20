import { describe, it, expect } from "bun:test";

describe("test suites hooks module", () => {
  it("should export query hooks", async () => {
    const hooks = await import("./test-suites.hooks");
    expect(typeof hooks.useTestSuites).toBe("function");
    expect(typeof hooks.useTestSuite).toBe("function");
    expect(typeof hooks.useTestCases).toBe("function");
    expect(typeof hooks.useTestCase).toBe("function");
    expect(typeof hooks.useTestRuns).toBe("function");
    expect(typeof hooks.useTestRun).toBe("function");
    expect(typeof hooks.useTestSuiteAnalytics).toBe("function");
  });

  it("should export mutation hooks", async () => {
    const hooks = await import("./test-suites.hooks");
    expect(typeof hooks.useCreateTestSuite).toBe("function");
    expect(typeof hooks.useUpdateTestSuite).toBe("function");
    expect(typeof hooks.useDeleteTestSuite).toBe("function");
    expect(typeof hooks.useCreateTestCase).toBe("function");
    expect(typeof hooks.useUpdateTestCase).toBe("function");
    expect(typeof hooks.useDeleteTestCase).toBe("function");
    expect(typeof hooks.useReorderTestCases).toBe("function");
    expect(typeof hooks.useImportTestCases).toBe("function");
    expect(typeof hooks.useStartTestRun).toBe("function");
    expect(typeof hooks.useDeleteTestRun).toBe("function");
  });

  it("should export query key helpers", async () => {
    const hooks = await import("./test-suites.hooks");
    expect(typeof hooks.testSuiteKeys).toBe("object");
    expect(typeof hooks.testCaseKeys).toBe("object");
    expect(typeof hooks.testRunKeys).toBe("object");
  });

  it("should expose expected hook signatures", async () => {
    const hooks = await import("./test-suites.hooks");
    expect(hooks.useTestSuites.length).toBe(1);
    expect(hooks.useTestSuite.length).toBe(1);
    expect(hooks.useTestCases.length).toBe(1);
    expect(hooks.useTestCase.length).toBe(1);
    expect(hooks.useTestRuns.length).toBe(2);
    expect(hooks.useTestRun.length).toBe(1);
    expect(hooks.useTestSuiteAnalytics.length).toBe(2);
  });
});
