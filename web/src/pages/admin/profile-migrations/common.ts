/*
 * Profile migrations (docs/phase5-deploy.md §5 P2): types, queries and the
 * pure helpers the admin page, its sheet and the knowledge base page share.
 */
import { api, unwrap, type Schemas } from "@/api/client";

export type Migration = Schemas["ProfileMigration"];
export type MigrationStatus = Schemas["ProfileMigrationStatus"];
export type Preflight = Schemas["ProfileMigrationPreflight"];
export type Estimate = Schemas["ProfileMigrationEstimate"];
export type AdminKB = Schemas["AdminKnowledgeBase"];
export type MigrationSource = Schemas["ProfileMigrationSource"];

export const statusLabels: Record<MigrationStatus, string> = {
  running: "Re-embedding",
  switched: "Switched",
  completed: "Completed",
  cancelled: "Cancelled",
  switched_back: "Switched back",
};
export const statusTone = { running: "info", switched: "success", completed: "success", cancelled: "neutral", switched_back: "neutral" } as const;

export const sourceStateLabels: Record<MigrationSource["state"], string> = { in_progress: "Embedding", complete: "Complete", attention: "Needs attention" };
export const sourceStateTone = { in_progress: "info", complete: "success", attention: "danger" } as const;

/** Polled while something runs, so progress moves without a reload. */
export const pollMs = 3000;

export const migrationsKey = ["admin", "profile-migrations"];
export const migrationsQuery = () => ({
  queryKey: migrationsKey,
  queryFn: async () => unwrap(await api.GET("/v1/admin/profile-migrations")),
  refetchInterval: (q: { state: { data?: Migration[] } }) => (q.state.data?.some((m) => m.status === "running") ? pollMs : false),
});
export const migrationQuery = (id: string) => ({
  queryKey: [...migrationsKey, id],
  queryFn: async () => unwrap(await api.GET("/v1/admin/profile-migrations/{migrationId}", { params: { path: { migrationId: id } } })),
  refetchInterval: (q: { state: { data?: Migration } }) => (q.state.data?.status === "running" ? pollMs : false),
});
export const adminKBsQuery = () => ({
  queryKey: ["admin", "knowledge-bases"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/knowledge-bases")),
});

/** "12 of 40 documents" for a meter. */
export const documentsText = (done: number, total: number) => `${done.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? "document" : "documents"}`;

/** Whole percent done (100 only when everything is). */
export function percent(done: number, total: number) {
  if (total <= 0) return 100;
  const p = Math.floor((done / total) * 100);
  return done >= total ? 100 : Math.min(p, 99);
}

/** "about 3 minutes", "under a minute", "about 2.5 hours"; null without a request limit. */
export function durationText(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `about ${Math.round(minutes)} ${Math.round(minutes) === 1 ? "minute" : "minutes"}`;
  const hours = minutes / 60;
  if (hours < 48) return `about ${Number(hours.toFixed(1)).toLocaleString()} hours`;
  return `about ${Math.round(hours / 24).toLocaleString()} days`;
}

/** The estimate as short lines for a description list. */
export function estimateItems(e: Estimate) {
  const time = durationText(e.minutes);
  return [
    { label: "Documents to embed", value: e.documents.toLocaleString() },
    { label: "Passages", value: `${e.rechunk ? "about " : ""}${e.passages.toLocaleString()}${e.rechunk ? " (cut again)" : " (copied)"}` },
    { label: "Tokens", value: `about ${e.tokens.toLocaleString()}` },
    { label: "Embedding requests", value: e.embeddingCalls.toLocaleString() },
    {
      label: "Time",
      value: time ? `${time} at ${e.requestsPerMinute?.toLocaleString()} requests per minute` : "Not estimated: the connection has no request limit",
    },
  ];
}

/** When the old vectors go, for a switched migration. */
export function graceText(m: Pick<Migration, "status" | "oldVectorsUntil">, now = Date.now()) {
  if (m.status !== "switched" || !m.oldVectorsUntil) return null;
  const ms = new Date(m.oldVectorsUntil).getTime() - now;
  if (ms <= 0) return "The old vectors are being deleted.";
  const days = Math.ceil(ms / 86_400_000);
  return days <= 1 ? "Old vectors are kept for less than a day more." : `Old vectors are kept for ${days} more days.`;
}
