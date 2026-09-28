/*
 * Score over time (docs/evaluations.md §4): recall@k of the retrieval checks
 * and the pass rate of the full-answer checks across runs, with markers for
 * what changed between them (agent version, embedding profile, results per
 * search), from each run's configuration.
 */
import { Card } from "@/components/ui/card/card";
import { LineChart } from "@/components/ui/line-chart/line-chart";
import { Time } from "@/components/ui/time/time";
import { formatDate } from "@/lib/format";
import { plural } from "../common";
import { pct, runScore, scoreSeries } from "./labels";
import type { EvalRun } from "./queries";
import e from "./evaluations.module.css";

function Series({ runs, kind, label }: { runs: EvalRun[]; kind: EvalRun["kind"]; label: string }) {
  const { runs: scored, markers } = scoreSeries(runs, kind);
  if (scored.length === 0) return null;
  const changed = new Set(markers.map((m) => m.runId));
  const data = scored.map((r) => ({ label: `${formatDate(r.createdAt)}${changed.has(r.id) ? " ◆" : ""}`, values: { score: (runScore(r) ?? 0) * 100 } }));
  const first = runScore(scored[0]!);
  const last = runScore(scored[scored.length - 1]!);
  return (
    <div>
      <LineChart
        summary={`${label} over ${plural(scored.length, "run")}, from ${pct(first)} to ${pct(last)}.${markers.length ? ` ${plural(markers.length, "run")} (◆) changed what was tested.` : ""}`}
        series={[{ key: "score", label, tone: kind === "answer" ? "info" : "primary" }]}
        data={data}
        formatValue={(v) => `${Math.round(v)}%`}
        points
        dataTable={{ caption: `${label} by run`, labelHeader: "Run" }}
      />
      {markers.length > 0 && (
        <ul className={e.changes} aria-label={`What changed between ${kind === "answer" ? "full-answer" : "retrieval"} runs`}>
          {markers.map((m) => (
            <li key={m.runId}>
              ◆ <Time value={m.at} format="date" />: {m.changes.join("; ")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ScoreChart({ runs }: { runs: EvalRun[] }) {
  if (!runs.some((r) => r.status === "completed")) return null;
  return (
    // A subsection of Runs (its h2).
    <Card title="Score over time" titleAs="h3" description="Each completed run's score. ◆ marks a run whose agent version, embedding profile or results per search differed from the run before.">
      <Series runs={runs} kind="retrieval" label="Recall@k" />
      <Series runs={runs} kind="answer" label="Full-answer pass rate" />
    </Card>
  );
}
