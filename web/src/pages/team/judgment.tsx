/* SystemOne judging in the KB playground (docs/systemone.md §2): each passage's scores and route, and the search's counts. */
import type { Schemas } from "@/api/client";
import { Badge } from "@/components/ui/badge/badge";
import { modeLabels, pct, reasonLabels, routeLabels, type PassageJudgment } from "@/lib/systemone";
import r from "./retrieve.module.css";

const routeTone = { evidence: "success", conflicting: "warning", dropped: "neutral" } as const;

export function JudgmentLine({ judgment: j }: { judgment: PassageJudgment }) {
  const scores = `relevant ${pct(j.relevant)} · evidence ${pct(j.evidence)} · contradicts ${pct(j.contradicts)} · injection ${pct(j.injection)}`;
  return (
    <p className={r.judgment}>
      <Badge tone={j.skipped ? "neutral" : routeTone[j.route]}>{j.skipped ? "Not checked" : routeLabels[j.route]}</Badge>
      <span>
        {j.skipped ? "The request failed or timed out; the passage keeps its place." : scores}
        {j.reason && ` · dropped: ${reasonLabels[j.reason]}`}
      </span>
    </p>
  );
}

export function JudgingSummary({ judging: j }: { judging: Schemas["RetrieveJudging"] }) {
  return (
    <p className={r.summary}>
      SystemOne checked {j.judged} passages in {j.latencyMs.toLocaleString()} ms ({j.requests} {j.requests === 1 ? "request" : "requests"}, {modeLabels[j.mode].toLowerCase()}): {j.kept} kept,{" "}
      {j.dropped} dropped{j.skipped > 0 ? `, ${j.skipped} not checked` : ""}. Evidence first, then conflicting, then dropped.
    </p>
  );
}
