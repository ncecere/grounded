/*
 * Webhooks (v0.6.0, F3): the types, queries and calls shared by Team settings → Webhooks and Admin → Webhooks. The two kinds of webhook
 * (a team's, and the platform's) have the same operations under different paths; `WebhookScope` picks which.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";

export type Webhook = Schemas["Webhook"];
export type WebhookInput = Schemas["WebhookInput"];
export type WebhookCreated = Schemas["WebhookCreated"];
export type WebhookDelivery = Schemas["WebhookDelivery"];
export type WebhookEventType = Schemas["WebhookEventType"];
export type WebhookDestination = Schemas["WebhookDestination"];

export type WebhookScope = { kind: "team"; team: string } | { kind: "platform" };

export const webhooksKey = (s: WebhookScope) => ["webhooks", s.kind === "team" ? s.team : "platform"];
export const deliveriesKey = (s: WebhookScope, id: string) => [...webhooksKey(s), "deliveries", id];
export const destinationsKey = ["webhook-destinations"];
export const eventsKey = ["webhook-events"];

export const webhookSettingsQuery = () => ({
  queryKey: ["admin", "webhook-settings"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/settings/webhooks")),
  staleTime: 30_000,
});

/** The approved destination patterns (for the people who choose an address, and for the admins' own table). */
export const destinationsQuery = () => ({
  queryKey: destinationsKey,
  queryFn: async () => unwrap(await api.GET("/v1/webhook-destinations")),
});

/** The events a webhook can subscribe to, with their scope and description. */
export const eventsQuery = () => ({
  queryKey: eventsKey,
  queryFn: async () => unwrap(await api.GET("/v1/webhook-events")),
  staleTime: 5 * 60_000,
});

export const useWebhooks = (s: WebhookScope) =>
  useQuery({
    queryKey: webhooksKey(s),
    queryFn: async () =>
      s.kind === "team" ? unwrap(await api.GET("/v1/teams/{team}/webhooks", { params: { path: { team: s.team } } })) : unwrap(await api.GET("/v1/admin/webhooks")),
  });

/** The last 50 deliveries; re-read every few seconds while one is still pending. */
export const useDeliveries = (s: WebhookScope, id: string) =>
  useQuery({
    queryKey: deliveriesKey(s, id),
    refetchInterval: (q) => (q.state.data?.some((d) => d.status === "pending") ? 5000 : false),
    queryFn: async () =>
      s.kind === "team"
        ? unwrap(await api.GET("/v1/teams/{team}/webhooks/{webhookId}/deliveries", { params: { path: { team: s.team, webhookId: id } } }))
        : unwrap(await api.GET("/v1/admin/webhooks/{webhookId}/deliveries", { params: { path: { webhookId: id } } })),
  });

/** The calls that change a webhook, for one scope. */
export const webhookCalls = (s: WebhookScope) => ({
  create: async (body: WebhookInput) =>
    s.kind === "team" ? unwrap(await api.POST("/v1/teams/{team}/webhooks", { params: { path: { team: s.team } }, body })) : unwrap(await api.POST("/v1/admin/webhooks", { body })),
  update: async (w: Webhook, body: WebhookInput) =>
    s.kind === "team"
      ? unwrap(await api.PATCH("/v1/teams/{team}/webhooks/{webhookId}", { params: { path: { team: s.team, webhookId: w.id }, header: ifMatch(w.revision) }, body }))
      : unwrap(await api.PATCH("/v1/admin/webhooks/{webhookId}", { params: { path: { webhookId: w.id }, header: ifMatch(w.revision) }, body })),
  remove: async (w: Webhook) =>
    s.kind === "team"
      ? unwrap(await api.DELETE("/v1/teams/{team}/webhooks/{webhookId}", { params: { path: { team: s.team, webhookId: w.id } } }))
      : unwrap(await api.DELETE("/v1/admin/webhooks/{webhookId}", { params: { path: { webhookId: w.id } } })),
  rotate: async (w: Webhook) =>
    s.kind === "team"
      ? unwrap(await api.POST("/v1/teams/{team}/webhooks/{webhookId}/rotate-secret", { params: { path: { team: s.team, webhookId: w.id } } }))
      : unwrap(await api.POST("/v1/admin/webhooks/{webhookId}/rotate-secret", { params: { path: { webhookId: w.id } } })),
  test: async (w: Webhook) =>
    s.kind === "team"
      ? unwrap(await api.POST("/v1/teams/{team}/webhooks/{webhookId}/test", { params: { path: { team: s.team, webhookId: w.id } } }))
      : unwrap(await api.POST("/v1/admin/webhooks/{webhookId}/test", { params: { path: { webhookId: w.id } } })),
  redeliver: async (w: Webhook, d: WebhookDelivery) =>
    s.kind === "team"
      ? unwrap(await api.POST("/v1/teams/{team}/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver", { params: { path: { team: s.team, webhookId: w.id, deliveryId: d.id } } }))
      : unwrap(await api.POST("/v1/admin/webhooks/{webhookId}/deliveries/{deliveryId}/redeliver", { params: { path: { webhookId: w.id, deliveryId: d.id } } })),
});

/** Whether an approved pattern covers the host of an address ("*.example.edu" covers example.edu and its subdomains; a name that host only). */
export function destinationCovers(patterns: WebhookDestination[], address: string): boolean {
  let host: string;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return true; // not an address yet: the server says what is wrong with it
  }
  return patterns.some(({ pattern }) => (pattern.startsWith("*.") ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : host === pattern));
}
