import { describe, expect, it } from "bun:test";

describe("ImportTestCasesDialog module exports", () => {
  it("should export ImportTestCasesDialog component", async () => {
    const module = await import("./ImportTestCasesDialog");
    expect(module.ImportTestCasesDialog).toBeDefined();
  });
});
