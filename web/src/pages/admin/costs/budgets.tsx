/* Costs › Budgets: every active team's mode, budget, month-to-date spend, share and projection; a team opens its page (Limits tab, with the Budget card). */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { UsersRound, Wallet } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage } from "@/components/templates/list-page";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Meter } from "@/components/ui/meter/meter";
import { TextLink } from "@/components/ui/text-link/text-link";
import { budgetThisMonth, modeLabels, modeSourceLabel, monthLabel, stateLabels, stateTones } from "@/lib/costs";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/format";
import c from "./costs.module.css";

type Item = Schemas["BudgetListItem"];

export const budgetsQuery = () => ({
  queryKey: ["admin", "costs", "budgets"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/costs/budgets")),
});

const facets: Facet<Item>[] = [
  {
    id: "state",
    label: "State",
    type: "toggle",
    allLabel: "All",
    accessor: (r) => r.status.state,
    options: (["exhausted", "warning", "ok", "none"] as const).map((v) => ({ value: v, label: stateLabels[v] })),
  },
];

/** The budget share as a meter (none without a budget). */
export function BudgetMeter({ status, label }: { status: Schemas["TeamBudgetState"]; label: string }) {
  if (status.limit === null || status.spent === null) return <span>—</span>;
  const limit = Number(status.limit);
  return (
    <Meter
      label={label}
      hideLabel
      size="sm"
      value={Number(status.spent)}
      max={limit}
      warningAt={status.warnPercent / 100}
      valueText={`${status.percent ?? 0}%`}
      formatValue={(v) => formatMoney(String(v), status.currency)}
    />
  );
}

/** A team's mode and where it comes from, in the same words on the Budgets tab and the team's Budget card. */
export function ModeText({ mode, override }: { mode: Schemas["CostMode"]; override: Schemas["CostModeOverride"] }) {
  return (
    <>
      {modeLabels[mode]}{" "}
      <Badge size="sm" variant="outline">
        {modeSourceLabel(override)}
      </Badge>
    </>
  );
}

function columns(currency: string): DataTableColumn<Item>[] {
  return [
    {
      id: "team",
      header: "Team",
      accessor: (r) => r.teamName,
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <CellText
          primary={<TextLink render={<Link to="/admin/teams/$team" params={{ team: r.teamSlug }} search={{ tab: "limits" }} />}>{r.teamName}</TextLink>}
          secondary={r.teamSlug}
        />
      ),
    },
    {
      id: "mode",
      header: "Mode",
      accessor: (r) => r.status.mode,
      cell: (r) => <ModeText mode={r.status.mode} override={r.modeOverride} />,
    },
    {
      id: "budget",
      header: "Budget this month",
      accessor: (r) => Number(r.status.limit ?? -1),
      numeric: true,
      cell: (r) => {
        const b = budgetThisMonth(r.status, { platformDefault: !r.ownBudget });
        return b ? <CellText primary={<span title={b.exact}>{b.total}</span>} secondary={b.parts} /> : "—";
      },
    },
    { id: "spent", header: "Spent", accessor: (r) => Number(r.status.spent ?? 0), numeric: true, cell: (r) => <Money amount={r.status.spent} currency={currency} /> },
    { id: "share", header: "Share", accessor: (r) => r.status.percent ?? -1, cell: (r) => <div className={c.meterCell}><BudgetMeter status={r.status} label={`${r.teamName}: share of budget used`} /></div> },
    { id: "projected", header: "Projected", accessor: (r) => Number(r.projected ?? 0), numeric: true, cell: (r) => <Money amount={r.projected} currency={currency} /> },
    { id: "state", header: "State", accessor: (r) => r.status.state, cell: (r) => <StatusBadge tone={stateTones[r.status.state]}>{stateLabels[r.status.state]}</StatusBadge> },
  ];
}

export function BudgetsTab() {
  const list = useQuery(budgetsQuery());
  const d = list.data;
  return (
    <ListPage<Item>
      id="admin-cost-budgets"
      caption={d ? `Budgets for ${monthLabel(d.month)}` : "Budgets"}
      columns={columns(d?.currency ?? "USD")}
      data={d?.items ?? []}
      getRowId={(r) => r.teamId}
      rowLabel={(r) => r.teamName}
      facets={facets}
      search={{ label: "Search teams", placeholder: "Team name or slug" }}
      loading={list.isLoading}
      error={list.error}
      onRetry={() => void list.refetch()}
      rowActions={(r) => [{ label: "Open", icon: <UsersRound aria-hidden />, render: <Link to="/admin/teams/$team" params={{ team: r.teamSlug }} search={{ tab: "limits" }} /> }]}
      empty={{ icon: <Wallet />, title: "No active teams." }}
      tableProps={{ defaultSort: { columnId: "share", direction: "descending" } }}
    />
  );
}
