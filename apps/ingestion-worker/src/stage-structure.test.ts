/**
 * Stage Module Structure Tests
 *
 * Validates the split stage manager modules exist and
 * the stage-manager entrypoint re-exports them.
 */

import { describe, it, expect } from "bun:test";

describe("Stage modules", () => {
  it("exports stage module entrypoints", async () => {
    const config = await import("./stage/config");
    const progress = await import("./stage/progress");
    const transitions = await import("./stage/transitions");
    const cleanup = await import("./stage/cleanup");
    const priority = await import("./stage/priority");

    expect(typeof config.getStageManagerConfig).toBe("function");
    expect(typeof config.setStageManagerConfig).toBe("function");

    expect(typeof progress.getStageProgress).toBe("function");
    expect(typeof progress.initializeStage).toBe("function");
    expect(typeof progress.markStageItemComplete).toBe("function");

    expect(typeof transitions.getNextStage).toBe("function");
    expect(typeof transitions.transitionToNextStage).toBe("function");
    expect(typeof transitions.isRunCanceled).toBe("function");

    expect(typeof cleanup.cleanupRunRedisState).toBe("function");

    expect(typeof priority.calculatePriority).toBe("function");
    expect(typeof priority.getRunSize).toBe("function");
  });

  it("stage-manager re-exports stage helpers", async () => {
    const stageManager = await import("./stage-manager");

    expect(typeof stageManager.getStageManagerConfig).toBe("function");
    expect(typeof stageManager.getStageProgress).toBe("function");
    expect(typeof stageManager.transitionToNextStage).toBe("function");
    expect(typeof stageManager.cleanupRunRedisState).toBe("function");
    expect(typeof stageManager.calculatePriority).toBe("function");
  });
});
