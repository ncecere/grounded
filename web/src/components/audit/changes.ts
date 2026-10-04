/*
 * An audit entry's before and after, in words people use: money in the
 * platform currency, months and days as dates, price units by their label,
 * internal ids left out, and no value as a missing key (the diff says "Not
 * set" for it, the one word for no value). A revoked API key shows as its
 * status changing. Entries without a known shape are shown as recorded.
 */
import type { Schemas } from "@/api/client";
import { roleLabels } from "@/components/roles";
import { modeLabels, monthLabel, overrideLabels, unitLabels } from "@/lib/costs";
import { formatMoney, formatMoneyExact } from "@/lib/format";

type AuditEntry = Schemas["AuditEntry"];
type Format = (value: unknown) => unknown;
/** A field's label and formatting; null leaves the field out. */
type Fields = Record<string, [label: string, format?: Format] | null>;

/**
 * An amount as money in cents, like everywhere else ("$5.00", "< $0.01");
 * `exact` keeps every decimal, for prices ("0.000150" as "$0.00015").
 * Without a known currency, the number ("5.00").
 */
export function auditMoney(value: unknown, currency?: string, exact = false): unknown {
  if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(Number(value))) return value;
  if (currency) return exact ? formatMoneyExact(value, currency) : formatMoney(value, currency);
  const n = Number(value);
  if (!exact && n > 0 && n < 0.01) return "< 0.01";
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: exact ? 6 : 2 }).format(n);
}

/** "2026-10-28" as "Oct 28, 2026"; "2026-09" as "September 2026". */
function dateText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (/^\d{4}-\d{2}$/.test(value)) return monthLabel(`${value}-01`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d)).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

const percent: Format = (v) => (typeof v === "number" ? `${v}%` : v);
const milliseconds: Format = (v) => (typeof v === "number" ? `${v.toLocaleString()} ms` : v);
/** A switch's value in words: "On", "Off". */
export const onOff = (v: unknown) => (typeof v === "boolean" ? (v ? "On" : "Off") : v);
const label =
  (labels: Record<string, string>): Format =>
  (v) =>
    typeof v === "string" ? (labels[v] ?? v) : v;
/** Recorded statuses and roles in words, as their pages show them ("disabled_by_team" as "Disabled by team"). */
const agentStatusLabels: Record<string, string> = { active: "Enabled", disabled_by_team: "Disabled by team", disabled_by_platform: "Disabled by platform" };
const userStatusLabels: Record<string, string> = { active: "Active", suspended: "Suspended" };
const platformRoleLabels: Record<string, string> = { none: "None", platform_admin: "Platform admin", platform_auditor: "Platform auditor" };
const unitText = (unit: string) => {
  const u = unitLabels[unit as keyof typeof unitLabels];
  return u ? `${u.label} (${u.per})` : unit;
};

function fieldsFor(action: string, currency?: string): Fields | undefined {
  const money: Format = (v) => auditMoney(v, currency);
  const price: Format = (v) => auditMoney(v, currency, true);
  switch (action) {
    case "costs.budget_update":
      return { mode: ["Mode", label(overrideLabels)], amount: ["Monthly budget", money], warnPercent: ["Warn at", percent] };
    case "costs.extension_grant":
    case "costs.extension_revoke":
      return { extensionId: null, month: ["Month", dateText], amount: ["Extension", money], reason: ["Reason"] };
    case "costs.settings_update":
      return {
        mode: ["Mode", label(modeLabels)],
        currency: ["Currency"],
        timeZone: ["Time zone"],
        warnPercent: ["Warn at", percent],
        defaultBudget: ["Default monthly budget", money],
      };
    case "platform.evaluations":
      return { enabled: ["Evaluations", onOff] };
    case "agent.status":
      return { status: ["Status", label(agentStatusLabels)], reason: ["Reason"] };
    case "platform.user_suspend":
    case "platform.user_reactivate":
    case "platform.user_role_change":
    case "platform.user_update":
      return { platformRole: ["Platform role", label(platformRoleLabels)], status: ["Status", label(userStatusLabels)] };
    case "team.member_add":
    case "team.member_role_change":
      return { role: ["Role", label(roleLabels)] };
    case "platform.mcp":
      return { enabled: ["MCP server", onOff] };
    case "platform.answer_cache":
      return { enabled: ["Saved answers", onOff] };
    case "platform.rerank_settings_update":
      return { modelId: null, model: ["Rerank model"], candidates: ["Candidates"], timeLimitMs: ["Time limit", milliseconds] };
    case "agent.answer_cache_update":
      return {
        enabled: ["Reuse answers", (v) => (v === null ? "Default for its audience" : onOff(v))],
        nearIdentical: ["Near-identical questions", onOff],
        expiryHours: ["Reuse for (hours)"],
      };
    case "platform.mcp_oauth":
      return { oauthEnabled: ["OAuth sign-in for MCP clients", onOff] };
    case "legal_hold.create":
    case "legal_hold.release":
      return {
        scopeId: null,
        active: ["Status", (v) => (typeof v === "boolean" ? (v ? "Active" : "Released") : v)],
        scopeType: ["Covers"],
        scopeName: ["Name"],
        coversFrom: ["Data from", dateText],
        coversTo: ["Data until", dateText],
        releaseReason: ["Release reason"],
      };
    case "costs.price_delete":
      return {
        priceId: null,
        mcpServer: ["MCP server"],
        unit: ["Unit", (v) => (typeof v === "string" ? unitText(v) : v)],
        price: ["Price", price],
        effectiveFrom: ["Effective from", dateText],
      };
    default:
      return undefined;
  }
}

