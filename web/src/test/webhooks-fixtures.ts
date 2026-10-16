/*
 * Webhooks (v0.6.0, F3) test fixtures: webhooks, deliveries, events and destinations, and a small in-memory server for the webhook routes of
 * one scope (a team's or the platform's), so a test can make, change, rotate and delete a webhook and see the list follow.
 */
import type { Schemas } from "../api/client";
import { type Handler, Reply, meFor, shellRoutes } from "./harness";

export type Webhook = Schemas["Webhook"];
export type Delivery = Schemas["WebhookDelivery"];

export const hook = (extra: Partial<Webhook> = {}): Webhook => ({
  id: "w1",
  teamId: "t1",
  url: "https://hooks.example.edu/grounded",
  description: "Registrar notifications",
  events: ["agent.published"],
  secretHint: "ab12",
  enabled: true,
  pausedReason: "",
  consecutiveFailures: 0,
  revision: 3,
  createdAt: "2026-10-14T09:00:00Z",
  updatedAt: "2026-10-14T09:00:00Z",
  ...extra,
});

export const delivery = (extra: Partial<Delivery> = {}): Delivery => ({
  id: "d1",
  webhookId: "w1",
  eventId: "e1",
  eventType: "agent.published",
  status: "delivered",
  attempts: 1,
  lastStatus: 200,
  lastError: "",
  lastAttemptAt: "2026-10-15T09:00:00Z",
  deliveredAt: "2026-10-15T09:00:00Z",
  createdAt: "2026-10-15T09:00:00Z",
  ...extra,
});

export const eventTypes: Schemas["WebhookEventType"][] = [
  { type: "source.synced", scope: "team", description: "A web source finished syncing" },
  { type: "source.sync_failed", scope: "team", description: "A web source's sync failed" },
  { type: "agent.published", scope: "team", description: "An agent was published" },
  { type: "feedback.submitted", scope: "team", description: "Someone rated an answer" },
  { type: "team.created", scope: "platform", description: "A team was created" },
  { type: "team_request.created", scope: "platform", description: "Someone asked for a team" },
];

export const destinations: Schemas["WebhookDestination"][] = [
  { id: "x1", pattern: "hooks.example.edu", note: "Registrar's receiver", createdAt: "2026-10-10T09:00:00Z" },
  { id: "x2", pattern: "*.example.org", note: "", createdAt: "2026-10-11T09:00:00Z" },
];

export const webhookSettings = (extra: Partial<Schemas["WebhookSettings"]> = {}): Schemas["WebhookSettings"] => ({ enabled: true, revision: 4, updatedAt: "2026-10-15T08:00:00Z", ...extra });

/** Routes every webhook page reads: the events and the approved destinations. */
export const catalogRoutes = (): Record<string, Handler> => ({
  "GET /v1/webhook-events": () => eventTypes,
  "GET /v1/webhook-destinations": () => destinations,
});

/** What a test can see of the server: the webhooks as stored, and the secrets it handed out. */
export type Store = { hooks: Webhook[]; deliveries: Delivery[]; secrets: string[] };

/**
 * The webhook routes under `base` ("/v1/teams/registrar/webhooks" or "/v1/admin/webhooks") over `store`. PATCH checks If-Match against the
 * stored revision (412 otherwise); `reject` lets a test make the next create or update answer an error.
 */
export function webhookRoutes(base: string, store: Store, opts: { reject?: () => Reply | undefined } = {}): Record<string, Handler> {
  const find = (id: string) => store.hooks.find((h) => h.id === id);
  // Routes are fixed keys: the webhooks there are at the start, and the first two a test makes (w10 and w11).
  const ids = [...store.hooks.map((h) => h.id), "w10", "w11"];
  return {
    [`GET ${base}`]: () => store.hooks,
    [`POST ${base}`]: (b) => {
      const err = opts.reject?.();
      if (err) return err;
      const input = b as Schemas["WebhookInput"];
      const w = hook({ id: `w${store.hooks.length + 10}`, ...input, secretHint: "9f3c", revision: 1 });
      store.hooks.push(w);
      store.secrets.push("whsec_created_secret_9f3c");
      return new Reply(201, { data: { webhook: w, secret: "whsec_created_secret_9f3c" } });
    },
    ...Object.fromEntries(
      ids.flatMap((id) => [
        [
          `PATCH ${base}/${id}`,
          (b: unknown, call: { headers: Headers }) => {
            const err = opts.reject?.();
            if (err) return err;
            const cur = find(id);
            if (!cur) return Reply.error(404, "not_found");
            if (call.headers.get("If-Match") !== `"${cur.revision}"`) return Reply.error(412, "revision_conflict");
            const input = b as Schemas["WebhookInput"];
            Object.assign(cur, input, { revision: cur.revision + 1, pausedReason: input.enabled ? "" : cur.pausedReason });
            return cur;
          },
        ],
        [
          `DELETE ${base}/${id}`,
          () => {
            store.hooks = store.hooks.filter((x) => x.id !== id);
            return { ok: true };
          },
        ],
        [
          `POST ${base}/${id}/rotate-secret`,
          () => {
            const cur = find(id)!;
            cur.secretHint = "7d0e";
            store.secrets.push("whsec_rotated_secret_7d0e");
            return new Reply(200, { data: { webhook: cur, secret: "whsec_rotated_secret_7d0e" } });
          },
        ],
        [`GET ${base}/${id}/deliveries`, () => store.deliveries],
        [
          `POST ${base}/${id}/test`,
          () => {
            const d = delivery({ id: `d${store.deliveries.length + 10}`, eventType: "webhook.test", status: "pending", attempts: 0, lastStatus: null, deliveredAt: null });
            store.deliveries.unshift(d);
            return new Reply(202, { data: d });
          },
        ],
        ...store.deliveries.map((d) => [
          `POST ${base}/${id}/deliveries/${d.id}/redeliver`,
          () => {
            const again = delivery({ id: `r${store.deliveries.length + 10}`, eventId: d.eventId, eventType: d.eventType, status: "pending", attempts: 0, lastStatus: null, deliveredAt: null });
            store.deliveries.unshift(again);
            return new Reply(202, { data: again });
          },
        ]),
      ]),
    ),
  };
}

/** A signed-in team member with the webhooks capability on, off, or (null) not sent. */
export const teamMe = (teamRole: string, webhooks: boolean | null = true) => {
  const me = meFor("none", teamRole);
  return { ...me, capabilities: { ...me.capabilities, ...(webhooks === null ? {} : { webhooks }) } };
};

/** The routes of Team settings for a member of the registrar team (the tabs' own queries answer empty). */
export const teamSettingsRoutes = (teamRole: string, webhooks: boolean | null = true): Record<string, Handler> => ({
  ...shellRoutes("none", teamRole),
  "GET /v1/me": () => teamMe(teamRole, webhooks),
  "GET /v1/teams/registrar/members": () => [],
  "GET /v1/teams/registrar/api-keys": () => [],
  "GET /v1/teams/registrar/audit": () => ({ items: [], nextCursor: null }),
  "GET /v1/teams/registrar/kbs": () => [],
  "GET /v1/teams/registrar/agents": () => [],
  ...catalogRoutes(),
});
