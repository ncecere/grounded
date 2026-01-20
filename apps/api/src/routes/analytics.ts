import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "@grounded/db";
import {
  agentTestSuites,
  agents,
  chatEvents,
  tenantUsage,
  testCases,
  testSuiteRuns,
} from "@grounded/db/schema";
import { eq, and, isNull, sql, gte, lte, desc } from "drizzle-orm";
import { auth, requireTenant, withRequestRLS } from "../middleware/auth";
import { BadRequestError, NotFoundError } from "../middleware/error-handler";
import {
  buildRegressionEntries,
  getTrendDirection,
  type TestSuiteRunSnapshot,
} from "../services/test-suite-analytics";

export const analyticsRoutes = new Hono();

const testSuiteAnalyticsQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

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

// ============================================================================
// Test Suite Analytics
// ============================================================================

analyticsRoutes.get(
  "/test-suites",
  auth(),
  requireTenant(),
  zValidator("query", testSuiteAnalyticsQuerySchema),
  async (c) => {
    const authContext = c.get("auth");
    const query = c.req.valid("query");
    const rangeEnd = query.endDate ? new Date(query.endDate) : new Date();

    if (Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestError("Invalid end date");
    }

    rangeEnd.setHours(23, 59, 59, 999);

    const rangeStart = query.startDate ? new Date(query.startDate) : new Date(rangeEnd);
    if (Number.isNaN(rangeStart.getTime())) {
      throw new BadRequestError("Invalid start date");
    }

    rangeStart.setHours(0, 0, 0, 0);
    if (!query.startDate) {
      rangeStart.setDate(rangeStart.getDate() - 29);
    }

    if (rangeStart > rangeEnd) {
      throw new BadRequestError("Start date must be before end date");
    }

    const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
    const rangeDays = Math.max(1, Math.round(rangeMs / (1000 * 60 * 60 * 24)) + 1);
    const previousEnd = new Date(rangeStart);
    previousEnd.setMilliseconds(previousEnd.getMilliseconds() - 1);
    const previousStart = new Date(rangeStart);
    previousStart.setDate(previousStart.getDate() - rangeDays);

    const result = await withRequestRLS(c, async (tx) => {
      const suiteFilter = and(
        eq(agentTestSuites.tenantId, authContext.tenantId!),
        isNull(agentTestSuites.deletedAt)
      );
      const caseFilter = and(
        eq(testCases.tenantId, authContext.tenantId!),
        isNull(testCases.deletedAt)
      );
      const runFilter = and(
        eq(testSuiteRuns.tenantId, authContext.tenantId!),
        eq(testSuiteRuns.status, "completed"),
        gte(testSuiteRuns.completedAt, rangeStart),
        lte(testSuiteRuns.completedAt, rangeEnd)
      );

      const [suiteCount, caseCount, runSummary, passRateByDay, agentsSummary, previousAgentSummary, suites, runs] =
        await Promise.all([
          tx
            .select({ count: sql<number>`count(*)` })
            .from(agentTestSuites)
            .where(suiteFilter),
          tx
            .select({ count: sql<number>`count(*)` })
            .from(testCases)
            .where(caseFilter),
          tx
            .select({
              totalRuns: sql<number>`count(*)`,
              overallPassRate: sql<number>`avg(${testSuiteRuns.passedCases}::float / greatest(${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases}, 1) * 100)`,
            })
            .from(testSuiteRuns)
            .where(runFilter),
          tx
            .select({
              date: sql<string>`to_char(${testSuiteRuns.completedAt}, 'YYYY-MM-DD')`,
              passRate: sql<number>`avg(${testSuiteRuns.passedCases}::float / greatest(${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases}, 1) * 100)`,
              totalRuns: sql<number>`count(*)`,
            })
            .from(testSuiteRuns)
            .where(runFilter)
            .groupBy(sql`to_char(${testSuiteRuns.completedAt}, 'YYYY-MM-DD')`)
            .orderBy(sql`to_char(${testSuiteRuns.completedAt}, 'YYYY-MM-DD')`),
          tx
            .select({
              agentId: agents.id,
              agentName: agents.name,
              suiteCount: sql<number>`count(distinct ${agentTestSuites.id})`,
              caseCount: sql<number>`count(distinct ${testCases.id})`,
              runCount: sql<number>`count(distinct ${testSuiteRuns.id})`,
              passRate: sql<number>`avg(${testSuiteRuns.passedCases}::float / greatest(${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases}, 1) * 100)`,
            })
            .from(agents)
            .innerJoin(
              agentTestSuites,
              and(eq(agentTestSuites.agentId, agents.id), isNull(agentTestSuites.deletedAt))
            )
            .leftJoin(
              testCases,
              and(eq(testCases.suiteId, agentTestSuites.id), isNull(testCases.deletedAt))
            )
            .leftJoin(
              testSuiteRuns,
              and(
                eq(testSuiteRuns.suiteId, agentTestSuites.id),
                eq(testSuiteRuns.status, "completed"),
                gte(testSuiteRuns.completedAt, rangeStart),
                lte(testSuiteRuns.completedAt, rangeEnd)
              )
            )
            .where(and(eq(agents.tenantId, authContext.tenantId!), isNull(agents.deletedAt)))
            .groupBy(agents.id, agents.name)
            .orderBy(desc(sql`count(distinct ${testSuiteRuns.id})`)),
          tx
            .select({
              agentId: agents.id,
              passRate: sql<number>`avg(${testSuiteRuns.passedCases}::float / greatest(${testSuiteRuns.totalCases} - ${testSuiteRuns.skippedCases}, 1) * 100)`,
            })
            .from(agents)
            .innerJoin(
              agentTestSuites,
              and(eq(agentTestSuites.agentId, agents.id), isNull(agentTestSuites.deletedAt))
            )
            .leftJoin(
              testSuiteRuns,
              and(
                eq(testSuiteRuns.suiteId, agentTestSuites.id),
                eq(testSuiteRuns.status, "completed"),
                gte(testSuiteRuns.completedAt, previousStart),
                lte(testSuiteRuns.completedAt, previousEnd)
              )
            )
            .where(and(eq(agents.tenantId, authContext.tenantId!), isNull(agents.deletedAt)))
            .groupBy(agents.id),
          tx
            .select({
              id: agentTestSuites.id,
              name: agentTestSuites.name,
              agentId: agentTestSuites.agentId,
            })
            .from(agentTestSuites)
            .where(suiteFilter),
          tx
            .select({
              runId: testSuiteRuns.id,
              suiteId: testSuiteRuns.suiteId,
              completedAt: testSuiteRuns.completedAt,
              passedCases: testSuiteRuns.passedCases,
              totalCases: testSuiteRuns.totalCases,
              skippedCases: testSuiteRuns.skippedCases,
            })
            .from(testSuiteRuns)
            .where(
              and(
                eq(testSuiteRuns.tenantId, authContext.tenantId!),
                eq(testSuiteRuns.status, "completed"),
                gte(testSuiteRuns.completedAt, previousStart),
                lte(testSuiteRuns.completedAt, rangeEnd)
              )
            ),
        ]);

      return {
        suiteCount,
        caseCount,
        runSummary,
        passRateByDay,
        agentsSummary,
        previousAgentSummary,
        suites,
        runs,
      };
    });

    const suiteCount = Number(result.suiteCount[0]?.count ?? 0);
    const caseCount = Number(result.caseCount[0]?.count ?? 0);
    const totalRuns = Number(result.runSummary[0]?.totalRuns ?? 0);
    const overallPassRate = Number(result.runSummary[0]?.overallPassRate ?? 0);

    const previousPassRates = new Map(
      result.previousAgentSummary.map((row) => [
        row.agentId,
        row.passRate === null ? null : Number(row.passRate),
      ])
    );

    const agentStats = result.agentsSummary.map((row) => {
      const passRate = Number(row.passRate ?? 0);
      const previousPassRate = previousPassRates.get(row.agentId) ?? null;
      const passRateChange = previousPassRate === null ? null : passRate - previousPassRate;

      return {
        agentId: row.agentId,
        agentName: row.agentName,
        suiteCount: Number(row.suiteCount ?? 0),
        caseCount: Number(row.caseCount ?? 0),
        runCount: Number(row.runCount ?? 0),
        passRate,
        previousPassRate,
        passRateChange,
        trend: getTrendDirection(passRateChange),
      };
    });

    const agentNames = new Map(
      result.agentsSummary.map((row) => [row.agentId, row.agentName])
    );
    const suiteInfo = new Map(
      result.suites.map((suite) => [suite.id, suite])
    );

    const regressionRuns = result.runs.filter(
      (run): run is TestSuiteRunSnapshot => run.completedAt !== null
    );
    const regressions = buildRegressionEntries(regressionRuns, rangeStart)
      .map((entry) => {
        const suite = suiteInfo.get(entry.suiteId);
        const agentName = suite ? agentNames.get(suite.agentId) : undefined;

        return {
          runId: entry.runId,
          suiteId: entry.suiteId,
          suiteName: suite?.name ?? "Unknown suite",
          agentId: suite?.agentId ?? null,
          agentName: agentName ?? "Unknown agent",
          completedAt: entry.completedAt,
          previousPassRate: entry.previousPassRate,
          currentPassRate: entry.currentPassRate,
          passRateDrop: entry.passRateDrop,
        };
      })
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
      .slice(0, 20);

    return c.json({
      summary: {
        totalSuites: suiteCount,
        totalCases: caseCount,
        totalRuns,
        overallPassRate,
      },
      passRateOverTime: result.passRateByDay.map((row) => ({
        date: row.date,
        passRate: Number(row.passRate) || 0,
        totalRuns: Number(row.totalRuns) || 0,
      })),
      agents: agentStats,
      recentRegressions: regressions,
    });
  }
);
