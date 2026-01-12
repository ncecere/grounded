import { Hono } from "hono";
import { db } from "@grounded/db";
import {
  tenants,
  chatEvents,
  tenantUsage,
  tenantQuotas,
  knowledgeBases,
  agents,
  sources,
  kbChunks,
  tenantMemberships,
} from "@grounded/db/schema";
import { sql, isNull, and, gte, lte, eq, desc } from "drizzle-orm";
import { auth, requireSystemAdmin } from "../../middleware/auth";
import { NotFoundError } from "../../middleware/error-handler";

export const adminAnalyticsRoutes = new Hono();

// All routes require system admin
adminAnalyticsRoutes.use("*", auth(), requireSystemAdmin());

// ============================================================================
// System Overview Analytics
// ============================================================================

adminAnalyticsRoutes.get("/overview", async (c) => {
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Build date filter
  const dateFilters: ReturnType<typeof gte>[] = [];
  if (startDate) {
    dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    dateFilters.push(lte(chatEvents.startedAt, endOfDay));
  }

  // Overall stats
  const [overallStats] = await db
    .select({
      totalQueries: sql<number>`count(*)::int`,
      successfulQueries: sql<number>`count(*) filter (where status = 'ok')::int`,
      errorQueries: sql<number>`count(*) filter (where status = 'error')::int`,
      rateLimitedQueries: sql<number>`count(*) filter (where status = 'rate_limited')::int`,
      avgLatencyMs: sql<number>`coalesce(avg(latency_ms), 0)::int`,
      totalPromptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)::bigint`,
      totalCompletionTokens: sql<number>`coalesce(sum(completion_tokens), 0)::bigint`,
      uniqueTenants: sql<number>`count(distinct tenant_id)::int`,
      uniqueAgents: sql<number>`count(distinct agent_id)::int`,
    })
    .from(chatEvents)
    .where(dateFilters.length > 0 ? and(...dateFilters) : undefined);

  // Queries by day
  const queriesByDay = await db
    .select({
      date: sql<string>`to_char(started_at, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where status = 'error')::int`,
    })
    .from(chatEvents)
    .where(dateFilters.length > 0 ? and(...dateFilters) : undefined)
    .groupBy(sql`to_char(started_at, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(started_at, 'YYYY-MM-DD')`);

  // Queries by channel
  const queriesByChannel = await db
    .select({
      channel: chatEvents.channel,
      count: sql<number>`count(*)::int`,
    })
    .from(chatEvents)
    .where(dateFilters.length > 0 ? and(...dateFilters) : undefined)
    .groupBy(chatEvents.channel);

  // Top tenants by query count
  const topTenants = await db
    .select({
      tenantId: chatEvents.tenantId,
      tenantName: tenants.name,
      queries: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${chatEvents.status} = 'error')::int`,
    })
    .from(chatEvents)
    .innerJoin(tenants, eq(tenants.id, chatEvents.tenantId))
    .where(dateFilters.length > 0 ? and(...dateFilters) : undefined)
    .groupBy(chatEvents.tenantId, tenants.name)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  return c.json({
    overview: {
      totalQueries: overallStats.totalQueries,
      successfulQueries: overallStats.successfulQueries,
      errorQueries: overallStats.errorQueries,
      rateLimitedQueries: overallStats.rateLimitedQueries,
      errorRate: overallStats.totalQueries > 0
        ? Number(((overallStats.errorQueries / overallStats.totalQueries) * 100).toFixed(2))
        : 0,
      avgLatencyMs: overallStats.avgLatencyMs,
      totalTokens: Number(overallStats.totalPromptTokens) + Number(overallStats.totalCompletionTokens),
      promptTokens: Number(overallStats.totalPromptTokens),
      completionTokens: Number(overallStats.totalCompletionTokens),
      activeTenants: overallStats.uniqueTenants,
      activeAgents: overallStats.uniqueAgents,
    },
    queriesByDay: queriesByDay.map(d => ({
      date: d.date,
      count: d.count,
      errors: d.errors,
    })),
    queriesByChannel: queriesByChannel.map(c => ({
      channel: c.channel,
      count: c.count,
    })),
    topTenants: topTenants.map(t => ({
      tenantId: t.tenantId,
      tenantName: t.tenantName,
      queries: t.queries,
      errors: t.errors,
      errorRate: t.queries > 0 ? Number(((t.errors / t.queries) * 100).toFixed(2)) : 0,
    })),
  });
});

