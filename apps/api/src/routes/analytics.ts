import { Hono } from "hono";
import { db } from "@grounded/db";
import { chatEvents, agents, tenantUsage } from "@grounded/db/schema";
import { eq, and, isNull, sql, gte, lte, desc } from "drizzle-orm";
import { auth, requireTenant, withRequestRLS } from "../middleware/auth";
import { NotFoundError } from "../middleware/error-handler";

export const analyticsRoutes = new Hono();

// ============================================================================
// Dashboard Analytics (matches frontend AnalyticsData interface)
// ============================================================================

analyticsRoutes.get("/", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Build date filter
  const dateFilters = [eq(chatEvents.tenantId, authContext.tenantId!)];
  if (startDate) {
    dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
  }
  if (endDate) {
    // Set to end of day to include all events on the end date
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    dateFilters.push(lte(chatEvents.startedAt, endOfDay));
  }

  const result = await withRequestRLS(c, async (tx) => {
    // Get total queries and avg response time
    const stats = await tx
      .select({
        totalQueries: sql<number>`count(*)`,
        avgResponseTime: sql<number>`coalesce(avg(latency_ms), 0)`,
      })
      .from(chatEvents)
      .where(and(...dateFilters));

    // Get queries by day
    const queriesByDay = await tx
      .select({
        date: sql<string>`to_char(started_at, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)`,
      })
      .from(chatEvents)
      .where(and(...dateFilters))
      .groupBy(sql`to_char(started_at, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(started_at, 'YYYY-MM-DD')`);

    return { stats, queriesByDay };
  });

  // For now, return empty topQueries (would need to store query text to implement)
  // and estimate conversations (each unique session could be a conversation)
  return c.json({
    totalQueries: Number(result.stats[0]?.totalQueries) || 0,
    totalConversations: Number(result.stats[0]?.totalQueries) || 0, // Approximation for now
    avgResponseTime: Math.round(Number(result.stats[0]?.avgResponseTime) || 0),
    topQueries: [], // Would need to store query text to implement
    queriesByDay: result.queriesByDay.map(d => ({
      date: d.date,
      count: Number(d.count),
    })),
  });
});

// ============================================================================
// Agent Analytics
// ============================================================================

analyticsRoutes.get(
  "/agents/:agentId",
  auth(),
  requireTenant(),
  async (c) => {
    const agentId = c.req.param("agentId");
    const authContext = c.get("auth");
    const startDate = c.req.query("start");
    const endDate = c.req.query("end");

    const result = await withRequestRLS(c, async (tx) => {
      // Verify agent belongs to tenant
      const agent = await tx.query.agents.findFirst({
        where: and(
          eq(agents.id, agentId),
          eq(agents.tenantId, authContext.tenantId!),
          isNull(agents.deletedAt)
        ),
      });

      if (!agent) {
        throw new NotFoundError("Agent");
      }

      // Build date filter
      const dateFilters = [eq(chatEvents.agentId, agentId)];
      if (startDate) {
        dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
      }
      if (endDate) {
        dateFilters.push(lte(chatEvents.startedAt, new Date(endDate)));
      }

      // Get aggregated stats
      const stats = await tx
        .select({
          totalRequests: sql<number>`count(*)`,
          successfulRequests: sql<number>`count(*) filter (where status = 'ok')`,
          errorRequests: sql<number>`count(*) filter (where status = 'error')`,
          rateLimitedRequests: sql<number>`count(*) filter (where status = 'rate_limited')`,
          avgLatencyMs: sql<number>`avg(latency_ms)`,
          p50LatencyMs: sql<number>`percentile_cont(0.5) within group (order by latency_ms)`,
          p95LatencyMs: sql<number>`percentile_cont(0.95) within group (order by latency_ms)`,
          p99LatencyMs: sql<number>`percentile_cont(0.99) within group (order by latency_ms)`,
          totalPromptTokens: sql<number>`sum(prompt_tokens)`,
          totalCompletionTokens: sql<number>`sum(completion_tokens)`,
          avgRetrievedChunks: sql<number>`avg(retrieved_chunks)`,
        })
        .from(chatEvents)
        .where(and(...dateFilters));

      // Get daily breakdown
      const dailyStats = await tx
        .select({
          date: sql<string>`date(started_at)`,
          requests: sql<number>`count(*)`,
          errors: sql<number>`count(*) filter (where status = 'error')`,
          avgLatency: sql<number>`avg(latency_ms)`,
        })
        .from(chatEvents)
        .where(and(...dateFilters))
        .groupBy(sql`date(started_at)`)
        .orderBy(sql`date(started_at)`);

      // Get channel breakdown
      const channelStats = await tx
        .select({
          channel: chatEvents.channel,
          requests: sql<number>`count(*)`,
        })
        .from(chatEvents)
        .where(and(...dateFilters))
        .groupBy(chatEvents.channel);

      return { agent, stats, dailyStats, channelStats };
    });

    return c.json({
      agent: {
        id: result.agent.id,
        name: result.agent.name,
      },
      summary: result.stats[0],
      daily: result.dailyStats,
      byChannel: result.channelStats,
    });
  }
);

// ============================================================================
// Tenant Analytics
// ============================================================================

analyticsRoutes.get("/tenant", auth(), requireTenant(), async (c) => {
  const authContext = c.get("auth");
  const startDate = c.req.query("start");
  const endDate = c.req.query("end");

  // Build date filter
  const dateFilters = [eq(chatEvents.tenantId, authContext.tenantId!)];
  if (startDate) {
    dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
  }
  if (endDate) {
    dateFilters.push(lte(chatEvents.startedAt, new Date(endDate)));
  }

  const result = await withRequestRLS(c, async (tx) => {
    // Get aggregated stats
    const stats = await tx
      .select({
        totalRequests: sql<number>`count(*)`,
        successfulRequests: sql<number>`count(*) filter (where status = 'ok')`,
        errorRequests: sql<number>`count(*) filter (where status = 'error')`,
        rateLimitedRequests: sql<number>`count(*) filter (where status = 'rate_limited')`,
        avgLatencyMs: sql<number>`avg(latency_ms)`,
        totalPromptTokens: sql<number>`sum(prompt_tokens)`,
        totalCompletionTokens: sql<number>`sum(completion_tokens)`,
      })
      .from(chatEvents)
      .where(and(...dateFilters));

    // Get per-agent breakdown
    const agentStats = await tx
      .select({
        agentId: chatEvents.agentId,
        agentName: agents.name,
        requests: sql<number>`count(*)`,
        avgLatency: sql<number>`avg(latency_ms)`,
      })
      .from(chatEvents)
      .innerJoin(agents, eq(agents.id, chatEvents.agentId))
      .where(and(...dateFilters))
      .groupBy(chatEvents.agentId, agents.name)
      .orderBy(desc(sql`count(*)`));

    // Get current month usage
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usage = await tx.query.tenantUsage.findFirst({
      where: and(
        eq(tenantUsage.tenantId, authContext.tenantId!),
        eq(tenantUsage.month, currentMonth)
      ),
    });

    return { stats, agentStats, usage, currentMonth };
  });

  return c.json({
    summary: result.stats[0],
    byAgent: result.agentStats,
    monthlyUsage: result.usage || {
      month: result.currentMonth,
      uploadedDocs: 0,
      scrapedPages: 0,
      chatRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
    },
  });
});
