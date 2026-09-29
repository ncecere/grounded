/*
 * A run's score, the same for a knowledge base's and an agent's sets: recall@k
 * for a retrieval run, the pass rate for a full-answer run, with the metric
 * named in a tooltip (and in the accessible name, since a tooltip isn't read).
 * A set's latest score (LastScore) and its trend against the run before
 * (TrendValue, I3) are shared by the Evaluations tabs, the team's
 * Evaluations page and its Overview.
 */
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip/tooltip";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { pct, runScore, runStatus, scoreHelp } from "./labels";
import type { EvalRun, EvalSet } from "./queries";
import { setTrend, trendShort, trendText } from "./trend";
import e from "./evaluations.module.css";

export function ScoreValue({ run }: { run: Pick<EvalRun, "kind" | "summary"> }) {
  const value = pct(runScore(run));
  const help = scoreHelp(run);
  return (
    <Tooltip content={help}>
      <button type="button" className={e.scoreButton} aria-label={`${value}. ${help}`}>
        {value}
      </button>
    </Tooltip>
  );
}

/** The latest run's score (with its metric in the tooltip), or its status while it isn't done. */
export function LastScore({ set }: { set: Pick<EvalSet, "lastRun"> }) {
  const r = set.lastRun;
  if (!r) return <>Not run yet</>;
  if (r.status !== "completed" || runScore(r) === undefined) return <>{runStatus[r.status].label}</>;
  return <ScoreValue run={r} />;
}

const icons = { up: TrendingUp, down: TrendingDown, same: Minus } as const;

/** "−10 pts" in the danger colour with an arrow, read as "Down 10 points from 80%"; "—" without a run before to compare. */
export function TrendValue({ set }: { set: Pick<EvalSet, "lastRun" | "previousRun"> }) {
  const t = setTrend(set);
  if (t.direction === "none") {
    return (
      <span className={e.trend}>
        <span aria-hidden>—</span>
        <VisuallyHidden>No earlier run to compare</VisuallyHidden>
      </span>
    );
  }
  const Icon = icons[t.direction];
  return (
    <span className={e.trend} data-direction={t.direction} title={trendText(t)}>
      <Icon aria-hidden />
      <span aria-hidden>{trendShort(t)}</span>
      <VisuallyHidden>{trendText(t)}</VisuallyHidden>
    </span>
  );
}
