/*
 * Stored health (E11) of connections and models: the latest result of a Test
 * or of the scheduled re-test. Lists show "Healthy · 3 minutes ago" or
 * "Failing · since 2 hours ago"; record pages show the absolute time, the
 * error class and the message.
 */
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api, type Schemas, unwrap } from "@/api/client";
import { RelativeTime } from "@/components/templates/list-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import type { DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Time } from "@/components/ui/time/time";
import s from "../../shared.module.css";
import m from "./models.module.css";

export type HealthCheck = Schemas["HealthCheck"];
type HealthState = "healthy" | "failing" | "untested";

const healthKey = ["admin", "health-checks"] as const;

/** The latest check of every connection and model (platform admins and auditors). */
export function healthChecksQuery() {
  return { queryKey: healthKey, queryFn: async () => unwrap(await api.GET("/v1/admin/health-checks")), staleTime: 30_000 };
}

export function useHealthChecks() {
  const q = useQuery(healthChecksQuery());
  const byId = new Map((q.data ?? []).map((c) => [c.subjectId, c]));
  return { ...q, get: (id: string) => byId.get(id) };
}

/** After a Test: its result is stored, so read it again. */
export function refreshHealth(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: healthKey });
}

/** Enabled subjects of a kind whose latest check failed (the admin Overview's Needs attention). */
export function failingCount(checks: HealthCheck[] | undefined, kind: Schemas["HealthSubjectKind"]) {
  return (checks ?? []).filter((c) => c.subjectKind === kind && c.subjectEnabled && c.status === "failing").length;
}

const stateOf = (c?: HealthCheck): HealthState => c?.status ?? "untested";

/** "Healthy · 3 minutes ago", "Failing · since 2 hours ago" or "Not tested yet". */
export function HealthBadge({ check }: { check?: HealthCheck }) {
  if (!check) return <span className={s.muted}>Not tested yet</span>;
  const healthy = check.status === "healthy";
  return (
    <span className={m.health}>
      <StatusBadge tone={healthy ? "success" : "danger"}>{healthy ? "Healthy" : "Failing"}</StatusBadge>
      <span className={s.muted}>
        {healthy ? "" : "since "}
        <RelativeTime value={healthy ? check.checkedAt : check.statusSince} />
      </span>
    </span>
  );
}

const stateLabels: Record<HealthState, string> = { healthy: "Healthy", failing: "Failing", untested: "Not tested yet" };

/** The Health column of the connections and models lists. */
export function healthColumn<T>(get: (row: T) => HealthCheck | undefined): DataTableColumn<T> {
  return {
    id: "health",
    header: "Health",
    accessor: (row) => stateLabels[stateOf(get(row))],
    sortable: true,
    cell: (row) => <HealthBadge check={get(row)} />,
  };
}

/** The Health filter (?health=failing is where Needs attention links). */
export function healthFacet<T>(get: (row: T) => HealthCheck | undefined): Facet<T> {
  return {
    id: "health",
    label: "Health",
    type: "select",
    placeholder: "Any health",
    accessor: (row) => stateOf(get(row)),
    options: (Object.keys(stateLabels) as HealthState[]).map((v) => ({ value: v, label: stateLabels[v] })),
  };
}

/** Why a test failed, in words. */
export const errorClassLabels: Record<NonNullable<HealthCheck["errorClass"]>, string> = {
  unavailable: "Unreachable or server error",
  auth: "API key refused",
  not_found: "Not found",
  rate_limited: "Rate limited",
  bad_request: "Request refused",
  bad_response: "Unexpected response",
  config: "Settings problem",
};

function testedBy(c: HealthCheck) {
  if (c.trigger === "scheduled") return "by the scheduled check";
  return c.triggeredByName ? `by ${c.triggeredByName}` : "by an admin";
}

type Fact = { label: string; value: ReactNode };

/** The record page's health facts: status, when (absolute) and, when failing, the error class and message. */
export function healthFacts(check: HealthCheck | undefined): Fact[] {
  if (!check) return [{ label: "Health", value: <HealthBadge /> }];
  const failing = check.status === "failing";
  const facts: Fact[] = [
    {
      label: "Health",
      value: (
        <span className={m.health}>
          <StatusBadge tone={failing ? "danger" : "success"}>{failing ? "Failing" : "Healthy"}</StatusBadge>
          {failing && (
            <span className={s.muted}>
              since <Time value={check.statusSince} />
            </span>
          )}
        </span>
      ),
    },
    {
      label: "Last tested",
      value: (
        <>
          <Time value={check.checkedAt} /> {testedBy(check)}
          {!failing && ` (${check.latencyMs.toLocaleString()} ms)`}
        </>
      ),
    },
  ];
  if (failing) {
    const status = check.httpStatus ? ` (HTTP ${check.httpStatus})` : "";
    facts.push({ label: "Error", value: `${check.errorClass ? errorClassLabels[check.errorClass] : "Failed"}${status}` });
    if (check.message) facts.push({ label: "Message", value: <span className={m.detail}>{check.message}</span> });
  }
  return facts;
}
