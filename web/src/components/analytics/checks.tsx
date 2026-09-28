/* SystemOne citation checks and scope check in analytics (docs/systemone.md §3-§4): counts only, shown once anything was checked. */
import { BadgeCheck, MessageCircle, ShieldQuestion, TriangleAlert } from "lucide-react";
import type { Schemas } from "@/api/client";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { StatGroup } from "./breakdowns";
import { ms, num, pct } from "./format";

export function CitationsGroup({ c }: { c?: Schemas["CitationTotals"] }) {
  if (!c || c.answers === 0) return null;
  return (
    <StatGroup id="totals-citations" title="Citation checks (SystemOne)" columns={4}>
      <StatCard
        label="Citation support rate"
        value={pct(c.supportRate)}
        icon={<BadgeCheck />}
        hint={`${num(c.verified)} of ${num(c.verified + c.unsupported + c.contradicted)} claims supported by their source`}
      />
      <StatCard
        label="Unsupported or contradicted"
        value={num(c.unsupported + c.contradicted)}
        icon={<TriangleAlert />}
        hint={`${num(c.unsupported)} unsupported · ${num(c.contradicted)} contradicted · ${num(c.lowConfidence)} low confidence (review)`}
      />
      <StatCard
        label="Answers checked"
        value={num(c.answers)}
        icon={<ShieldQuestion />}
        hint={`${num(c.pairs)} claims · ${num(c.unchecked)} not checked · ${num(c.removed)} citations removed · ${num(c.refused)} refused`}
      />
      <StatCard label="Check time p50" value={ms(c.latencyP50Ms)} icon={<MessageCircle />} hint={`p95 ${ms(c.latencyP95Ms)} per answer`} />
    </StatGroup>
  );
}

export function ScopeGroup({ s }: { s?: Schemas["ScopeTotals"] }) {
  if (!s || s.checked === 0) return null;
  return (
    <StatGroup id="totals-scope" title="Scope check (SystemOne)" columns={4}>
      <StatCard label="Messages checked" value={num(s.checked)} icon={<ShieldQuestion />} hint={`${num(s.skipped)} not checked (timeout or error)`} />
      <StatCard label="Small talk" value={num(s.smallTalk)} icon={<MessageCircle />} hint="Answered without a search" />
      <StatCard label="Out of scope" value={num(s.outOfScope)} icon={<TriangleAlert />} hint={`${num(s.refused)} refused without a search or model call`} />
      <StatCard label="Check time p50" value={ms(s.latencyP50Ms)} icon={<BadgeCheck />} hint="Runs alongside input moderation" />
    </StatGroup>
  );
}
