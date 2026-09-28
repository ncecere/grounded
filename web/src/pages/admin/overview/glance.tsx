/* Admin Overview › Platform at a glance (A1): whole-card links to teams, people, agents, content and answers. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, FileText, MessageSquare, UserRound, UsersRound } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { Sparkline } from "@/components/ui/sparkline/sparkline";
import { formatBytes } from "@/lib/bitop-format";
import { audienceLabels } from "@/lib/terms";
import { adminAgentsQuery } from "../agents/agents";
import { overviewQuery, recentAnalyticsQuery } from "./queries";
import o from "./overview.module.css";

const n = (v: number | undefined) => (v === undefined ? "…" : v.toLocaleString());

/** The change of the last 7 days against the 7 before, for a stat card. */
export function weekDelta(daily: number[]) {
  const last = daily.slice(-7).reduce((a, b) => a + b, 0);
  const before = daily.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (before === 0) return undefined;
  const change = Math.round(((last - before) / before) * 100);
  return { value: `${change > 0 ? "+" : ""}${change}%`, trend: change > 0 ? ("up" as const) : change < 0 ? ("down" as const) : ("flat" as const), label: "vs the week before" };
}

export function PlatformGlance() {
  const overview = useQuery(overviewQuery());
  const agents = useQuery(adminAgentsQuery());
  const analytics = useQuery(recentAnalyticsQuery());
  const d = overview.data;
  const published = (agents.data ?? []).filter((a) => a.publishedVersion !== null);
  const byAudience = (Object.keys(audienceLabels) as (keyof typeof audienceLabels)[]).map((aud) => ({ aud, count: published.filter((a) => a.audience === aud).length }));
  const daily = (analytics.data?.daily ?? []).map((x) => x.answers);
  const week = daily.slice(-7).reduce((a, b) => a + b, 0);
  return (
    <section aria-labelledby="glance-title" className={o.glance}>
      <h2 id="glance-title" className={o.sectionTitle}>
        Platform at a glance
      </h2>
      <div className={o.stats}>
        <StatCard
          label="Active teams"
          value={n(d?.teams.active)}
          icon={<UsersRound />}
          hint={d && d.teams.archived > 0 ? `${d.teams.archived} archived` : undefined}
          render={<Link to="/admin/teams" />}
        />
        <StatCard
          label="People"
          value={n(d?.users.total)}
          icon={<UserRound />}
          hint={d ? `${d.users.signedInLast7Days.toLocaleString()} signed in this week${d.users.suspended ? ` · ${d.users.suspended} suspended` : ""}` : undefined}
          render={<Link to="/admin/users" />}
        />
        <StatCard
          label="Published agents"
          value={agents.isLoading ? "…" : published.length.toLocaleString()}
          icon={<Bot />}
          hint={byAudience.map((b) => `${b.count} ${audienceLabels[b.aud]}`).join(" · ")}
          render={<Link to="/admin/agents" />}
        />
        <StatCard
          label="Documents"
          value={n(d?.content.documents)}
          icon={<FileText />}
          hint={d ? `${d.content.passages.toLocaleString()} passages · ${formatBytes(d.content.storageBytes)}` : undefined}
          render={<Link to="/admin/teams" />}
        />
        <StatCard
          label="Answers, last 7 days"
          value={analytics.isLoading ? "…" : week.toLocaleString()}
          icon={<MessageSquare />}
          delta={weekDelta(daily)}
          chart={daily.length > 1 ? <Sparkline values={daily} variant="area" label={`Answers per day, last ${daily.length} days: ${daily.join(", ")}`} /> : undefined}
          render={<Link to="/admin/analytics" />}
        />
      </div>
    </section>
  );
}
