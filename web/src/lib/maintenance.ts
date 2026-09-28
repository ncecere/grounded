/*
 * Maintenance mode (docs/phase5-deploy.md §5 P5): while it's on, new
 * ingestion is paused (uploads, syncs, crawls, re-fetches, retries) and
 * chat and search keep working. The people it concerns (platform admins,
 * and team owners, admins and editors) see a banner and disabled actions;
 * everyone else only sees the reason if something they do is refused.
 */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ApiError, api, unwrap, type Schemas } from "../api/client";
import { formatDate } from "./format";

export type MaintenanceStatus = Schemas["MaintenanceStatus"];

export const maintenanceKey = ["maintenance"];

/** GET /v1/maintenance, polled so a change shows within a minute without a reload. */
export const maintenanceQuery = () =>
  queryOptions({
    queryKey: maintenanceKey,
    queryFn: async () => unwrap(await api.GET("/v1/maintenance")),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

type MeLike = { capabilities: { platformAdmin: boolean }; teams: { role: string }[] };

/** Platform admins and anyone who can change a team's content. */
export function concernsMaintenance(me: MeLike) {
  return me.capabilities.platformAdmin || me.teams.some((t) => t.role === "owner" || t.role === "admin" || t.role === "editor");
}

/** The status while maintenance mode is on; null while it's off, unknown or not wanted (`enabled` false). */
export function useMaintenance(enabled = true): MaintenanceStatus | null {
  const q = useQuery({ ...maintenanceQuery(), enabled });
  return enabled && q.data?.enabled ? q.data : null;
}

/** "Planned to end 27 Sept 2026, 18:00", or "" without a planned end. */
export function plannedEndText(st: Pick<MaintenanceStatus, "plannedEndAt">) {
  return st.plannedEndAt ? `Planned to end ${formatDate(st.plannedEndAt)}.` : "";
}

/** Why an ingestion action is disabled, e.g. next to Upload files or Sync now. */
export function maintenanceReason(st: MaintenanceStatus, what = "Ingestion") {
  return `${what} is paused for maintenance: ${st.reason}`;
}

/** A 503 maintenance_mode refusal from the API. */
export const isMaintenanceError = (err: unknown) => err instanceof ApiError && err.code === "maintenance_mode";
