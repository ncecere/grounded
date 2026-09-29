/*
 * Admin → Analytics (A9): platform aggregates for a date range kept in the
 * URL (?range=), filtered by team and audience (?team=, ?audience=), in pill
 * tabs Overview · Breakdown · Models & tokens · Top agents & teams · Checks
 * (docs/phase4-publishing.md §9). Overview has the daily chart first, then the
 * totals; Checks holds the SystemOne cards and shows only while a SystemOne
 * model is configured (v0.2.1 I8). No content and no user identities (ADR-0010).
 */
import { useQuery } from "@tanstack/react-query";
import { Activity, BarChart3, ChartPie, Clock, Cpu, Flag, Globe, LayoutDashboard, LifeBuoy, MessageSquare, MessagesSquare, SearchX, ShieldAlert, ShieldCheck, ShieldOff, ShieldX, ThumbsUp, Timer, Trophy, Users, Zap } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ModerationCard, ShareCard, StatGroup } from "@/components/analytics/breakdowns";
import { SystemOneChecks } from "@/components/analytics/checks";
import { DailyChart } from "@/components/analytics/daily-chart";
import { audienceLabels, channelLabels, ms, num, pct } from "@/components/analytics/format";
import type { Range } from "@/components/analytics/range-picker";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { DateRangeFilter, useDateRangeParam } from "@/components/templates/date-range-filter";
import { useSystemOneStatus } from "@/lib/systemone";
import { analyticsTabs } from "@/lib/tabs";
import an from "@/components/analytics/analytics.module.css";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Loading } from "@/components/ui/spinner/spinner";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import s from "../../shared.module.css";
import { AnalyticsFilters, type AnalyticsFilter, useAnalyticsFilter } from "./filters";
import { ModelTokens, TopAgents, TopTeams } from "./lists";
import { ModerationEvents } from "./moderation-events";

export type PlatformAnalytics = Schemas["PlatformAnalytics"];

export const adminAnalyticsQuery = ({ from, to }: Range, f: AnalyticsFilter = {}) => ({
  queryKey: ["admin", "analytics", from, to, f.team ?? "", f.audience ?? ""],
  queryFn: async () => unwrap(await api.GET("/v1/admin/analytics", { params: { query: { from, to, team: f.team, audience: f.audience } } })),
});

/** The daily CSV with the same range and filters. */
const csvHref = (d: PlatformAnalytics, f: AnalyticsFilter) => {
  const q = new URLSearchParams({ from: d.from, to: d.to });
  if (f.team) q.set("team", f.team);
  if (f.audience) q.set("audience", f.audience);
  return `/v1/admin/analytics/daily.csv?${q}`;
};

export function AdminAnalyticsPage() {
  const dates = useDateRangeParam({ defaultPreset: "30d" });
  const range: Range = { from: dates.fromDay ?? "", to: dates.toDay ?? "" };
  const [tab, setTab] = useUrlTab(analyticsTabs);
  const filters = useAnalyticsFilter();
  const f = filters.filter;
  const data = useQuery({ ...adminAnalyticsQuery(range, f), enabled: Boolean(range.from && range.to) });
  const systemOne = useSystemOneStatus();
  const d = data.data;
  const empty = d && d.totals.answers === 0 && d.totals.conversations === 0 && d.models.length === 0;

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Analytics"
        description="How agents are used across the platform, in aggregates only: no questions, answers or people. Days are UTC; draft test chats are left out except from token usage."
        actions={<DateRangeFilter range={dates} label="Analytics date range" />}
      />
      <AnalyticsFilters {...filters} />
      {data.isLoading ? (
        <Loading label="Loading analytics…" />
      ) : data.error ? (
        <ErrorAlert error={data.error} title="Couldn't load analytics" />
      ) : !d ? null : empty ? (
        <Card>
          <EmptyState
            icon={<BarChart3 />}
            title={f.team || f.audience ? "No activity for these filters in this range." : "No activity in this range."}
            description="Answers, conversations and token use appear here once people chat with agents."
          />
        </Card>
      ) : (
        <PageTabs
          label="Analytics sections"
          value={tab}
          onValueChange={setTab}
          tabs={[
            {
              value: "overview",
              label: "Overview",
              icon: <LayoutDashboard aria-hidden />,
              content: (
                <Stack gap={6}>
                  <DailyChart
                    days={d.daily}
                    description="The paler bars are answers; the darker ones conversations started. The table and CSV add the quality and moderation counts."
                    csvHref={csvHref(d, f)}
                    extra={[
                      { label: "No context", value: (x) => x.noContext },
                      { label: "Refused", value: (x) => x.refused },
                      { label: "Blocked", value: (x) => x.moderationBlocked },
                      { label: "Flagged", value: (x) => x.moderationFlagged },
                    ]}
                  />
                  <Totals t={d.totals} audiences={d.audiences} />
                </Stack>
              ),
            },
            {
              value: "breakdown",
              label: "Breakdown",
              icon: <ChartPie aria-hidden />,
              content: (
                <Stack gap={6}>
                  <div className={an.grid2}>
                    <ShareCard
                      title="Answers by audience"
                      column="Audience"
                      description="The audience each agent was published to when it answered."
                      rows={d.audiences.map((x) => ({ key: x.audience, label: audienceLabels[x.audience], answers: x.answers }))}
                    />
                    <ShareCard
                      title="Answers by channel"
                      column="Channel"
                      description="Where the question came from."
                      rows={d.channels.map((x) => ({ key: x.channel, label: channelLabels[x.channel], answers: x.answers }))}
                    />
                  </div>
                  <ModerationCard counts={d.moderation} />
                  <ModerationEvents range={range} filtered={Boolean(f.team || f.audience)} />
                </Stack>
              ),
            },
            { value: "models", label: "Models & tokens", icon: <Cpu aria-hidden />, content: <ModelTokens models={d.models} audienceFiltered={Boolean(f.audience)} /> },
            {
              value: "top",
              label: "Top agents & teams",
              icon: <Trophy aria-hidden />,
              // One card per row: the agents table needs the width at 1280 px.
              content: (
                <Stack gap={6}>
                  <TopAgents agents={d.topAgents} />
                  {!f.team && <TopTeams teams={d.topTeams} />}
                </Stack>
              ),
            },
            {
              value: "checks",
              label: "Checks",
              icon: <ShieldCheck aria-hidden />,
              hidden: !systemOne.data?.available,
              content: <SystemOneChecks judging={d.totals.judging} citations={d.totals.citations} scope={d.totals.scope} />,
            },
          ]}
        />
      )}
    </Stack>
  );
}

