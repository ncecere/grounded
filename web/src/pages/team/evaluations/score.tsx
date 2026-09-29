/*
 * A run's score, the same for a knowledge base's and an agent's sets: recall@k
 * for a retrieval run, the pass rate for a full-answer run, with the metric
 * named in a tooltip (and in the accessible name, since a tooltip isn't read).
 */
import { Tooltip } from "@/components/ui/tooltip/tooltip";
import { pct, runScore, scoreHelp } from "./labels";
import type { EvalRun } from "./queries";
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
