import { describe, it, expect } from "bun:test";

describe("analytics hooks module", () => {
  it("should export query hooks", async () => {
    const hooks = await import("./analytics.hooks");
    expect(typeof hooks.useTestSuiteAnalytics).toBe("function");
  });

  it("should export query key helpers", async () => {
    const hooks = await import("./analytics.hooks");
    expect(typeof hooks.analyticsKeys).toBe("object");
  });

  it("should expose expected hook signatures", async () => {
    const hooks = await import("./analytics.hooks");
    expect(hooks.useTestSuiteAnalytics.length).toBe(1);
  });
});
