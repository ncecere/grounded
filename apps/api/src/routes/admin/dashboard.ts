import { Hono } from "hono";
import { db } from "@grounded/db";
import {
  users,
  tenants,
  knowledgeBases,
  sources,
  kbChunks,
  agents,
  chatEvents,
} from "@grounded/db/schema";
import { sql, isNull, and, gte } from "drizzle-orm";
import { getVectorStore, isVectorStoreConfigured } from "@grounded/vector-store";
import { getAIRegistry } from "@grounded/ai-providers";
import { auth, requireSystemAdmin } from "../../middleware/auth";

export const adminDashboardRoutes = new Hono();

// All routes require system admin
adminDashboardRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// Health Status
// ============================================================================

adminDashboardRoutes.get("/health", async (c) => {
  const health: {
    database: { ok: boolean; latencyMs?: number; message?: string };
    vectorStore: { ok: boolean; configured: boolean; type?: string; vectorCount?: number; latencyMs?: number; message?: string };
    aiProviders: { ok: boolean; hasChatModel: boolean; hasEmbeddingModel: boolean; message?: string };
  } = {
    database: { ok: false },
    vectorStore: { ok: false, configured: false },
    aiProviders: { ok: false, hasChatModel: false, hasEmbeddingModel: false },
  };

  // Check database connection
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    health.database = {
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    health.database = {
      ok: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // Check vector store
  if (isVectorStoreConfigured()) {
    health.vectorStore.configured = true;
    const vectorStore = getVectorStore();
    if (vectorStore) {
      const result = await vectorStore.healthCheck();
      health.vectorStore = {
        ok: result.ok,
        configured: true,
        type: result.type,
        vectorCount: result.vectorCount,
        latencyMs: result.latencyMs,
        message: result.message,
      };
    }
  } else {
    health.vectorStore = {
      ok: false,
      configured: false,
      message: "Vector store not configured. Set VECTOR_DB_URL or VECTOR_DB_HOST.",
    };
  }

  // Check AI providers
  try {
    const registry = getAIRegistry();
    const hasChatModel = await registry.hasChatModel();
    const hasEmbeddingModel = await registry.hasEmbeddingModel();
    health.aiProviders = {
      ok: hasChatModel && hasEmbeddingModel,
      hasChatModel,
      hasEmbeddingModel,
      message: !hasChatModel && !hasEmbeddingModel
        ? "No AI models configured. Configure models in AI Models settings."
        : !hasChatModel
        ? "No chat model configured."
        : !hasEmbeddingModel
        ? "No embedding model configured."
        : undefined,
    };
  } catch (error) {
    health.aiProviders = {
      ok: false,
      hasChatModel: false,
      hasEmbeddingModel: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return c.json(health);
});

// ============================================================================
// Usage Stats
// ============================================================================

adminDashboardRoutes.get("/stats", async (c) => {
  // Get counts
  const [userCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);

  const [tenantCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenants)
    .where(isNull(tenants.deletedAt));

  const [kbCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeBases)
    .where(isNull(knowledgeBases.deletedAt));

  const [sourceCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(isNull(sources.deletedAt));

  const [chunkCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(isNull(kbChunks.deletedAt));

  const [agentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agents)
    .where(isNull(agents.deletedAt));

  // Get vector count from vector store if available
  let vectorCount = 0;
  if (isVectorStoreConfigured()) {
    const vectorStore = getVectorStore();
    if (vectorStore) {
      vectorCount = await vectorStore.count();
    }
  }

  // Get chat events stats for the last 24 hours and 7 days
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [chatEvents24h] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatEvents)
    .where(gte(chatEvents.startedAt, oneDayAgo));

  const [chatEvents7d] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatEvents)
    .where(gte(chatEvents.startedAt, sevenDaysAgo));

  return c.json({
    users: userCount.count,
    tenants: tenantCount.count,
    knowledgeBases: kbCount.count,
    sources: sourceCount.count,
    chunks: chunkCount.count,
    vectors: vectorCount,
    agents: agentCount.count,
    chatEvents: {
      last24h: chatEvents24h.count,
      last7d: chatEvents7d.count,
    },
  });
});