const acronyms: Record<string, string> = { id: "ID", ids: "IDs", url: "URL", urls: "URLs", api: "API", kb: "KB", kbs: "KBs", sso: "SSO", ocr: "OCR", oidc: "OIDC" };

/** A recorded key in plain words: "maxClassification" → "Max classification", "kbIds" → "KB IDs", "warn_percent" → "Warn percent". */
export function plainKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => acronyms[w.toLowerCase()] ?? w.toLowerCase());
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** One side of a change, with known fields relabelled and formatted, and empty values left out. */
function readable(side: unknown, fields: Fields): Record<string, unknown> {
  if (!side || typeof side !== "object" || Array.isArray(side)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(side)) {
    if (value === null || value === undefined || value === "") continue;
    const field = fields[key];
    if (field === null) continue;
    out[field?.[0] ?? plainKey(key)] = field?.[1] ? field[1](value) : value;
  }
  return out;
}

/** Reranking settings recorded during v0.4.0's development kept the values under "settings": read them flat. */
function flatSettings(action: string, side: object): object {
  const nested = (side as { settings?: unknown }).settings;
  if (action !== "platform.rerank_settings_update" || !nested || typeof nested !== "object") return side;
  const { settings: _settings, ...rest } = side as Record<string, unknown>;
  return { ...rest, ...nested };
}

/**
 * Limits in words (AD2-20). A platform change records each limit as { default, ceiling }: one field each, so a
 * one-limit change gets a summary ("Data sources default 100 → 150"), empty reading as Unlimited and No ceiling. A
 * team's change records the override, where empty is the platform's default (not "none") and 0 is blocked.
 */
function limitsSide(action: string, side: object): object {
  const entries = Object.entries(side as Record<string, unknown>);
  if (action === "limits.platform_update") {
    return Object.fromEntries(
      entries.flatMap(([key, v]) => {
        const s = (v ?? {}) as { default?: unknown; ceiling?: unknown };
        return [
          [`${plainKey(key)} default`, s.default ?? "Unlimited"],
          [`${plainKey(key)} ceiling`, s.ceiling ?? "No ceiling"],
        ];
      }),
    );
  }
  if (action === "limits.team_update") return Object.fromEntries(entries.map(([key, v]) => [plainKey(key), v === null ? "Platform default" : v === 0 ? "Blocked" : v]));
  return side;
}

/** Added prices: the model, the day they start and each unit's price, by label. */
function pricesAdded(after: unknown, currency?: string): Record<string, unknown> {
  const a = (after ?? {}) as { model?: unknown; effectiveFrom?: unknown; prices?: Record<string, unknown> };
  const out: Record<string, unknown> = {};
  if (a.model) out.Model = a.model;
  if (a.effectiveFrom) out["Effective from"] = dateText(a.effectiveFrom);
  for (const [unit, price] of Object.entries(a.prices ?? {})) out[unitText(unit)] = auditMoney(price, currency, true);
  return out;
}

/** The entry's before and after for the diff. `currency` is the platform's, when the viewer can read it. */
export function auditChange(e: Pick<AuditEntry, "action" | "before" | "after">, currency?: string): { before: object; after: object } {
  if (e.action === "costs.price_add") return { before: {}, after: pricesAdded(e.after, currency) };
  if (e.action === "apikey.revoke") {
    // The key isn't changed but revoked: the same key, with its status.
    const key = readable(e.before, {});
    return { before: { Status: "Active", ...key }, after: { Status: "Revoked", ...key } };
  }
  const fields = fieldsFor(e.action, currency) ?? {};
  const side = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? readable(limitsSide(e.action, flatSettings(e.action, v)), fields) : (v ?? {}));
  return { before: side(e.before) as object, after: side(e.after) as object };
}

/** One changed field of an entry: its plain name, and its value before and after (undefined: not set). */
export type ChangeRow = { field: string; before?: unknown; after?: unknown };

/** The fields that differ between the two sides, in order (the before's fields first). */
export function changedRows(change: { before: object; after: object }): ChangeRow[] {
  const b = change.before as Record<string, unknown>;
  const a = change.after as Record<string, unknown>;
  const keys = [...Object.keys(b), ...Object.keys(a).filter((k) => !(k in b))];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => ({ field: k, before: b[k], after: a[k] }));
}

/** A value for people: text as is, true and false as On and Off, a list of words joined, anything else as compact JSON; "Not set" without one. */
export function valueText(v: unknown, none = "Not set"): string {
  if (v === undefined || v === null || v === "") return none;
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.length ? v.join(", ") : none;
  return JSON.stringify(v);
}

const simple = (v: unknown) => v === undefined || ((typeof v === "string" || typeof v === "number" || typeof v === "boolean") && String(v).length <= 40);

/**
 * A change in one line for the list, when it's simple: one or two fields with short values, such as "Monthly budget
 * $5.00 → none". Null for creations, deletions and larger changes (the record page has them).
 */
export function changeSummary(e: Pick<AuditEntry, "action" | "before" | "after">, currency?: string): string | null {
  if (e.before == null || e.after == null) return null;
  const rows = changedRows(auditChange(e, currency));
  if (rows.length === 0 || rows.length > 2 || !rows.every((r) => simple(r.before) && simple(r.after))) return null;
  return rows.map((r) => `${r.field} ${valueText(r.before, "none")} → ${valueText(r.after, "none")}`).join("; ");
}
