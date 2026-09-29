/*
 * The agent's spend this month on its Analytics tab (I4, docs/v0.2.1.md): its
 * row of the team's spend report (by agent), beside "Tokens by model". For
 * the team's owners and admins while cost tracking is on (the spend API
 * answers 404 while it's off, and nothing shows). Always this month, whatever
 * the tab's period: budgets are monthly.
 */
import { Link } from "@tanstack/react-router";
import { num } from "@/components/analytics/format";
import { Money } from "@/components/money";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { TextLink } from "@/components/ui/text-link/text-link";
import { monthLabel } from "@/lib/costs";
import s from "../../shared.module.css";
import { useTeamSpend } from "../../team/spend";
import { useTeam } from "../../team/common";
import type { Agent } from "../common";

/** "40% of the team's spend", or undefined without team spend. */
export function shareOfTeam(spend: string, total: string) {
  const t = Number(total);
  if (!(t > 0)) return undefined;
  return `${Math.round((Number(spend) / t) * 100)}% of the team's spend`;
}

export function AgentSpendCard({ agent }: { agent: Pick<Agent, "id"> }) {
  const { slug, isManager } = useTeam();
  const q = useTeamSpend(slug, isManager);
  if (!isManager || q.off || q.isLoading) return null;
  if (!q.data) return <ErrorAlert error={q.error} title="Couldn't load this agent's spend" />;
  const d = q.data;
  const cur = d.status.currency;
  const row = d.agents.find((r) => r.key === agent.id);
  const spend = row?.spend ?? "0";
  return (
    <Card
      title="Spend this month"
      description={
        <>
          {monthLabel(d.status.month)}, whatever the period above. Platform admins set prices.{" "}
          <TextLink render={<Link to="/teams/$team/settings" params={{ team: slug }} search={{ tab: "usage" }} />}>The team's spend</TextLink>
        </>
      }
    >
      <DescriptionList
        items={[
          { label: "Spend", value: <Money amount={spend} currency={cur} /> },
          { label: "Share", value: shareOfTeam(spend, d.total.spend) ?? "—" },
          { label: "Tokens", value: num(row?.tokens ?? 0) },
          { label: "Requests", value: num(row?.requests ?? 0) },
        ]}
      />
      {row?.unpriced && <p className={s.muted}>Some of its usage has no price yet, so it counts as zero.</p>}
    </Card>
  );
}
