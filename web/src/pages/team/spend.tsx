/*
 * Team settings › Usage & limits › Spend this month (E2, docs/costs.md §5):
 * for the team's owners and admins (and platform staff) while its cost mode
 * isn't Off: month-to-date spend with the budget meter when enforced, and
 * spend by agent and model. Editors and members see no money.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, unwrap, type Schemas } from "@/api/client";
import { num } from "@/components/analytics/format";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { monthLabel, stateLabels, stateTones } from "@/lib/costs";
import { formatMoney } from "@/lib/format";
import { BudgetMeter } from "../admin/costs/budgets";
import s from "../shared.module.css";
import u from "./usage.module.css";

type Row = Schemas["CostReportRow"];

export const teamSpendQuery = (team: string) => ({
  queryKey: ["team", team, "spend"],
  queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/spend", { params: { path: { team } } })),
  retry: false,
});

function SpendTable({ caption, first, rows, currency }: { caption: string; first: string; rows: Row[]; currency: string }) {
  if (rows.length === 0) return null;
  return (
    <Table caption={caption} showCaption columns={[first, { label: "Spend", numeric: true }, { label: "Tokens", numeric: true }, { label: "Requests", numeric: true }]} density="compact">
      {rows.map((r) => (
        <Tr key={r.key || "none"}>
          <Td>
            {r.deleted ? `${r.label || "Deleted"} (deleted)` : r.label}{" "}
            {r.unpriced && (
              <Badge tone="warning" size="sm">
                Unpriced
              </Badge>
            )}
          </Td>
          <Td numeric>{formatMoney(r.spend, currency)}</Td>
          <Td numeric>{num(r.tokens)}</Td>
          <Td numeric>{num(r.requests)}</Td>
        </Tr>
      ))}
    </Table>
  );
}

export function TeamSpendCard({ team }: { team: string }) {
  const q = useQuery(teamSpendQuery(team));
  if (q.error instanceof ApiError && q.error.status === 404) return null; // cost tracking is off
  if (q.isLoading) return <Loading label="Loading spend…" />;
  if (!q.data) return <ErrorAlert error={q.error} title="Couldn't load spend" />;
  const d = q.data;
  const st = d.status;
  const cur = st.currency;
  return (
    <Card
      title="Spend this month"
      description={`${monthLabel(st.month)}, in ${d.timeZone} days. Platform admins set prices and budgets.`}
      actions={st.state !== "none" && <StatusBadge tone={stateTones[st.state]}>{stateLabels[st.state]}</StatusBadge>}
    >
      <div className={u.body}>
        {st.mode === "enforce" && st.limit !== null ? (
          <BudgetMeter status={st} label="Share of this month's budget used" />
        ) : (
          <p>
            <strong>{formatMoney(st.spent, cur)}</strong> <span className={s.muted}>so far this month</span>
          </p>
        )}
        {st.mode === "enforce" && st.limit !== null && (
          <p className={s.muted}>
            {formatMoney(st.spent, cur)} of {formatMoney(st.limit, cur)}
            {st.extensions && Number(st.extensions) > 0 ? ` (including ${formatMoney(st.extensions, cur)} of extensions)` : ""}. At 100% the team's chats, searches and ingestion stop until
            the month ends or a platform admin raises the budget.
          </p>
        )}
        {d.total.unpriced && <p className={s.muted}>Some usage has no price yet, so it counts as zero.</p>}
        <SpendTable caption="By agent" first="Agent" rows={d.agents} currency={cur} />
        <SpendTable caption="By model" first="Model" rows={d.models} currency={cur} />
      </div>
    </Card>
  );
}
