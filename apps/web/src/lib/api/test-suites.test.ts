import { describe, it, expect } from "bun:test";

describe("test suites API module", () => {
  describe("module exports", () => {
    it("should export testSuitesApi object", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(testSuitesApi).toBeDefined();
      expect(typeof testSuitesApi).toBe("object");
    });

    it("should export test suite CRUD methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(typeof testSuitesApi.listTestSuites).toBe("function");
      expect(typeof testSuitesApi.createTestSuite).toBe("function");
      expect(typeof testSuitesApi.getTestSuite).toBe("function");
      expect(typeof testSuitesApi.updateTestSuite).toBe("function");
      expect(typeof testSuitesApi.deleteTestSuite).toBe("function");
    });

    it("should export test case methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(typeof testSuitesApi.listTestCases).toBe("function");
      expect(typeof testSuitesApi.createTestCase).toBe("function");
      expect(typeof testSuitesApi.reorderTestCases).toBe("function");
      expect(typeof testSuitesApi.getTestCase).toBe("function");
      expect(typeof testSuitesApi.updateTestCase).toBe("function");
      expect(typeof testSuitesApi.deleteTestCase).toBe("function");
    });

    it("should export import/export methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(typeof testSuitesApi.importTestCases).toBe("function");
      expect(typeof testSuitesApi.exportTestCases).toBe("function");
    });

    it("should export test run methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(typeof testSuitesApi.listTestRuns).toBe("function");
      expect(typeof testSuitesApi.startTestRun).toBe("function");
      expect(typeof testSuitesApi.getTestRun).toBe("function");
      expect(typeof testSuitesApi.deleteTestRun).toBe("function");
      expect(typeof testSuitesApi.getTestSuiteAnalytics).toBe("function");
    });
  });

  describe("API method parameter counts", () => {
    it("should have correct parameter counts for suite methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(testSuitesApi.listTestSuites.length).toBe(1);
      expect(testSuitesApi.createTestSuite.length).toBe(2);
      expect(testSuitesApi.getTestSuite.length).toBe(1);
      expect(testSuitesApi.updateTestSuite.length).toBe(2);
      expect(testSuitesApi.deleteTestSuite.length).toBe(1);
    });

    it("should have correct parameter counts for case methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(testSuitesApi.listTestCases.length).toBe(1);
      expect(testSuitesApi.createTestCase.length).toBe(2);
      expect(testSuitesApi.reorderTestCases.length).toBe(2);
      expect(testSuitesApi.getTestCase.length).toBe(1);
      expect(testSuitesApi.updateTestCase.length).toBe(2);
      expect(testSuitesApi.deleteTestCase.length).toBe(1);
    });

    it("should have correct parameter counts for run methods", async () => {
      const { testSuitesApi } = await import("./test-suites");
      expect(testSuitesApi.importTestCases.length).toBe(2);
      expect(testSuitesApi.exportTestCases.length).toBe(1);
      expect(testSuitesApi.listTestRuns.length).toBe(2);
      expect(testSuitesApi.startTestRun.length).toBe(1);
      expect(testSuitesApi.getTestRun.length).toBe(1);
      expect(testSuitesApi.deleteTestRun.length).toBe(1);
      expect(testSuitesApi.getTestSuiteAnalytics.length).toBe(2);
    });
  });
});
