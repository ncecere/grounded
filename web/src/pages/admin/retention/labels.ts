/* Words for retention and legal holds (docs/operations/retention.md), and pure helpers tested in src/test. */
import type { Schemas } from "@/api/client";

export type Kind = Schemas["RetentionKind"];
export type Period = Schemas["RetentionPeriod"];
export type Mode = "default" | "keep" | "days";
export type PeriodForm = { mode: Mode; days: string };

export const kindLabels: Record<Kind, { label: string; description: string }> = {
  conversations: {
    label: "Conversations",
    description: "Transcripts past their classification level's retention, from their last message: signed-in and anonymous.",
  },
  deleted_conversations: {
    label: "Conversations users deleted",
    description: "Hidden from their user at once; removed for good after this grace period.",
  },
  access_log: { label: "Access log", description: "Who used a Sensitive or Restricted agent, and when." },
  analytics_events: { label: "Analytics events", description: "Per-answer metadata behind the analytics dashboards (never content)." },
  usage_events: { label: "Usage ledger", description: "Tokens, queries and pages. Rolled up per day before they're deleted, so totals stay." },
  audit_log: { label: "Audit log", description: "Administrative and membership changes. Legal hold entries are always kept." },
  deleted_files: { label: "Files of deleted documents", description: "Stored originals and text of deleted documents and sources. Search stops using them at once." },
  expired_invites: { label: "Expired invites", description: "Invites that expired or were revoked (accepted invites are kept)." },
  anonymous_sessions: { label: "Anonymous sessions", description: "Public visitors' sessions, removed when they expire. They hold no content." },
  evaluation_runs: { label: "Evaluation runs", description: "Evaluation runs and their results (180 days unless set). Legal holds don't apply: they hold only test questions and answers." },
  answer_cache: {
    label: "Saved answers",
    description: "The answer cache: removed when they expire, or sooner past their classification level's conversation retention.",
  },
};

export const kindLabel = (k: Kind) => kindLabels[k]?.label ?? k;

/** "1 day", "90 days". */
export const daysText = (d: number) => (d === 0 ? "at once" : `${d} ${d === 1 ? "day" : "days"}`);

/** "24 hours", "3 days" (anonymous conversation retention). */
export const hoursText = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} days` : `${h} ${h === 1 ? "hour" : "hours"}`);

/** What a period means: "Keep", "Delete after 90 days". */
export function periodText(days: number | null | undefined) {
  if (days === null || days === undefined) return "Keep";
  return days === 0 ? "Delete at the next run" : `Delete after ${daysText(days)}`;
}

/** Where the effective period comes from. */
export function periodSource(p: Period) {
  if (p.source === "platform") return "Set here";
  return p.environmentDays === null ? "Default (keep)" : "Environment default";
}

export const formOf = (p: Period): PeriodForm =>
  !p.platformSet ? { mode: "default", days: "" } : p.platformDays === null ? { mode: "keep", days: "" } : { mode: "days", days: String(p.platformDays) };

/** A field error for a period form, or undefined. */
export function periodError(p: Period, f: PeriodForm) {
  if (f.mode !== "days") return undefined;
  const n = Number(f.days);
  if (f.days.trim() === "" || !Number.isInteger(n)) return "Enter a number of days.";
  if (n < p.minDays || n > p.maxDays) return `From ${p.minDays} to ${p.maxDays} days.`;
  return undefined;
}

export const sameForm = (a: PeriodForm, b: PeriodForm) => a.mode === b.mode && (a.mode !== "days" || Number(a.days) === Number(b.days));

/** The PUT body entries for the periods that changed. */
export function changedPeriods(periods: Period[], forms: Record<string, PeriodForm>) {
  return periods
    .filter((p) => forms[p.kind] && !sameForm(forms[p.kind]!, formOf(p)))
    .map((p) => {
      const f = forms[p.kind]!;
      return f.mode === "days" ? { kind: p.kind, mode: f.mode, days: Number(f.days) } : { kind: p.kind, mode: f.mode };
    });
}

/** Shortening a period deletes more at the next run: the kinds whose effective period gets shorter (or starts deleting). */
export function shortened(periods: Period[], forms: Record<string, PeriodForm>) {
  return periods.filter((p) => {
    const f = forms[p.kind];
    if (!f) return false;
    const next = f.mode === "keep" ? null : f.mode === "default" ? p.environmentDays : Number(f.days);
    return next !== null && (p.days === null || next < p.days);
  });
}

export const scopeTypeLabels: Record<Schemas["LegalHoldScopeType"], string> = {
  user: "User",
  team: "Team",
  agent: "Agent",
  conversation: "Conversation",
};

export const scopeHelp: Record<Schemas["LegalHoldScopeType"], { label: string; placeholder: string }> = {
  user: { label: "Email or user ID", placeholder: "sam@example.edu" },
  team: { label: "Team", placeholder: "Search teams" },
  agent: { label: "Team slug/agent slug, or agent ID", placeholder: "registrar/advisor" },
  conversation: { label: "Conversation ID", placeholder: "3f2b…" },
};

/** "From 1 Jan 2026", "1 Jan – 31 Mar 2026", "All dates". */
export function rangeText(from: string | null, to: string | null, fmt: (d: string) => string) {
  if (from && to) return `${fmt(from)} to ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  if (to) return `Until ${fmt(to)}`;
  return "All dates";
}

export const reasonLabels: Record<Schemas["RetentionGroup"]["reason"], string> = {
  retention: "Past its period",
  deleted: "Deleted, grace passed",
  expired: "Expired",
};

export const audienceText = (a: string) =>
  ({ signed_in: "Signed-in", anonymous: "Anonymous", team: "Team", all_authenticated: "Signed-in users", public: "Public", widget: "Widget", ui: "App", api: "API", openai: "OpenAI API", mcp: "MCP server", test: "Test" })[a] ?? a;
