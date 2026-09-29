/*
 * A set's trend (I3, docs/v0.2.1.md): its latest completed score against the
 * latest earlier run of the same kind that has a score (the API's
 * previousRun: a run whose every check failed is skipped), in whole points.
 * A drop is a regression: the team's Evaluations page filters on it and the
 * team Overview flags it. Tested in src/test/evaluations-trend.test.ts.
 */
import { pct, runScore, unscored } from "./labels";
import type { EvalSet } from "./queries";

export type Trend = {
  /** The latest completed run's score (0–1), if the latest run completed with one. */
  score?: number;
  /** The run before's score (0–1). */
  previous?: number;
  /** The change in whole percentage points. */
  points?: number;
  direction: "up" | "down" | "same" | "none";
};

export function setTrend(set: Pick<EvalSet, "lastRun" | "previousRun">): Trend {
  const last = set.lastRun;
  const score = last && last.status === "completed" ? (runScore(last) ?? undefined) : undefined;
  const previous = set.previousRun ? (runScore(set.previousRun) ?? undefined) : undefined;
  if (score === undefined || previous === undefined) return { score, direction: "none" };
  const points = Math.round(score * 100) - Math.round(previous * 100);
  return { score, previous, points, direction: points > 0 ? "up" : points < 0 ? "down" : "same" };
}

/** Why a set has no trend, for screen readers (the cell shows "—"). */
export function noTrendText(set: Pick<EvalSet, "lastRun" | "previousRun">): string {
  const last = set.lastRun;
  if (!last) return "Not run yet";
  if (last.status === "queued" || last.status === "running") return "No trend until the run finishes";
  if (last.status === "failed") return "No trend: the latest run failed";
  if (last.status === "cancelled") return "No trend: the latest run was cancelled";
  if (unscored(last)) return "No trend: the latest run has no score";
  return "No earlier scored run to compare";
}

/** The latest run scored lower than the run before it. */
export const regressed = (set: Pick<EvalSet, "lastRun" | "previousRun">) => setTrend(set).direction === "down";

const pointsText = (n: number) => `${n} point${n === 1 ? "" : "s"}`;

/** "Down 10 points from 80%", "Up 5 points from 70%", "No change from 80%"; "" without a run before. */
export function trendText(t: Trend): string {
  if (t.direction === "none" || t.points === undefined) return "";
  const from = `from ${pct(t.previous)}`;
  if (t.direction === "same") return `No change ${from}`;
  return `${t.direction === "up" ? "Up" : "Down"} ${pointsText(Math.abs(t.points))} ${from}`;
}

/** The short form beside a score: "−10 pts", "+5 pts", "±0"; "" without a run before. */
export function trendShort(t: Trend): string {
  if (t.points === undefined || t.direction === "none") return "";
  if (t.points === 0) return "±0";
  return `${t.points > 0 ? "+" : "−"}${Math.abs(t.points)} pts`;
}

type Listed = Pick<EvalSet, "lastRun" | "previousRun" | "name">;

/** The sets the team Overview shows (up to n): regressions first, then the most recently run, then those never run, by name. */
export function overviewSets<T extends Listed>(sets: T[], n = 5): T[] {
  const rank = (x: T) => (regressed(x) ? 0 : x.lastRun ? 1 : 2);
  return [...sets]
    .sort((a, b) => rank(a) - rank(b) || (b.lastRun?.createdAt ?? "").localeCompare(a.lastRun?.createdAt ?? "") || a.name.localeCompare(b.name))
    .slice(0, n);
}
