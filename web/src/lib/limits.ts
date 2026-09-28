/* Team limits (DESIGN.md §11.1): queries and formatting shared by the admin and team pages. */
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../api/client";

export type LimitKey = Schemas["LimitKey"];
export type LimitGroup = Schemas["LimitGroup"];
export type LimitUnit = Schemas["LimitUnit"];
type LimitPeriod = Schemas["LimitPeriod"];

export const limitGroups: { key: LimitGroup; label: string; description: string }[] = [
  { key: "resources", label: "Team resources", description: "Totals across the team's sources and knowledge bases." },
  { key: "ingestion", label: "Ingestion", description: "Crawling and document processing." },
  { key: "queries", label: "Queries & chat", description: "Retrieval through the app and API keys, and chat answers." },
  { key: "public", label: "Public agents", description: "Anonymous visitors of public agents and the widget, per agent. Per-minute limits fail closed." },
];

export const platformLimitsQuery = () =>
  queryOptions({
    queryKey: ["admin", "limits"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/limits")),
  });

export const teamOverridesQuery = (team: string) =>
  queryOptions({
    queryKey: ["admin", "team", team, "limits"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/teams/{team}/limits", { params: { path: { team } } })),
  });

export const teamLimitsQuery = (team: string) =>
  queryOptions({
    queryKey: ["team", team, "limits"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/limits", { params: { path: { team } } })),
  });

const GiB = 1024 ** 3;

/** "10 GiB", "512 MiB", "1.5 KiB". */
function formatBinaryBytes(n: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  if (i === 0) return `${n.toLocaleString()} B`;
  return `${Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** An amount of a limit: "10 GiB", "5,000". */
export function formatAmount(unit: LimitUnit, n: number) {
  return unit === "bytes" ? formatBinaryBytes(n) : n.toLocaleString();
}

export const periodSuffix = (period: LimitPeriod) => (period === "day" ? " per day" : period === "minute" ? " per minute" : "");

/** A limit value for people: "Unlimited", "Blocked", "5,000 per day", "10 GiB". */
export function formatLimit(unit: LimitUnit, period: LimitPeriod, v: number | null | undefined) {
  if (v === null || v === undefined) return "Unlimited";
  if (v === 0) return "Blocked";
  return formatAmount(unit, v) + periodSuffix(period);
}

/**
 * Form values: storage is entered in GiB (decimals allowed), counts as whole
 * numbers. "" means null (unlimited / no ceiling / inherit).
 */
export function toInput(unit: LimitUnit, v: number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (unit === "bytes") return String(Math.round((v / GiB) * 1000) / 1000);
  return String(v);
}

/** Parses a form value; undefined when it isn't a valid non-negative amount. */
export function fromInput(unit: LimitUnit, raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (unit === "bytes") return Math.round(n * GiB);
  return Number.isInteger(n) ? n : undefined;
}

export const inputUnit = (unit: LimitUnit) => (unit === "bytes" ? "GiB" : undefined);
