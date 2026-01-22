import { describe, expect, it } from "bun:test";

describe("api type modules", () => {
  it("should load all domain type files", async () => {
    const modules = [
      "./auth",
      "./tenants",
      "./knowledge-bases",
      "./sources",
      "./agents",
      "./chat",
      "./test-suites",
      "./tools",
      "./analytics",
      "./admin",
    ];

    for (const modulePath of modules) {
      const mod = await import(modulePath);
      expect(mod).toBeDefined();
    }
  });
});
