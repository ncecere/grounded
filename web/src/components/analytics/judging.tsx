/* SystemOne passage judging in analytics (docs/systemone.md §2): counts only, shown once anything was judged. */
import { Ban, Gauge, ListChecks, ScanSearch } from "lucide-react";
import type { Schemas } from "@/api/client";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { StatGroup } from "./breakdowns";
import { ms, num } from "./format";

export function JudgingGroup({ j }: { j?: Schemas["JudgingTotals"] }) {
  if (!j || j.answers === 0) return null;
  const dropped = j.dropped.injection + j.dropped.irrelevant + j.dropped.notUsable;
  return (
    <StatGroup id="totals-judging" title="Passage judging (SystemOne)" columns={4}>
      <StatCard
        label="Passages checked"
        value={num(j.candidates)}
        icon={<ScanSearch />}
        hint={`${num(j.answers)} ${j.answers === 1 ? "answer" : "answers"} · ${num(j.skipped)} not checked (timeout or error)`}
      />
      <StatCard label="Passages used" value={num(j.kept)} icon={<ListChecks />} hint={`${num(j.evidence)} evidence · ${num(j.conflicting)} conflicting`} />
      <StatCard
        label="Passages dropped"
        value={num(dropped)}
        icon={<Ban />}
        hint={`${num(j.dropped.injection)} injection · ${num(j.dropped.irrelevant)} not relevant · ${num(j.dropped.notUsable)} nothing usable · ${num(j.judgedOut)} refused without a model call`}
      />
      <StatCard label="Added latency p50" value={ms(j.latencyP50Ms)} icon={<Gauge />} hint={`p95 ${ms(j.latencyP95Ms)} per answer`} />
    </StatGroup>
  );
}
