/*
 * Team settings › Usage & limits › Spend this month (E2, docs/costs.md §5):
 * for the team's owners and admins (and platform staff) while its cost mode
 * isn't Off: month-to-date spend with the budget meter (enforced, or tracked:
 * progress only, "Tracking: 12% of $5.00 · not enforced"), and
 * spend by agent and model. Editors and members see no money.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, api, unwrap, type Schemas } from "@/api/client";
import { num } from "@/components/analytics/format";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { monthLabel, requestsColumn, requestsHint, trackingText } from "@/lib/costs";
import { Money } from "@/components/money";
import { BudgetMeter, BudgetStateBadge } from "../admin/costs/budget-parts";
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
    <Table
      caption={caption}
      showCaption
      columns={[first, { label: "Spend", numeric: true }, { label: "Tokens", numeric: true }, { label: requestsColumn, numeric: true }]}
      density="compact"
    >
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
          <Td numeric>
            <Money amount={r.spend} currency={currency} />
          </Td>
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
  const tracking = trackingText(st);
  return (
    <Card
      title="Spend this month"
      description={`${monthLabel(st.month)}. Platform admins set prices and budgets.`}
      actions={st.state !== "none" && <BudgetStateBadge status={st} />}
    >
      <div className={u.body}>
        {st.limit !== null ? (
          <BudgetMeter status={st} label="Share of this month's budget used" />
        ) : (
          <p>
            <strong>
              <Money amount={st.spent} currency={cur} />
            </strong>{" "}
            <span className={s.muted}>so far this month</span>
          </p>
        )}
        {!st.enforced && tracking && <p className={s.muted}>{tracking}. Nothing stops at 100%: Track only shows progress against the budget.</p>}
        {st.enforced && st.limit !== null && (
          <p className={s.muted}>
            <Money amount={st.spent} currency={cur} /> of <Money amount={st.limit} currency={cur} />
            {st.extensions && Number(st.extensions) > 0 && (
              <>
                {" "}
                (including <Money amount={st.extensions} currency={cur} /> of extensions)
              </>
            )}
            . At 100% the team's chats, searches and ingestion stop until the month ends or a platform admin raises the budget.
          </p>
        )}
        {d.total.unpriced && <p className={s.muted}>Some usage has no price yet, so it counts as zero.</p>}
        <SpendTable caption="By agent" first="Agent" rows={d.agents} currency={cur} />
        <SpendTable caption="By model" first="Model" rows={d.models} currency={cur} />
        {(d.agents.length > 0 || d.models.length > 0) && <p className={s.muted}>Requests: {requestsHint}</p>}
      </div>
    </Card>
  );
}
