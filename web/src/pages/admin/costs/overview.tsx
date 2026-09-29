/* Costs › Overview: spend over a date range (?range=), a daily chart by kind, and the top teams, agents and models, each with its CSV. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, CircleDollarSign, Cpu, Download, Hash, TriangleAlert, UsersRound } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { StatGroup } from "@/components/analytics/breakdowns";
import { dayLabel, num } from "@/components/analytics/format";
import { DateRangeFilter, useDateRangeParam } from "@/components/templates/date-range-filter";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { BarChart } from "@/components/ui/bar-chart/bar-chart";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { Loading } from "@/components/ui/spinner/spinner";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { categories, type CostSettings, dayRangeLabel, requestsColumn } from "@/lib/costs";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/format";
import s from "../../shared.module.css";
import c from "./costs.module.css";

type Report = Schemas["CostReport"];
type Row = Schemas["CostReportRow"];
type GroupBy = Report["groupBy"];

const reportQuery = (from: string, to: string, groupBy: GroupBy) => ({
  queryKey: ["admin", "costs", "report", from, to, groupBy],
  queryFn: async () => unwrap(await api.GET("/v1/admin/costs/report", { params: { query: { from, to, groupBy } } })),
});

const csvHref = (from: string, to: string, groupBy: GroupBy) => `/v1/admin/costs/report.csv?${new URLSearchParams({ from, to, groupBy })}`;

function CsvButton({ from, to, groupBy, what }: { from: string; to: string; groupBy: GroupBy; what: string }) {
  return (
    <Button variant="secondary" size="sm" render={<a href={csvHref(from, to, groupBy)} download aria-label={`Download ${what} as CSV`} />}>
      <Download aria-hidden /> CSV
    </Button>
  );
}

export function UnpricedBadge() {
  return (
    <Badge tone="warning" size="sm" title="Some of this usage has no price, so it counts as zero.">
      Unpriced
    </Badge>
  );
}

export function CostOverviewTab({ settings }: { settings: CostSettings }) {
  const dates = useDateRangeParam({ defaultPreset: "30d" });
  const from = dates.fromDay ?? "";
  const to = dates.toDay ?? "";
  const enabled = Boolean(from && to);
  const days = useQuery({ ...reportQuery(from, to, "day"), enabled });
  const teams = useQuery({ ...reportQuery(from, to, "team"), enabled });
  const agents = useQuery({ ...reportQuery(from, to, "agent"), enabled });
  const models = useQuery({ ...reportQuery(from, to, "model"), enabled });
  const cur = settings.currency;
  const d = days.data;
  return (
    <Stack gap={6}>
      <div className={c.rangeRow}>
        <DateRangeFilter range={dates} label="Costs date range" />
        <span className={s.note}>Days in {settings.timeZone}.</span>
      </div>
      {days.isLoading ? (
        <Loading label="Loading spend…" />
      ) : !d ? (
        <ErrorAlert error={days.error} title="Couldn't load spend" />
      ) : (
        <>
          <StatGroup id="cost-totals" title="Totals" columns={4}>
            <StatCard label="Spend" value={<Money amount={d.total.spend} currency={cur} />} icon={<CircleDollarSign />} hint={dayRangeLabel(d.from, d.to)} />
            <StatCard label="Tokens" value={num(d.total.tokens)} icon={<Hash />} hint="Chat, embedding, SystemOne and OCR" />
            <StatCard label={requestsColumn} value={num(d.total.requests)} icon={<Hash />} hint="SystemOne and moderation requests" />
            <StatCard
              label="Unpriced usage"
              value={d.total.unpriced ? "Yes" : "None"}
              icon={<TriangleAlert />}
              hint={d.total.unpriced ? "Some models have no price; see Prices" : "Every model used has a price"}
            />
          </StatGroup>
          <DailySpend report={d} currency={cur} />
          <TopCard title="Top teams" icon={<UsersRound />} what="teams" q={teams} currency={cur} groupBy="team" from={from} to={to} />
          <TopCard title="Top agents" icon={<Bot />} what="agents" q={agents} currency={cur} groupBy="agent" from={from} to={to} />
          <TopCard title="Top models" icon={<Cpu />} what="models" q={models} currency={cur} groupBy="model" from={from} to={to} />
        </>
      )}
    </Stack>
  );
}

function DailySpend({ report, currency }: { report: Report; currency: string }) {
  const spent = report.rows.filter((r) => Number(r.spend) > 0);
  const summary = `Spend per day by kind, ${dayRangeLabel(report.from, report.to)}: ${formatMoney(report.total.spend, currency)} in total.`;
  return (
    <Card
      title="Spend per day"
      description="Chat, embedding, SystemOne, moderation and OCR spend each day. The table lists the days with spend."
      actions={<CsvButton from={report.from} to={report.to} groupBy="day" what="spend per day" />}
    >
      {spent.length === 0 ? (
        <EmptyState size="compact" icon={<CircleDollarSign />} title="No spend in this range." />
      ) : (
        <div className={c.chartBody}>
          <BarChart
            layout="stack"
            data={report.rows.map((r) => ({ label: dayLabel(r.key), values: Object.fromEntries(categories.map((k) => [k.key, Number(r.byKind[k.key])])) as Record<(typeof categories)[number]["key"], number> }))}
            series={categories.map((k) => ({ key: k.key, label: k.label, tone: k.tone }))}
            formatValue={(v) => formatMoney(String(v), currency)}
            summary={summary}
          />
          <Table caption="Spend per day" columns={["Day", ...categories.map((k) => ({ label: k.label, numeric: true })), { label: "Total", numeric: true }]} maxHeight="16rem" stickyHeader density="compact">
            {spent.map((r) => (
              <Tr key={r.key}>
                <Td nowrap>
                  <time dateTime={r.key}>{dayLabel(r.key)}</time>
                </Td>
                {categories.map((k) => (
                  <Td key={k.key} numeric>
                    <Money amount={r.byKind[k.key]} currency={currency} />
                  </Td>
                ))}
                <Td numeric>
                  <Money amount={r.spend} currency={currency} />
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

type TopProps = {
  title: string;
  icon: React.ReactNode;
  what: string;
  q: { data?: Report; error: unknown; isLoading: boolean };
  currency: string;
  groupBy: GroupBy;
  from: string;
  to: string;
};

function RowLabel({ r, groupBy }: { r: Row; groupBy: GroupBy }) {
  if (groupBy === "team" && r.teamSlug && !r.deleted) return <TextLink render={<Link to="/admin/teams/$team" params={{ team: r.teamSlug }} />}>{r.label}</TextLink>;
  if (groupBy === "model" && r.key && !r.deleted) return <TextLink render={<Link to="/admin/models" search={{ record: r.key, from: "costs" } as never} />}>{r.label}</TextLink>;
  if (groupBy === "agent" && r.key && !r.deleted) return <TextLink render={<Link to="/admin/agents" search={{ record: r.key } as never} />}>{r.label}</TextLink>;
  return <>{r.deleted ? `${r.label || "Deleted"} (deleted)` : r.label}</>;
}

function TopCard({ title, icon, what, q, currency, groupBy, from, to }: TopProps) {
  const rows = (q.data?.rows ?? []).slice(0, 10);
  return (
    <Card title={title} actions={<CsvButton from={from} to={to} groupBy={groupBy} what={what} />} flush>
      {q.isLoading ? (
        <Loading label={`Loading ${what}…`} />
      ) : q.error ? (
        <ErrorAlert error={q.error} />
      ) : rows.length === 0 ? (
        <EmptyState size="compact" icon={icon} title={`No ${what} with usage in this range.`} />
      ) : (
        <Table caption={title} columns={[groupBy === "agent" ? "Agent" : groupBy === "model" ? "Model" : "Team", ...(groupBy === "agent" ? ["Team"] : []), { label: "Spend", numeric: true }, { label: "Tokens", numeric: true }, { label: requestsColumn, numeric: true }]}>
          {rows.map((r) => (
            <Tr key={r.key || "none"}>
              <Td>
                <RowLabel r={r} groupBy={groupBy} /> {r.unpriced && <UnpricedBadge />}
              </Td>
              {groupBy === "agent" && <Td muted>{r.teamName ?? "—"}</Td>}
              <Td numeric>
                <Money amount={r.spend} currency={currency} />
              </Td>
              <Td numeric>{num(r.tokens)}</Td>
              <Td numeric>{num(r.requests)}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
