/*
 * The Analytics tab (W7): a date range in the URL (?range=), a strip of five
 * KPIs, then one of Usage · Quality · Moderation · Content · Checks (?view=;
 * Checks holds the SystemOne cards, only while a SystemOne model is
 * configured, v0.2.1 I8). Charts
 * are bitop-ui charts with "Show data". No message content or identities.
 */
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, MessagesSquare, SearchX, ShieldCheck, ShieldOff, ThumbsUp } from "lucide-react";
import { api, unwrap } from "../../../api/client";
import { num, pct } from "@/components/analytics/format";
import { DateRangeFilter, useDateRangeParam } from "@/components/templates/date-range-filter";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Loading } from "@/components/ui/spinner/spinner";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group/toggle-group";
import { useSystemOneStatus } from "@/lib/systemone";
import { useSearchParams } from "@/lib/url-search";
import { agentKey, useTeam } from "../../team/common";
import type { Agent } from "../common";
import { AgentSpendCard } from "./spend";
import { ChecksView, ContentView, ModerationView, QualityView, UsageView, type Analytics } from "./views";
import an from "./analytics.module.css";

const views = [
  { value: "usage", label: "Usage" },
  { value: "quality", label: "Quality" },
  { value: "moderation", label: "Moderation" },
  { value: "content", label: "Content" },
  { value: "checks", label: "Checks" },
] as const;
type View = (typeof views)[number]["value"];

/** The section in ?view= (Usage by default, kept out of the URL); Checks only with SystemOne. */
function useView(systemOne: boolean): [View, (v: View) => void, (typeof views)[number][]] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("view");
  const shown = views.filter((v) => systemOne || v.value !== "checks");
  const view = shown.some((v) => v.value === raw) ? (raw as View) : "usage";
  const set = (v: View) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (v === "usage") out.delete("view");
      else out.set("view", v);
      return out;
    });
  return [view, set, shown];
}

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function AnalyticsTab({ agent }: { agent: Agent }) {
  const { slug } = useTeam();
  const range = useDateRangeParam({ defaultPreset: "30d" });
  const systemOne = useSystemOneStatus();
  const [view, setView, shown] = useView(Boolean(systemOne.data?.available));
  const from = range.fromDay ?? "";
  const to = range.toDay ?? "";
  const data = useQuery({
    queryKey: [...agentKey(slug, agent.id), "analytics", from, to],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}/analytics", { params: { path: { team: slug, agentId: agent.id }, query: { from, to } } })),
    enabled: Boolean(from && to),
  });

  return (
    <div className={an.analytics}>
      <div className={an.toolbar}>
        <ToggleGroup aria-label="Analytics section" variant="outline" size="sm" value={[view]} onValueChange={(v) => v[0] && setView(v[0] as View)}>
          {shown.map((v) => (
            <ToggleGroupItem key={v.value} value={v.value}>
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <DateRangeFilter range={range} label="Analytics period" />
      </div>
      {data.isLoading ? (
        <Loading label="Loading analytics…" />
      ) : data.error ? (
        <ErrorAlert error={data.error} title="Couldn't load analytics" />
      ) : !data.data?.totals ? null : (
        <>
          <Kpis a={data.data} />
          {view === "usage" && <UsageView a={data.data} spend={<AgentSpendCard agent={agent} />} />}
          {view === "quality" && <QualityView a={data.data} />}
          {view === "moderation" && <ModerationView a={data.data} />}
          {view === "content" && <ContentView a={data.data} />}
          {view === "checks" && <ChecksView a={data.data} />}
        </>
      )}
    </div>
  );
}

/** Five headline numbers. Satisfaction carries its sample size; the citation support rate needs a SystemOne model. */
function Kpis({ a }: { a: Analytics }) {
  const t = a.totals;
  const systemOne = useSystemOneStatus();
  const ratings = t.up + t.down;
  const blocked = t.moderation.questionsBlocked + t.moderation.answersWithheld;
  return (
    <section aria-label="Key figures" className={an.kpis}>
      <StatCard label="Conversations" value={num(t.conversations)} icon={<MessagesSquare />} hint={`${plural(t.uniqueUsers, "person", "people")} (test chats excluded)`} />
      <StatCard label="Answers" value={num(t.answers)} icon={<MessageSquare />} hint={t.conversations ? `${(t.answers / t.conversations).toFixed(1)} per conversation` : undefined} />
      <StatCard
        label="Satisfaction"
        value={pct(t.satisfaction)}
        icon={<ThumbsUp />}
        hint={ratings === 0 ? "No ratings yet" : `From ${plural(ratings, "rating")}${ratings < 10 ? ": too few to rely on" : ""}`}
      />
      {systemOne.data?.available ? (
        <StatCard
          label="Citations supported"
          value={pct(t.citations.supportRate)}
          icon={<ShieldCheck />}
          hint={t.citations.pairs ? `SystemOne checked ${plural(t.citations.pairs, "citation")}` : "SystemOne checked none"}
        />
      ) : (
        <StatCard label="No sources found" value={pct(t.noContextRate)} icon={<SearchX />} hint="Answers without passages" />
      )}
      <StatCard label="Refusals" value={pct(t.refusalRate)} icon={<ShieldOff />} hint={`${plural(blocked, "block")} by moderation`} />
    </section>
  );
}
