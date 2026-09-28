/* The Analytics tab's sections: Usage, Quality, Moderation and Content (W7). */
import { Activity, Clock, Flag, LifeBuoy, SearchX, ShieldAlert, ShieldOff, ShieldX, Timer, Zap } from "lucide-react";
import type { Schemas } from "../../../api/client";
import { ModerationCard, ShareCard, StatGroup } from "@/components/analytics/breakdowns";
import { CitationsGroup, ScopeGroup } from "@/components/analytics/checks";
import { audienceLabels, channelLabels, dailySummary, ms, num, pct } from "@/components/analytics/format";
import { JudgingGroup } from "@/components/analytics/judging";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { LineChart } from "@/components/ui/line-chart/line-chart";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { Table, Td, Tr } from "@/components/ui/table/table";
import s from "../../shared.module.css";
import { feedbackReasons } from "../../chat/stream";
import an from "./analytics.module.css";

export type Analytics = Schemas["AgentAnalytics"];

export function UsageView({ a }: { a: Analytics }) {
  const t = a.totals;
  const empty = a.daily.every((d) => !d.answers && !d.conversations);
  return (
    <div className={an.view}>
      <Card title="Answers per day" description="Test chats are excluded.">
        {empty ? (
          <EmptyState size="compact" icon={<Activity />} title="No answers in this period." />
        ) : (
          <LineChart
            variant="area"
            summary={dailySummary(a.daily)}
            series={[
              { key: "answers", label: "Answers", tone: "info" },
              { key: "conversations", label: "Conversations started", tone: "success" },
            ]}
            data={a.daily.map((d) => ({ label: d.date, values: { answers: d.answers, conversations: d.conversations } }))}
            dataTable={{ caption: "Answers and conversations per day", labelHeader: "Day" }}
          />
        )}
      </Card>
      <div className={an.grid2}>
        <ShareCard
          title="Answers by audience"
          column="Audience"
          description="The audience the agent was published to when it answered."
          rows={a.audiences.map((x) => ({ key: x.audience, label: audienceLabels[x.audience], answers: x.answers }))}
        />
        <ShareCard title="Answers by channel" column="Channel" description="Includes draft tests." rows={a.channels.map((x) => ({ key: x.channel, label: channelLabels[x.channel], answers: x.answers }))} />
      </div>
      <StatGroup id="usage-speed" title="Speed" columns={3}>
        <StatCard label="Latency p50" value={ms(t.latencyP50Ms)} icon={<Clock />} hint="Median full answer" />
        <StatCard label="Latency p95" value={ms(t.latencyP95Ms)} icon={<Timer />} hint="Slowest 5%" />
        <StatCard label="First token p50" value={ms(t.firstTokenP50Ms)} icon={<Zap />} hint="Median wait to first word" />
      </StatGroup>
      <Card title="Tokens by model" description="Includes query rewriting. Reasoning tokens are part of output." flush>
        {a.models.length === 0 ? (
          <EmptyState size="compact" title="No usage yet." />
        ) : (
          <Table caption="Token use per model" columns={["Model", { label: "Answers", numeric: true }, { label: "Input", numeric: true }, { label: "Output", numeric: true }, { label: "Reasoning", numeric: true }]}>
            {a.models.map((m) => (
              <Tr key={m.modelId}>
                <Td>{m.modelName}</Td>
                <Td numeric>{num(m.answers)}</Td>
                <Td numeric>{num(m.inputTokens)}</Td>
                <Td numeric>{num(m.outputTokens)}</Td>
                <Td numeric>{num(m.reasoningTokens)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

export function QualityView({ a }: { a: Analytics }) {
  const t = a.totals;
  return (
    <div className={an.view}>
      <StatGroup id="quality-answers" title="Answers" columns={3}>
        <StatCard label="No sources found" value={pct(t.noContextRate)} icon={<SearchX />} hint="Answers without passages" />
        <StatCard label="Refusals" value={pct(t.refusalRate)} icon={<ShieldOff />} hint="Of answers" />
        <StatCard label="Errors" value={pct(t.errorRate)} icon={<Activity />} hint="Of answers" />
      </StatGroup>
      <JudgingGroup j={t.judging} />
      <CitationsGroup c={t.citations} />
      <ScopeGroup s={t.scope} />
    </div>
  );
}

export function ModerationView({ a }: { a: Analytics }) {
  const m = a.totals.moderation;
  return (
    <div className={an.view}>
      <StatGroup id="totals-moderation" title="Moderation" columns={m.supported > 0 ? 4 : 3}>
        <StatCard label="Questions blocked" value={num(m.questionsBlocked)} icon={<ShieldX />} hint="Before retrieval" />
        <StatCard label="Answers withheld" value={num(m.answersWithheld)} icon={<ShieldAlert />} hint="Blocked or retracted" />
        <StatCard label="Flagged" value={num(m.flagged)} icon={<Flag />} hint="Answered and recorded" />
        {m.supported > 0 && <StatCard label="Support messages" value={num(m.supported)} icon={<LifeBuoy />} hint="Answered with the support message" />}
      </StatGroup>
      <ModerationCard counts={a.moderation} />
    </div>
  );
}

export function ContentView({ a }: { a: Analytics }) {
  return (
    <div className={an.grid2}>
      <Card title="Top cited documents" flush>
        {a.topDocuments.length === 0 ? (
          <EmptyState size="compact" title="No citations yet." />
        ) : (
          <Table caption="Most cited documents" columns={["Document", { label: "Citations", numeric: true }]}>
            {a.topDocuments.map((doc) => (
              <Tr key={doc.documentId}>
                <Td>{doc.title || <span className={s.muted}>Deleted document</span>}</Td>
                <Td numeric>{num(doc.citations)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Feedback reasons" description="Why people rated an answer down." flush>
        {a.feedbackReasons.length === 0 ? (
          <EmptyState size="compact" title="No negative feedback with a reason." />
        ) : (
          <Table caption="Thumbs-down reasons" columns={["Reason", { label: "Count", numeric: true }]}>
            {a.feedbackReasons.map((r) => (
              <Tr key={r.reason}>
                <Td>{feedbackReasons.find((f) => f.value === r.reason)?.label ?? r.reason}</Td>
                <Td numeric>{num(r.count)}</Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
