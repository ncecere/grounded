import { describe, expect, it } from "bun:test";
import {
  DEFAULT_EXPECTED_BEHAVIOR,
  DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD,
} from "./ExpectedBehaviorEditor";

describe("ExpectedBehaviorEditor module exports", () => {
  it("should export ExpectedBehaviorEditor component", async () => {
    const module = await import("./ExpectedBehaviorEditor");
    expect(module.ExpectedBehaviorEditor).toBeDefined();
  });
});

describe("DEFAULT_EXPECTED_BEHAVIOR", () => {
  it("should default to all mode", () => {
    expect(DEFAULT_EXPECTED_BEHAVIOR.mode).toBe("all");
  });

  it("should start with no checks", () => {
    expect(DEFAULT_EXPECTED_BEHAVIOR.checks).toEqual([]);
  });
});

describe("DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD", () => {
  it("should default to 0.8", () => {
    expect(DEFAULT_SEMANTIC_SIMILARITY_THRESHOLD).toBe(0.8);
  });
});
