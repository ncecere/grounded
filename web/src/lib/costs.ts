/* Costs and budgets (docs/costs.md): queries, labels and small helpers shared by Admin → Costs, the model and team pages and the team workspace. */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";
import { dayLabel } from "@/components/analytics/format";
import { formatMoney, formatMoneyExact } from "./format";

export type CostSettings = Schemas["CostSettings"];
export type CostMode = Schemas["CostMode"];
export type PriceUnit = Schemas["PriceUnit"];
export type BudgetState = Schemas["BudgetState"];
export type TeamBudgetState = Schemas["TeamBudgetState"];

export const costSettingsQuery = () => ({
  queryKey: ["admin", "costs", "settings"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/costs/settings")),
});

/** The platform cost settings (platform admins and auditors only). */
export function useCostSettings(enabled = true) {
  return useQuery({ ...costSettingsQuery(), enabled });
}

export const budgetStatusQuery = (team: string) => ({
  queryKey: ["team", team, "budget-status"],
  queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/budget-status", { params: { path: { team } } })),
  refetchInterval: 60_000,
});

type Banner = Schemas["TeamBudgetBanner"];

/**
 * The team's enforced budget state, for what it pauses: the workspace banner, the "Waiting" hint on sources and the
 * evaluation run dialog (every member). A Track-only budget never pauses anything or warns anyone, so it reads "none"
 * here; its progress is on Usage & limits and Costs → Budgets (owner decision 2, docs/v0.2.0.md §7).
 */
export function useBudgetStatus(team: string | undefined) {
  return useQuery({
    ...budgetStatusQuery(team ?? ""),
    enabled: Boolean(team),
    select: (b: Banner): Banner => (b.enforced ? b : { ...b, state: "none" }),
  });
}

export const modeLabels: Record<CostMode, string> = { off: "Off", track: "Track only", enforce: "Enforce" };
export const overrideLabels: Record<Schemas["CostModeOverride"], string> = { inherit: "Inherit", ...modeLabels };
export const modeDescriptions: Record<CostMode, string> = {
  off: "Nothing is tracked or refused. Prices can still be entered, ready for later.",
  track: "Spend is reported to platform admins, auditors and each team's owners and admins. Nothing is refused.",
  enforce: "Track only, plus monthly budgets: a warning at the threshold and, at 100%, the team's chats, searches and ingestion stop.",
};

export const stateLabels: Record<BudgetState, string> = { none: "No budget", ok: "Within budget", warning: "Near budget", exhausted: "Budget used up" };
export const stateTones = { none: "neutral", ok: "success", warning: "warning", exhausted: "danger" } as const;

/** A team's state in words: a Track-only budget past 100% is "Over budget" (nothing stops), not "used up". */
export function budgetStateLabel(st: Pick<TeamBudgetState, "state" | "enforced">) {
  return !st.enforced && st.state === "exhausted" ? "Over budget" : stateLabels[st.state];
}

/** The badge tone of a state: a Track-only budget is never danger, since nothing is refused. */
export function budgetStateTone(st: Pick<TeamBudgetState, "state" | "enforced">) {
  return !st.enforced && st.state === "exhausted" ? "warning" : stateTones[st.state];
}

/** "Tracking: 12% of $5.00 · not enforced" for a Track-only budget; null otherwise. */
export function trackingText(st: TeamBudgetState): string | null {
  if (st.enforced || st.limit === null || st.state === "none") return null;
  return `Tracking: ${st.percent ?? 0}% of ${formatMoney(st.limit, st.currency)} · not enforced`;
}

/** Units as people say them, with what one price covers. */
export const unitLabels: Record<PriceUnit, { label: string; per: string }> = {
  chat_tokens_in: { label: "Input tokens", per: "per 1M tokens" },
  chat_tokens_out: { label: "Output tokens", per: "per 1M tokens" },
  embed_tokens: { label: "Embedding tokens", per: "per 1M tokens (or characters)" },
  systemone_tokens: { label: "Input tokens", per: "per 1M tokens" },
  systemone_requests: { label: "Requests", per: "per request" },
  moderation_requests: { label: "Requests", per: "per request" },
  vision_tokens_in: { label: "Input tokens", per: "per 1M tokens" },
  vision_tokens_out: { label: "Output tokens", per: "per 1M tokens" },
};

/** Spend categories, in chart order. */
export const categories = [
  { key: "chat", label: "Chat", tone: "info" },
  { key: "embedding", label: "Embedding", tone: "success" },
  { key: "systemone", label: "SystemOne", tone: "warning" },
  { key: "moderation", label: "Moderation", tone: "neutral" },
  { key: "ocr", label: "OCR", tone: "primary" },
] as const;

/** A decimal amount a person typed: up to 14 digits and 6 decimals. */
export const amountPattern = /^[0-9]{1,14}(\.[0-9]{1,6})?$/;

export function amountError(value: string, what = "amount", required = true): string | undefined {
  const v = value.trim();
  if (!v) return required ? `Enter the ${what}.` : undefined;
  if (!amountPattern.test(v)) return `Enter the ${what} as a number such as 12.50 (up to 6 decimals).`;
  return undefined;
}

/**
 * The one time-zone note of a page with money and limits: "Budget months and report days follow America/New_York; daily
 * limits reset at midnight UTC." (docs/costs.md §9 decision 4). Without a zone (spend not shown), only the limits' part.
 */
export function timeZoneNote(timeZone?: string) {
  return timeZone ? `Budget months and report days follow ${timeZone}; daily limits reset at midnight UTC.` : "Daily limits reset at midnight UTC.";
}

/** "October 2026" for a month's first day (a date string). */
export function monthLabel(day: string) {
  const [y, m] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Sep 1, 2026 to Sep 26, 2026", or one day ("Sep 28, 2026") when the range is a single day. */
export function dayRangeLabel(from: string, to: string) {
  return from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`;
}

/**
 * A month's budget as the Budget card and the Budgets tab both say it: the
 * total (budget plus this month's extensions) in cents, the exact total for
 * hover text, and where it comes from: "$0.20 + $1.00 of extensions",
 * "platform default", or "$0.20 platform default + $1.00 of extensions".
 * Null without a budget (the mode is Off, or no budget is set).
 */
export function budgetThisMonth(st: TeamBudgetState, opts: { platformDefault?: boolean } = {}): { total: string; exact: string; parts?: string } | null {
  if (st.limit === null) return null;
  const total = formatMoney(st.limit, st.currency);
  const exact = formatMoneyExact(st.limit, st.currency);
  const base = opts.platformDefault ? " platform default" : "";
  if (!st.extensions || !(Number(st.extensions) > 0)) return { total, exact, parts: opts.platformDefault ? "platform default" : undefined };
  return { total, exact, parts: `${formatMoney(st.budget ?? "0", st.currency)}${base} + ${formatMoney(st.extensions, st.currency)} of extensions` };
}

/** Whether a team's mode is its own or the platform's, in the same words everywhere. */
export const modeSourceLabel = (override: Schemas["CostModeOverride"]) => (override === "inherit" ? "Platform setting" : "Team setting");

/** Names the per-request column: SystemOne and moderation are priced per request, not per token. */
export const requestsColumn = "Requests";
export const requestsHint = "SystemOne and moderation calls, priced per request.";

/** Today (YYYY-MM-DD) in a time zone such as the platform's, or the browser's day without one. */
export function dayIn(timeZone?: string) {
  if (!timeZone) return localDay();
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return localDay();
  }
}

/** A local date (YYYY-MM-DD) n days from today. */
export function localDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
