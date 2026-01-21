import { describe, expect, it } from "bun:test";
import type { WorkerLogger } from "./helpers";
import { initVectorStore } from "./vector-store";

const noopLogger = {
  level: "silent",
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => noopLogger,
  flush: () => {},
} as unknown as WorkerLogger;

describe("initVectorStore", () => {
  it("returns false when vector store is not configured", async () => {
    let initialized = false;
    const result = await initVectorStore({
      logger: noopLogger,
      isConfigured: () => false,
      initialize: async () => {
        initialized = true;
      },
    });

    expect(result).toBe(false);
    expect(initialized).toBe(false);
  });

  it("returns true when initialization succeeds", async () => {
    let initialized = false;
    const result = await initVectorStore({
      logger: noopLogger,
      isConfigured: () => true,
      initialize: async () => {
        initialized = true;
      },
    });

    expect(result).toBe(true);
    expect(initialized).toBe(true);
  });

  it("returns false when initialization fails", async () => {
    const result = await initVectorStore({
      logger: noopLogger,
      isConfigured: () => true,
      initialize: async () => {
        throw new Error("boom");
      },
    });

    expect(result).toBe(false);
  });
});
