/* The admin Overview's queries (A1). Each part of the page loads on its own, so one failure doesn't hide the rest. */
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
});

export const mcpSettingsQuery = () => ({
  queryKey: ["admin", "mcp"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/mcp")),
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
