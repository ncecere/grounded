import { describe, expect, it } from "bun:test";

const barrelUrl = new URL("./index.ts", import.meta.url);

describe("api types barrel export", () => {
  it("should re-export all domain type modules", async () => {
    const source = await Bun.file(barrelUrl).text();

    const exports = [
      'export * from "./admin";',
      'export * from "./agents";',
      'export * from "./analytics";',
      'export * from "./auth";',
      'export * from "./chat";',
      'export * from "./knowledge-bases";',
      'export * from "./sources";',
      'export * from "./tenants";',
      'export * from "./test-suites";',
      'export * from "./tools";',
    ];

    for (const statement of exports) {
      expect(source).toContain(statement);
    }
  });
});
