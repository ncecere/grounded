/* The gap report (docs/gaps.md): types, query keys, queries and the words for signals and states. */
import { queryOptions } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "@/api/client";

export type GapTopic = Schemas["GapTopic"];
export type GapTopicList = Schemas["GapTopicList"];
export type GapSharedQuestion = Schemas["GapSharedQuestion"];
export type GapState = GapTopic["state"];
export type GapDismissKind = Schemas["GapDismissKind"];
export type GapTopicEvent = Schemas["GapTopicEvent"];
export type GapSettings = Schemas["GapSettings"];
export type GapFilter = "open" | "closed";

export const gapTopicsKey = (team: string) => ["team", team, "gap-topics"];

/** A team's topics shown to editors (3 askers or more), optionally one agent's. */
export const gapTopicsQuery = (team: string, filter: { agentId?: string; state?: GapFilter } = {}) =>
  queryOptions({
    queryKey: [...gapTopicsKey(team), filter],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/gap-topics", { params: { path: { team }, query: filter } })),
  });

export const gapTopicQuery = (team: string, topicId: string) =>
  queryOptions({
    queryKey: [...gapTopicsKey(team), "topic", topicId],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/gap-topics/{topicId}", { params: { path: { team, topicId } } })),
  });

export const gapSettingsKey = (team: string) => ["team", team, "gap-settings"];

export const gapSettingsQuery = (team: string) =>
  queryOptions({
    queryKey: gapSettingsKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/gap-settings", { params: { path: { team } } })),
  });

/** Why questions count as failed, in plain words. */
export const signalLabels: Record<string, string> = {
  no_context: "Nothing found",
  refused: "Refused",
  judged_out: "No relevant passage",
  out_of_scope: "Out of scope",
  unsupported: "Unsupported claims",
  thumbs_down: "Thumbs-down",
};

export const stateLabels: Record<GapState, string> = { open: "Open", dismissed: "Dismissed", fixed: "Fixed", resolved: "Answered now" };

export const dismissKindLabels: Record<GapDismissKind, string> = { for_now: "Dismissed for now", not_for_agent: "Not for this agent" };

/** A topic's state in words: a dismissal says which kind. */
export const stateLabel = (t: Pick<GapTopic, "state" | "dismissKind">) => (t.state === "dismissed" && t.dismissKind ? dismissKindLabels[t.dismissKind] : stateLabels[t.state]);

/** Questions that joined a closed topic since it closed: "3 more since dismissed" (undefined while open or with none). */
export function sinceClosedLabel(t: Pick<GapTopic, "state" | "sinceClosed">): string | undefined {
  if (t.state === "open" || t.sinceClosed === 0) return undefined;
  const since = { dismissed: "dismissed", fixed: "marked fixed", resolved: "answered" }[t.state];
  return `${t.sinceClosed.toLocaleString()} more since ${since}`;
}

/**
 * Why some failed questions of the last 30 days show in no topic: in topics
 * fewer than minAskers people asked about, or not grouped yet (hourly).
 */
export function pendingNote(l: Pick<GapTopicList, "pending" | "ungrouped" | "minAskers">): { title: string; detail: string } | undefined {
  if (l.pending <= 0) return undefined;
  const few = l.pending - l.ungrouped;
  const n = (x: number) => x.toLocaleString();
  const parts = [
    few > 0 && `${n(few)} ${few === 1 ? "is in a topic" : "are in topics"} fewer than ${l.minAskers} people asked about.`,
    l.ungrouped > 0 && `${n(l.ungrouped)} ${l.ungrouped === 1 ? "isn't" : "aren't"} grouped yet: questions are grouped every hour.`,
  ].filter(Boolean);
  const all = l.pending === 1 ? "1 failed question" : `${n(l.pending)} failed questions`;
  return { title: `${all} from the last 30 days ${l.pending === 1 ? "isn't" : "aren't"} shown.`, detail: parts.join(" ") };
}

export const stateTones: Record<GapState, "warning" | "neutral" | "success"> = { open: "warning", dismissed: "neutral", fixed: "success", resolved: "success" };

/** A topic's name: its label, or a placeholder until the topics job writes one. */
export const topicName = (t: Pick<GapTopic, "label">) => t.label || "Not labelled yet";

/** The signals with questions, most first. */
export function topSignals(signals: Record<string, number>): { key: string; label: string; count: number }[] {
  return Object.entries(signals)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, count]) => ({ key, label: signalLabels[key] ?? key, count }));
}

/** The trend in words, for the sparkline's label. */
export function trendLabel(trend: number[]): string {
  const total = trend.reduce((a, b) => a + b, 0);
  const last = trend[trend.length - 1] ?? 0;
  return `Questions per week, last ${trend.length} weeks: ${total} in all, ${last} this week.`;
}
