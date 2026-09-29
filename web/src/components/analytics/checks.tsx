/*
 * SystemOne citation checks and scope check in analytics (docs/systemone.md
 * §3-§4): counts only, shown once anything was checked. With passage judging
 * they make up the Checks tab (admin Analytics) and view (an agent's
 * Analytics), shown only while a SystemOne model is configured (v0.2.1 I8).
 */
import { BadgeCheck, MessageCircle, ShieldQuestion, Sparkles, TriangleAlert } from "lucide-react";
import type { Schemas } from "@/api/client";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import an from "./analytics.module.css";
import { StatGroup } from "./breakdowns";
import { ms, num, pct } from "./format";
import { JudgingGroup } from "./judging";

type Checked = { judging?: Schemas["JudgingTotals"]; citations?: Schemas["CitationTotals"]; scope?: Schemas["ScopeTotals"] };

/** Passage judging, citation checks and the scope check; says so when SystemOne checked nothing in the range. */
export function SystemOneChecks({ judging, citations, scope }: Checked) {
  const any = (judging?.answers ?? 0) > 0 || (citations?.answers ?? 0) > 0 || (scope?.checked ?? 0) > 0;
  if (!any) {
    return (
      <Card>
        <EmptyState
          icon={<Sparkles />}
          title="SystemOne checked nothing in this range."
          description="Passage judging, citation checks and the scope check are counted here once they're on and answers use them."
        />
      </Card>
    );
  }
  return (
    <div className={an.totals}>
      <JudgingGroup j={judging} />
      <CitationsGroup c={citations} />
      <ScopeGroup s={scope} />
    </div>
  );
}

/**
 * Citation checks. The first card counts claims (factual sentences) as the chat's summary does ("3 of 6 claims
 * supported · 3 uncited"); the second counts each cited source's verdict, which is what enforce mode acts on.
 */
export function CitationsGroup({ c }: { c?: Schemas["CitationTotals"] }) {
  if (!c || (c.answers === 0 && c.supportedClaims + c.notSupportedClaims + c.uncitedClaims === 0)) return null;
  const claims = c.supportedClaims + c.notSupportedClaims + c.uncitedClaims;
  const checked = c.verified + c.unsupported + c.contradicted;
  return (
    <StatGroup id="totals-citations" title="Citation checks (SystemOne)" columns={4}>
      <StatCard
        label="Claims supported"
        value={pct(c.claimSupportRate)}
        icon={<BadgeCheck />}
        hint={claims ? `${num(c.supportedClaims)} of ${num(claims)} claims supported · ${num(c.uncitedClaims)} uncited` : "Answers from before v0.2.1 have no claim counts"}
      />
      <StatCard
        label="Cited sources that support their claim"
        value={pct(c.supportRate)}
        icon={<TriangleAlert />}
        hint={`${num(c.verified)} of ${num(checked)} · ${num(c.unsupported)} not supported · ${num(c.contradicted)} contradicted · ${num(c.lowConfidence)} low confidence (review)`}
      />
      <StatCard
        label="Answers checked"
        value={num(c.answers)}
        icon={<ShieldQuestion />}
        hint={`${num(c.pairs)} cited sources · ${num(c.unchecked)} not checked · ${num(c.removed)} citations removed · ${num(c.refused)} refused`}
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