function Totals({ t, audiences }: { t: PlatformAnalytics["totals"]; audiences: PlatformAnalytics["audiences"] }) {
  const publicShare = t.answers ? (audiences.find((x) => x.audience === "public")?.share ?? 0) : null;
  return (
    <div className={an.totals}>
      <StatGroup id="totals-usage" title="Usage" columns={4}>
        <StatCard label="Answers" value={num(t.answers)} icon={<MessageSquare />} />
        <StatCard label="Conversations" value={num(t.conversations)} icon={<MessagesSquare />} hint="Stored conversations started" />
        <StatCard label="Unique users" value={num(t.uniqueUsers)} icon={<Users />} hint="Pseudonymous IDs, counted per team" />
        <StatCard label="Public share" value={pct(publicShare)} icon={<Globe />} hint="Answers to public agents" />
      </StatGroup>
      <StatGroup id="totals-quality" title="Quality" columns={4}>
        <StatCard label="Satisfaction" value={pct(t.satisfaction)} icon={<ThumbsUp />} hint={`${num(t.up)} up · ${num(t.down)} down`} />
        <StatCard label="No context" value={pct(t.noContextRate)} icon={<SearchX />} hint="Answers without sources" />
        <StatCard label="Refusals" value={pct(t.refusalRate)} icon={<ShieldOff />} hint="Of answers" />
        <StatCard label="Errors" value={pct(t.errorRate)} icon={<Activity />} hint="Of answers" />
      </StatGroup>
      <StatGroup id="totals-speed" title="Speed" columns={3}>
        <StatCard label="Latency p50" value={ms(t.latencyP50Ms)} icon={<Clock />} hint="Median full answer" />
        <StatCard label="Latency p95" value={ms(t.latencyP95Ms)} icon={<Timer />} hint="Slowest 5%" />
        <StatCard label="First token p50" value={ms(t.firstTokenP50Ms)} icon={<Zap />} hint="Median wait to first word" />
      </StatGroup>
      <StatGroup id="totals-moderation" title="Moderation" columns={t.moderation.supported > 0 ? 4 : 3}>
        <StatCard label="Questions blocked" value={num(t.moderation.questionsBlocked)} icon={<ShieldX />} hint="Before retrieval" />
        <StatCard label="Answers withheld" value={num(t.moderation.answersWithheld)} icon={<ShieldAlert />} hint="Blocked or retracted" />
        <StatCard label="Flagged" value={num(t.moderation.flagged)} icon={<Flag />} hint="Answered and recorded" />
        {t.moderation.supported > 0 && <StatCard label="Support messages" value={num(t.moderation.supported)} icon={<LifeBuoy />} hint="Answered with the support message" />}
      </StatGroup>
    </div>
  );
}
