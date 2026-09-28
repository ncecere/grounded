/* Formatting and labels shared by the analytics pages (team agent Analytics tab and admin Analytics). */
import type { Schemas } from "@/api/client";

export type AnalyticsChannel = Schemas["AnalyticsChannel"];
export type Audience = Schemas["Audience"];
export type ModerationCount = Schemas["ModerationCount"];

/** A date as YYYY-MM-DD (UTC). */
export const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The UTC date n days before today. */
export const daysAgo = (n: number, now = new Date()) => {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - n);
  return iso(d);
};

export const pct = (v?: number | null) => (v === null || v === undefined ? "—" : `${Math.round(v * 1000) / 10}%`);
export const ms = (v?: number | null) => (v === null || v === undefined ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
export const num = (v: number) => v.toLocaleString();

export const channelLabels: Record<AnalyticsChannel, string> = {
  ui: "Chat page",
  api: "API",
  openai: "OpenAI-compatible API",
  test: "Draft tests",
  public: "Public page",
  widget: "Embedded widget",
};

export { audienceLabels } from "../../lib/terms";

/** A text alternative for a daily answers chart. */
export function dailySummary(days: { date: string; answers: number; conversations: number }[]) {
  if (days.length === 0) return "No days in this range.";
  const answers = days.reduce((s, d) => s + d.answers, 0);
  const conversations = days.reduce((s, d) => s + d.conversations, 0);
  const busiest = days.reduce((a, b) => (b.answers > a.answers ? b : a), days[0]!);
  const range = `${days[0]!.date} to ${days[days.length - 1]!.date}`;
  if (answers === 0) return `Answers per day from ${range}: none.`;
  return `Answers per day from ${range}: ${num(answers)} answers and ${num(conversations)} conversations in total; the busiest day was ${busiest.date} with ${num(busiest.answers)} answers.`;
}

/** Moderation counts pivoted by category: questions and answers, blocked and flagged. Provider errors are counted apart. */
export function moderationByCategory(counts: ModerationCount[]) {
  const rows = new Map<string, { category: string; inputBlock: number; inputFlag: number; outputBlock: number; outputFlag: number }>();
  const errors = { input: 0, output: 0 };
  for (const c of counts) {
    if (c.decision === "error") {
      errors[c.stage] += c.count;
      continue;
    }
    const row = rows.get(c.category) ?? { category: c.category, inputBlock: 0, inputFlag: 0, outputBlock: 0, outputFlag: 0 };
    // A support action replaced the text, like a block.
    const key = `${c.stage}${c.decision === "block" || c.decision === "support" ? "Block" : "Flag"}` as "inputBlock" | "inputFlag" | "outputBlock" | "outputFlag";
    row[key] += c.count;
    rows.set(c.category, row);
  }
  const total = (r: { inputBlock: number; inputFlag: number; outputBlock: number; outputFlag: number }) => r.inputBlock + r.inputFlag + r.outputBlock + r.outputFlag;
  return { rows: [...rows.values()].sort((a, b) => total(b) - total(a) || a.category.localeCompare(b.category)), errors };
}
