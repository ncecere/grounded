/* Costs › Budgets: every active team's mode, budget (enforced, or tracked: progress only), month-to-date spend, share and projection; a team opens its page (its Overview has the Budget card). */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, UsersRound, Wallet } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage } from "@/components/templates/list-page";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { budgetThisMonth, monthLabel, stateLabels } from "@/lib/costs";
import { Money } from "@/components/money";
import { useCurrentUser } from "@/session";
import { ChangeBudgetDialog } from "./budget-dialogs";
import { BudgetMeter, BudgetStateBadge, ModeText } from "./budget-parts";
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
    // A Track-only team over its budget is near budget here: nothing of it is paused.
    accessor: (r) => (!r.status.enforced && r.status.state === "exhausted" ? "warning" : r.status.state),
    options: (["exhausted", "warning", "ok", "none"] as const).map((v) => ({
      value: v,
      label: stateLabels[v],
    })),
  },
];

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
          primary={<TextLink render={<Link to="/admin/teams/$team" params={{ team: r.teamSlug }} />}>{r.teamName}</TextLink>}
          secondary={r.teamSlug}
        />
      ),
    },
    {
      id: "mode",
      header: "Mode",
      // Low priority on a phone (under 600px): the Columns menu brings it back.
      defaultHiddenNarrow: true,
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
    {
      id: "spent",
      header: "Spent",
      accessor: (r) => Number(r.status.spent ?? 0),
      numeric: true,
      cell: (r) => <Money amount={r.status.spent} currency={currency} />,
    },
    {
      id: "share",
      header: "Share",
      defaultHiddenNarrow: true,
      accessor: (r) => r.status.percent ?? -1,
      cell: (r) => (
        <div className={c.meterCell}>
          <BudgetMeter status={r.status} label={`${r.teamName}: share of budget used`} />
        </div>
      ),
    },
    {
      id: "projected",
      header: "Projected",
      defaultHiddenNarrow: true,
      accessor: (r) => Number(r.projected ?? 0),
      numeric: true,
      cell: (r) => <Money amount={r.projected} currency={currency} />,
    },
    {
      id: "state",
      header: "State",
      accessor: (r) => r.status.state,
      cell: (r) => <BudgetStateBadge status={r.status} />,
    },
  ];
}

export function BudgetsTab() {
  const list = useQuery(budgetsQuery());
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  const [editing, setEditing] = useState<string | null>(null);
  const d = list.data;
  return (
    <>
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
        rowActions={(r) => [
          ...(isAdmin
            ? [
                {
                  label: "Change budget…",
                  icon: <Pencil aria-hidden />,
                  onSelect: () => setEditing(r.teamSlug),
                },
              ]
            : []),
          {
            label: "Open",
            icon: <UsersRound aria-hidden />,
            render: <Link to="/admin/teams/$team" params={{ team: r.teamSlug }} />,
          },
        ]}
        empty={{ icon: <Wallet />, title: "No active teams." }}
        tableProps={{
          defaultSort: { columnId: "share", direction: "descending" },
        }}
      />
      {editing && <ChangeBudgetDialog team={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
