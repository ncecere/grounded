import { describe, it, expect, mock } from "bun:test";

// Mock @grounded/queue BEFORE importing routes to prevent eager Redis connections.
// Without Redis in CI, ioredis buffers commands indefinitely causing test timeouts.
mock.module("@grounded/queue", () => ({
  redis: {},
  checkRateLimit: mock(async () => ({
    allowed: true,
    remaining: 59,
    resetAt: Date.now() + 60_000,
  })),
  addSourceRunStartJob: mock(async () => {}),
  addPageProcessJob: mock(async () => {}),
  addKbReindexJob: mock(async () => {}),
  addHardDeleteJob: mock(async () => {}),
  initializeStageProgress: mock(async () => {}),
  removeAllJobsForRun: mock(async () => {}),
  unregisterRun: mock(async () => {}),
  getFairnessMetrics: mock(async () => ({})),
  resetFairnessState: mock(async () => {}),
  getConversation: mock(async () => []),
  addToConversation: mock(async () => {}),
}));

import { createV1Routes } from "./index";

describe("createV1Routes", () => {
  it("mounts the auth callback route", async () => {
    const v1 = createV1Routes();
    const response = await v1.fetch(
      new Request("http://localhost/auth/oidc/callback?error=access_denied")
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: "access_denied" });
  });
});
