import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { Context, Next } from "hono";

const embeddingModelId = "550e8400-e29b-41d4-a716-446655440000";

const listModelsMock = mock(async () => [
  {
    id: embeddingModelId,
    dimensions: undefined,
  },
]);

const getAIRegistryMock = mock(() => ({
  listModels: listModelsMock,
  getDefaultModel: mock(async () => ({ id: "default", dimensions: 768 })),
}));

const withRequestRLSMock = mock(async (_c: Context, callback: (tx: unknown) => Promise<unknown>) => {
  const mockTx = {
    query: {
      knowledgeBases: {
        findFirst: mock(async () => ({
          id: "kb-1",
          tenantId: "tenant-1",
          reindexStatus: null,
          embeddingModelId: "previous-model",
        })),
      },
    },
  };

  return callback(mockTx as any);
});

const authMiddleware = () => async (c: Context, next: Next) => {
  c.set("auth", {
    tenantId: "tenant-1",
    role: "owner",
    isSystemAdmin: false,
    apiKeyId: null,
    user: {
      id: "user-1",
      email: "user@example.com",
      issuer: "test",
      subject: "user-1",
    },
  });
  await next();
};

mock.module("../middleware/auth", () => ({
  auth: authMiddleware,
  requireTenant: () => async (_c: Context, next: Next) => next(),
  requireRole: () => async (_c: Context, next: Next) => next(),
  requireSystemAdmin: () => async (_c: Context, next: Next) => next(),
  withRequestRLS: withRequestRLSMock,
}));

mock.module("@grounded/ai-providers", () => ({
  getAIRegistry: getAIRegistryMock,
}));

mock.module("@grounded/queue", () => ({
  addKbReindexJob: mock(async () => {}),
}));

const { errorHandler } = await import("../middleware/error-handler");
const { kbRoutes } = await import("./knowledge-bases");

describe("knowledge base routes", () => {
  it("returns BadRequestError for embedding models without dimensions", async () => {
    const app = new Hono();
    app.route("/api/v1/knowledge-bases", kbRoutes);
    app.onError(errorHandler);

    const response = await app.fetch(
      new Request("http://localhost/api/v1/knowledge-bases/kb-1/reindex", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ embeddingModelId }),
      })
    );

    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toMatchObject({
      error: "BAD_REQUEST",
      message: "Embedding model does not have dimensions configured",
    });
  });
});
