/* The admin Overview's queries (A1). Each part of the page loads on its own, so one failure doesn't hide the rest. */
import type { QueryClient } from "@tanstack/react-query";
import { api, unwrap } from "@/api/client";

export const overviewQuery = () => ({
  queryKey: ["admin", "overview"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/overview")),
  staleTime: 30_000,
});

export const attentionQuery = () => ({
  queryKey: ["admin", "attention"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/attention")),
  staleTime: 60_000,
});

export const publicAccessQuery = () => ({
  queryKey: ["admin", "public-access"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/public-access")),
});

export const publicPolicyQuery = () => ({
  queryKey: ["admin", "moderation", "policy", "public"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/moderation/policies/{audience}", { params: { path: { audience: "public" } } })),
});

export const profilesQuery = () => ({
  queryKey: ["admin", "embedding-profiles"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/embedding-profiles")),
});

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** The last 14 UTC days of platform analytics (the answers sparkline and the 7-day delta). */
export const recentAnalyticsQuery = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 13 * 86_400_000);
  return {
    queryKey: ["admin", "analytics", utcDay(from), utcDay(to)],
    queryFn: async () => unwrap(await api.GET("/v1/admin/analytics", { params: { query: { from: utcDay(from), to: utcDay(to) } } })),
    staleTime: 60_000,
  };
};

/** The last 5 audit entries other than sign-ins, MCP tool calls and OAuth sign-ins for MCP clients, which change nothing (Recent changes). */
export const recentChangesQuery = () => ({
  queryKey: ["admin", "audit", "recent"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/audit", { params: { query: { excludeAction: "auth.,mcp.,oauth.", limit: 5 } } })),
});

/*
 * The Features card's settings (v0.2.1 I2), under the same keys as their
 * own pages, so a change on either side shows on both.
 */
export const evaluationSettingsQuery = () => ({
  queryKey: ["admin", "evaluations"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/evaluations")),
  staleTime: 30_000,
});

export const answerCacheSettingsQuery = () => ({
  queryKey: ["admin", "answer-cache"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/answer-cache")),
  staleTime: 30_000,
});

export const mcpSettingsQuery = () => ({
  queryKey: ["admin", "mcp"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/mcp")),
  staleTime: 30_000,
});

export const parsingSettingsQuery = () => ({
  queryKey: ["admin", "parsing"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/parsing")),
});

export const systemOneSettingsQuery = () => ({
  queryKey: ["admin", "systemone"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/systemone")),
});

export const maintenanceSettingsQuery = () => ({
  queryKey: ["admin", "maintenance"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/maintenance")),
});

/*
 * The Features card, the setup checklist and the public-access rows of Needs attention in one request
 * (GET /v1/admin/features, AD-03): about 17 requests on every load before. The switches' settings come with their
 * revisions, so the response primes their own queries and switching needs no extra read.
 */
export const featuresQuery = (qc: QueryClient) => ({
  queryKey: ["admin", "features"],
  queryFn: async () => {
    const f = unwrap(await api.GET("/v1/admin/features"));
    qc.setQueryData(evaluationSettingsQuery().queryKey, f.evaluations);
    qc.setQueryData(mcpSettingsQuery().queryKey, f.mcp);
    if (f.answerCache) qc.setQueryData(answerCacheSettingsQuery().queryKey, f.answerCache);
    return f;
  },
  staleTime: 30_000,
});