// ============================================================================
// Tenants Comparison with Health Flags
// ============================================================================

adminAnalyticsRoutes.get("/tenants", async (c) => {
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Build date filter for chat events
  const dateFilters: ReturnType<typeof gte>[] = [];
  if (startDate) {
    dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    dateFilters.push(lte(chatEvents.startedAt, endOfDay));
  }

  // Get all tenants with their quotas
  const allTenants = await db.query.tenants.findMany({
    where: isNull(tenants.deletedAt),
    orderBy: (tenants, { asc }) => [asc(tenants.name)],
  });

  // Get quotas for all tenants
  const allQuotas = await db.query.tenantQuotas.findMany();
  const quotaMap = new Map(allQuotas.map(q => [q.tenantId, q]));

  // Get current month usage for all tenants
  const currentMonth = new Date().toISOString().slice(0, 7);
  const allUsage = await db.query.tenantUsage.findMany({
    where: eq(tenantUsage.month, currentMonth),
  });
  const usageMap = new Map(allUsage.map(u => [u.tenantId, u]));

  // Get chat stats per tenant for the date range
  const tenantChatStats = await db
    .select({
      tenantId: chatEvents.tenantId,
      totalQueries: sql<number>`count(*)::int`,
      successfulQueries: sql<number>`count(*) filter (where status = 'ok')::int`,
      errorQueries: sql<number>`count(*) filter (where status = 'error')::int`,
      rateLimitedQueries: sql<number>`count(*) filter (where status = 'rate_limited')::int`,
      avgLatencyMs: sql<number>`coalesce(avg(latency_ms), 0)::int`,
      lastQueryAt: sql<string>`max(started_at)`,
    })
    .from(chatEvents)
    .where(dateFilters.length > 0 ? and(...dateFilters) : undefined)
    .groupBy(chatEvents.tenantId);

  const statsMap = new Map(tenantChatStats.map(s => [s.tenantId, s]));

  // Get resource counts per tenant
  const kbCounts = await db
    .select({
      tenantId: knowledgeBases.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(knowledgeBases)
    .where(isNull(knowledgeBases.deletedAt))
    .groupBy(knowledgeBases.tenantId);
  const kbCountMap = new Map(kbCounts.map(k => [k.tenantId!, k.count]));

  const agentCounts = await db
    .select({
      tenantId: agents.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(agents)
    .where(isNull(agents.deletedAt))
    .groupBy(agents.tenantId);
  const agentCountMap = new Map(agentCounts.map(a => [a.tenantId, a.count]));

  // Get member counts per tenant
  const memberCounts = await db
    .select({
      tenantId: tenantMemberships.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(tenantMemberships)
    .where(isNull(tenantMemberships.deletedAt))
    .groupBy(tenantMemberships.tenantId);
  const memberCountMap = new Map(memberCounts.map(m => [m.tenantId, m.count]));

  // Build tenant data with health flags
  const tenantsWithHealth = allTenants.map(tenant => {
    const quota = quotaMap.get(tenant.id);
    const usage = usageMap.get(tenant.id);
    const stats = statsMap.get(tenant.id);
    const kbCount = kbCountMap.get(tenant.id) || 0;
    const agentCount = agentCountMap.get(tenant.id) || 0;
    const memberCount = memberCountMap.get(tenant.id) || 0;

    // Calculate health flags
    const flags: string[] = [];

    // High error rate (>10%)
    if (stats && stats.totalQueries > 10) {
      const errorRate = (stats.errorQueries / stats.totalQueries) * 100;
      if (errorRate > 10) {
        flags.push("high_error_rate");
      }
    }

    // Approaching KB quota (>80%)
    if (quota && kbCount > 0) {
      const kbUsagePercent = (kbCount / quota.maxKbs) * 100;
      if (kbUsagePercent >= 80) {
        flags.push("kb_quota_warning");
      }
    }

    // Approaching agent quota (>80%)
    if (quota && agentCount > 0) {
      const agentUsagePercent = (agentCount / quota.maxAgents) * 100;
      if (agentUsagePercent >= 80) {
        flags.push("agent_quota_warning");
      }
    }

    // Approaching upload quota (>80%)
    if (quota && usage) {
      const uploadUsagePercent = (usage.uploadedDocs / quota.maxUploadedDocsPerMonth) * 100;
      if (uploadUsagePercent >= 80) {
        flags.push("upload_quota_warning");
      }
    }

    // Approaching scrape quota (>80%)
    if (quota && usage) {
      const scrapeUsagePercent = (usage.scrapedPages / quota.maxScrapedPagesPerMonth) * 100;
      if (scrapeUsagePercent >= 80) {
        flags.push("scrape_quota_warning");
      }
    }

    // High rate limiting
    if (stats && stats.totalQueries > 10) {
      const rateLimitPercent = (stats.rateLimitedQueries / stats.totalQueries) * 100;
      if (rateLimitPercent > 5) {
        flags.push("high_rate_limiting");
      }
    }

    // Low activity (no queries in last 7 days, but tenant has agents)
    if (agentCount > 0) {
      const lastQuery = stats?.lastQueryAt ? new Date(stats.lastQueryAt) : null;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (!lastQuery || lastQuery < sevenDaysAgo) {
        flags.push("low_activity");
      }
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      createdAt: tenant.createdAt,
      members: memberCount,
      resources: {
        kbs: kbCount,
        agents: agentCount,
        maxKbs: quota?.maxKbs || 10,
        maxAgents: quota?.maxAgents || 10,
      },
      usage: {
        totalQueries: stats?.totalQueries || 0,
        successfulQueries: stats?.successfulQueries || 0,
        errorQueries: stats?.errorQueries || 0,
        rateLimitedQueries: stats?.rateLimitedQueries || 0,
        errorRate: stats && stats.totalQueries > 0
          ? Number(((stats.errorQueries / stats.totalQueries) * 100).toFixed(2))
          : 0,
        avgLatencyMs: stats?.avgLatencyMs || 0,
        lastQueryAt: stats?.lastQueryAt || null,
        uploadedDocs: usage?.uploadedDocs || 0,
        scrapedPages: usage?.scrapedPages || 0,
        maxUploadedDocs: quota?.maxUploadedDocsPerMonth || 1000,
        maxScrapedPages: quota?.maxScrapedPagesPerMonth || 1000,
      },
      flags,
      healthScore: calculateHealthScore(flags),
    };
  });

  // Sort by health score (worst first) then by name
  tenantsWithHealth.sort((a, b) => {
    if (a.healthScore !== b.healthScore) {
      return a.healthScore - b.healthScore;
    }
    return a.name.localeCompare(b.name);
  });

  return c.json({
    tenants: tenantsWithHealth,
    summary: {
      total: tenantsWithHealth.length,
      healthy: tenantsWithHealth.filter(t => t.flags.length === 0).length,
      withWarnings: tenantsWithHealth.filter(t => t.flags.length > 0).length,
      flagCounts: {
        high_error_rate: tenantsWithHealth.filter(t => t.flags.includes("high_error_rate")).length,
        kb_quota_warning: tenantsWithHealth.filter(t => t.flags.includes("kb_quota_warning")).length,
        agent_quota_warning: tenantsWithHealth.filter(t => t.flags.includes("agent_quota_warning")).length,
        upload_quota_warning: tenantsWithHealth.filter(t => t.flags.includes("upload_quota_warning")).length,
        scrape_quota_warning: tenantsWithHealth.filter(t => t.flags.includes("scrape_quota_warning")).length,
        high_rate_limiting: tenantsWithHealth.filter(t => t.flags.includes("high_rate_limiting")).length,
        low_activity: tenantsWithHealth.filter(t => t.flags.includes("low_activity")).length,
      },
    },
  });
});

// ============================================================================
// Single Tenant Detail
// ============================================================================

adminAnalyticsRoutes.get("/tenants/:tenantId", async (c) => {
  const tenantId = c.req.param("tenantId");
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Verify tenant exists
  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)),
  });

  if (!tenant) {
    throw new NotFoundError("Tenant");
  }

  // Build date filter
  const dateFilters: ReturnType<typeof gte>[] = [eq(chatEvents.tenantId, tenantId)];
  if (startDate) {
    dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    dateFilters.push(lte(chatEvents.startedAt, endOfDay));
  }

  // Get tenant quota
  const quota = await db.query.tenantQuotas.findFirst({
    where: eq(tenantQuotas.tenantId, tenantId),
  });

  // Get current month usage
  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = await db.query.tenantUsage.findFirst({
    where: and(
      eq(tenantUsage.tenantId, tenantId),
      eq(tenantUsage.month, currentMonth)
    ),
  });

  // Get overall stats
  const [stats] = await db
    .select({
      totalQueries: sql<number>`count(*)::int`,
      successfulQueries: sql<number>`count(*) filter (where status = 'ok')::int`,
      errorQueries: sql<number>`count(*) filter (where status = 'error')::int`,
      rateLimitedQueries: sql<number>`count(*) filter (where status = 'rate_limited')::int`,
      avgLatencyMs: sql<number>`coalesce(avg(latency_ms), 0)::int`,
      p50LatencyMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by latency_ms), 0)::int`,
      p95LatencyMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by latency_ms), 0)::int`,
      p99LatencyMs: sql<number>`coalesce(percentile_cont(0.99) within group (order by latency_ms), 0)::int`,
      totalPromptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)::bigint`,
      totalCompletionTokens: sql<number>`coalesce(sum(completion_tokens), 0)::bigint`,
    })
    .from(chatEvents)
    .where(and(...dateFilters));

  // Get queries by day
  const queriesByDay = await db
    .select({
      date: sql<string>`to_char(started_at, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where status = 'error')::int`,
      avgLatency: sql<number>`coalesce(avg(latency_ms), 0)::int`,
    })
    .from(chatEvents)
    .where(and(...dateFilters))
    .groupBy(sql`to_char(started_at, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(started_at, 'YYYY-MM-DD')`);

  // Get queries by channel
  const queriesByChannel = await db
    .select({
      channel: chatEvents.channel,
      count: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where status = 'error')::int`,
    })
    .from(chatEvents)
    .where(and(...dateFilters))
    .groupBy(chatEvents.channel);

  // Get per-agent breakdown
  const agentStats = await db
    .select({
      agentId: chatEvents.agentId,
      agentName: agents.name,
      queries: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${chatEvents.status} = 'error')::int`,
      avgLatency: sql<number>`coalesce(avg(${chatEvents.latencyMs}), 0)::int`,
    })
    .from(chatEvents)
    .innerJoin(agents, eq(agents.id, chatEvents.agentId))
    .where(and(...dateFilters))
    .groupBy(chatEvents.agentId, agents.name)
    .orderBy(desc(sql`count(*)`));

  // Get resource counts
  const [kbCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeBases)
    .where(and(
      eq(knowledgeBases.tenantId, tenantId),
      isNull(knowledgeBases.deletedAt)
    ));

  const [agentCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agents)
    .where(and(
      eq(agents.tenantId, tenantId),
      isNull(agents.deletedAt)
    ));

  const [sourceCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sources)
    .where(and(
      eq(sources.tenantId, tenantId),
      isNull(sources.deletedAt)
    ));

  const [chunkCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(kbChunks)
    .where(and(
      eq(kbChunks.tenantId, tenantId),
      isNull(kbChunks.deletedAt)
    ));

  const [memberCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tenantMemberships)
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      isNull(tenantMemberships.deletedAt)
    ));

  // Get historical usage (last 6 months)
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sixMonthsAgoStr = sixMonthsAgo.toISOString().slice(0, 7);

  const historicalUsage = await db
    .select()
    .from(tenantUsage)
    .where(and(
      eq(tenantUsage.tenantId, tenantId),
      gte(tenantUsage.month, sixMonthsAgoStr)
    ))
    .orderBy(tenantUsage.month);

  return c.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      createdAt: tenant.createdAt,
    },
    resources: {
      members: memberCount.count,
      kbs: kbCount.count,
      agents: agentCount.count,
      sources: sourceCount.count,
      chunks: chunkCount.count,
    },
    quotas: {
      maxKbs: quota?.maxKbs || 10,
      maxAgents: quota?.maxAgents || 10,
      maxUploadedDocsPerMonth: quota?.maxUploadedDocsPerMonth || 1000,
      maxScrapedPagesPerMonth: quota?.maxScrapedPagesPerMonth || 1000,
      chatRateLimitPerMinute: quota?.chatRateLimitPerMinute || 60,
    },
    currentUsage: {
      month: currentMonth,
      uploadedDocs: usage?.uploadedDocs || 0,
      scrapedPages: usage?.scrapedPages || 0,
      chatRequests: usage?.chatRequests || 0,
      promptTokens: usage?.promptTokens || 0,
      completionTokens: usage?.completionTokens || 0,
    },
    stats: {
      totalQueries: stats.totalQueries,
      successfulQueries: stats.successfulQueries,
      errorQueries: stats.errorQueries,
      rateLimitedQueries: stats.rateLimitedQueries,
      errorRate: stats.totalQueries > 0
        ? Number(((stats.errorQueries / stats.totalQueries) * 100).toFixed(2))
        : 0,
      avgLatencyMs: stats.avgLatencyMs,
      p50LatencyMs: stats.p50LatencyMs,
      p95LatencyMs: stats.p95LatencyMs,
      p99LatencyMs: stats.p99LatencyMs,
      totalTokens: Number(stats.totalPromptTokens) + Number(stats.totalCompletionTokens),
      promptTokens: Number(stats.totalPromptTokens),
      completionTokens: Number(stats.totalCompletionTokens),
    },
    queriesByDay: queriesByDay.map(d => ({
      date: d.date,
      count: d.count,
      errors: d.errors,
      avgLatency: d.avgLatency,
    })),
    queriesByChannel: queriesByChannel.map(c => ({
      channel: c.channel,
      count: c.count,
      errors: c.errors,
    })),
    byAgent: agentStats.map(a => ({
      agentId: a.agentId,
      agentName: a.agentName,
      queries: a.queries,
      errors: a.errors,
      errorRate: a.queries > 0 ? Number(((a.errors / a.queries) * 100).toFixed(2)) : 0,
      avgLatency: a.avgLatency,
    })),
    historicalUsage: historicalUsage.map(u => ({
      month: u.month,
      uploadedDocs: u.uploadedDocs,
      scrapedPages: u.scrapedPages,
      chatRequests: u.chatRequests,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
    })),
  });
});

// ============================================================================
// Export CSV
// ============================================================================

adminAnalyticsRoutes.get("/export/overview", async (c) => {
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");

  // Build date filter
  const dateFilters: ReturnType<typeof gte>[] = [];
  if (startDate) {
    dateFilters.push(gte(chatEvents.startedAt, new Date(startDate)));
  }
  if (endDate) {
    const endOfDay = new Date(endDate);
    endOfDay.setHours(23, 59, 59, 999);
    dateFilters.push(lte(chatEvents.startedAt, endOfDay));
  }

  // Get daily stats for export
  const dailyStats = await db
    .select({
      date: sql<string>`to_char(started_at, 'YYYY-MM-DD')`,
      totalQueries: sql<number>`count(*)::int`,
      successfulQueries: sql<number>`count(*) filter (where status = 'ok')::int`,
      errorQueries: sql<number>`count(*) filter (where status = 'error')::int`,
      rateLimitedQueries: sql<number>`count(*) filter (where status = 'rate_limited')::int`,
      avgLatencyMs: sql<number>`coalesce(avg(latency_ms), 0)::int`,
      promptTokens: sql<number>`coalesce(sum(prompt_tokens), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(completion_tokens), 0)::int`,
    })
    .from(chatEvents)
    .where(dateFilters.length > 0 ? and(...dateFilters) : undefined)
    .groupBy(sql`to_char(started_at, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(started_at, 'YYYY-MM-DD')`);

  // Build CSV
  const headers = [
    "Date",
    "Total Queries",
    "Successful",
    "Errors",
    "Rate Limited",
    "Avg Latency (ms)",
    "Prompt Tokens",
    "Completion Tokens",
  ];

  const rows = dailyStats.map(d => [
    d.date,
    d.totalQueries,
    d.successfulQueries,
    d.errorQueries,
    d.rateLimitedQueries,
    d.avgLatencyMs,
    d.promptTokens,
    d.completionTokens,
  ]);

  const csv = [
    headers.join(","),
    ...rows.map(row => row.join(",")),
  ].join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="analytics-overview-${startDate || "all"}-${endDate || "all"}.csv"`);
  return c.text(csv);
});

adminAnalyticsRoutes.get("/export/tenants", async (c) => {
  // Get all tenants with their stats
  const allTenants = await db.query.tenants.findMany({
    where: isNull(tenants.deletedAt),
  });

  // Get current month usage
  const currentMonth = new Date().toISOString().slice(0, 7);
  const allUsage = await db.query.tenantUsage.findMany({
    where: eq(tenantUsage.month, currentMonth),
  });
  const usageMap = new Map(allUsage.map(u => [u.tenantId, u]));

  // Get quotas
  const allQuotas = await db.query.tenantQuotas.findMany();
  const quotaMap = new Map(allQuotas.map(q => [q.tenantId, q]));

  // Get resource counts
  const kbCounts = await db
    .select({
      tenantId: knowledgeBases.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(knowledgeBases)
    .where(isNull(knowledgeBases.deletedAt))
    .groupBy(knowledgeBases.tenantId);
  const kbCountMap = new Map(kbCounts.map(k => [k.tenantId!, k.count]));

  const agentCounts = await db
    .select({
      tenantId: agents.tenantId,
      count: sql<number>`count(*)::int`,
    })
    .from(agents)
    .where(isNull(agents.deletedAt))
    .groupBy(agents.tenantId);
  const agentCountMap = new Map(agentCounts.map(a => [a.tenantId, a.count]));

  // Get chat stats
  const tenantChatStats = await db
    .select({
      tenantId: chatEvents.tenantId,
      totalQueries: sql<number>`count(*)::int`,
      errorQueries: sql<number>`count(*) filter (where status = 'error')::int`,
      avgLatencyMs: sql<number>`coalesce(avg(latency_ms), 0)::int`,
    })
    .from(chatEvents)
    .groupBy(chatEvents.tenantId);
  const statsMap = new Map(tenantChatStats.map(s => [s.tenantId, s]));

  // Build CSV
  const headers = [
    "Tenant ID",
    "Tenant Name",
    "Slug",
    "Created At",
    "KBs",
    "Max KBs",
    "Agents",
    "Max Agents",
    "Total Queries",
    "Error Queries",
    "Error Rate %",
    "Avg Latency (ms)",
    "Uploaded Docs (This Month)",
    "Max Uploaded Docs",
    "Scraped Pages (This Month)",
    "Max Scraped Pages",
  ];

  const rows = allTenants.map(t => {
    const quota = quotaMap.get(t.id);
    const usage = usageMap.get(t.id);
    const stats = statsMap.get(t.id);
    const kbCount = kbCountMap.get(t.id) || 0;
    const agentCount = agentCountMap.get(t.id) || 0;

    return [
      t.id,
      `"${t.name.replace(/"/g, '""')}"`,
      t.slug,
      t.createdAt.toISOString(),
      kbCount,
      quota?.maxKbs || 10,
      agentCount,
      quota?.maxAgents || 10,
      stats?.totalQueries || 0,
      stats?.errorQueries || 0,
      stats && stats.totalQueries > 0
        ? ((stats.errorQueries / stats.totalQueries) * 100).toFixed(2)
        : 0,
      stats?.avgLatencyMs || 0,
      usage?.uploadedDocs || 0,
      quota?.maxUploadedDocsPerMonth || 1000,
      usage?.scrapedPages || 0,
      quota?.maxScrapedPagesPerMonth || 1000,
    ];
  });

  const csv = [
    headers.join(","),
    ...rows.map(row => row.join(",")),
  ].join("\n");

  c.header("Content-Type", "text/csv");
  c.header("Content-Disposition", `attachment; filename="tenants-analytics-${currentMonth}.csv"`);
  return c.text(csv);
});

// ============================================================================
// Helper Functions
// ============================================================================

function calculateHealthScore(flags: string[]): number {
  // Score from 0-100, higher is better
  // Each flag reduces the score
  const flagPenalties: Record<string, number> = {
    high_error_rate: 25,
    kb_quota_warning: 10,
    agent_quota_warning: 10,
    upload_quota_warning: 15,
    scrape_quota_warning: 15,
    high_rate_limiting: 20,
    low_activity: 5,
  };

  let score = 100;
  for (const flag of flags) {
    score -= flagPenalties[flag] || 0;
  }
  return Math.max(0, score);
}
