import { describe, expect, it } from "bun:test";

describe("TestSuitesTab module exports", () => {
  it("should export TestSuitesTab component", async () => {
    const module = await import("./TestSuitesTab");
    expect(module.TestSuitesTab).toBeDefined();
  });
});
