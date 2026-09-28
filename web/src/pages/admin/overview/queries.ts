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

export const recentChangesQuery = () => ({
  queryKey: ["admin", "audit", "recent"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/audit", { params: { query: { excludeAction: "auth.", limit: 8 } } })),
});
