/*
 * Team settings › Usage & spend › Spend this month (E2, docs/costs.md §5; I4,
 * docs/v0.2.1.md): for the team's owners and admins (and platform staff)
 * while its cost mode isn't Off. The spend is one strip ("$0.24 of $1.20 this
 * month · 19% · Within budget · resets Oct 1", with a meter; a Track-only
 * budget adds "not enforced"), shared with the team Overview; spend by agent
 * and by model sits in a "Spend breakdown" disclosure. Editors and members
 * see no money.
 */
import { useQuery } from "@tanstack/react-query";
import { ApiError, type Schemas } from "@/api/client";
import { teamSpendQuery } from "@/api/queries";
import { num } from "@/components/analytics/format";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { budgetStateLabel, monthLabel, requestsColumn, requestsHint, type TeamBudgetState } from "@/lib/costs";
import { Money } from "@/components/money";
import { BudgetMeter } from "../admin/costs/budget-parts";
import s from "../shared.module.css";
import u from "./usage.module.css";

type Row = Schemas["CostReportRow"];

export { teamSpendQuery };

/** The team's spend this month; `off` while its cost mode is Off (the API's 404). Only owners, admins and platform staff may ask. */
export function useTeamSpend(team: string, enabled = true) {
  const q = useQuery({ ...teamSpendQuery(team), enabled });
  const off = q.error instanceof ApiError && q.error.status === 404;
  return { ...q, off };
}

/** "Oct 1": the first day of the next budget month, from this month's first day (a date in the platform's zone). */
export function resetDay(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m ?? 1, 1)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The strip's parts after the amount: "19%", "Within budget", "not enforced", "resets Oct 1". */
export function stripParts(st: TeamBudgetState): string[] {
  const parts: string[] = [];
  if (st.limit !== null) parts.push(`${st.percent ?? 0}%`);
  if (st.state !== "none") parts.push(budgetStateLabel(st));
  if (!st.enforced && st.state !== "none") parts.push("not enforced");
  parts.push(`resets ${resetDay(st.month)}`);
  return parts;
}

/** Spend this month in one line, with the budget meter when there is a budget. */
export function SpendStrip({ status: st }: { status: TeamBudgetState }) {
  const cur = st.currency;
  return (
    <div className={u.strip}>
      <p className={u.stripText}>
        <strong>
          <Money amount={st.spent} currency={cur} />
        </strong>{" "}
        {st.limit !== null ? (
          <>
            of <Money amount={st.limit} currency={cur} /> this month
          </>
        ) : (
          "so far this month"
        )}
        {stripParts(st).map((p) => (
          <span key={p} className={p === "not enforced" || p.startsWith("resets") ? s.muted : undefined}>
            {" · "}
            {p}
          </span>
        ))}
      </p>
      {st.limit !== null && (
        <div className={u.stripMeter}>
          <BudgetMeter status={st} label="Share of this month's budget used" />
        </div>
      )}
    </div>
  );
}

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

/** What 100% means for an enforced budget, with this month's extensions. */
function EnforcedNote({ status: st }: { status: TeamBudgetState }) {
  if (!st.enforced || st.limit === null) return null;
  return (
    <p className={s.muted}>
      {st.extensions && Number(st.extensions) > 0 && (
        <>
          The budget includes <Money amount={st.extensions} currency={st.currency} /> of extensions.{" "}
        </>
      )}
      At 100% the team's chats, searches and ingestion stop until the month ends or a platform admin raises the budget.
    </p>
  );
}

export function TeamSpendCard({ team }: { team: string }) {
  const q = useTeamSpend(team);
  if (q.off) return null;
  if (q.isLoading) return <Loading label="Loading spend…" />;
  if (!q.data) return <ErrorAlert error={q.error} title="Couldn't load spend" />;
  const d = q.data;
  const st = d.status;
  const cur = st.currency;
  const rows = d.agents.length + d.models.length;
  return (
    <Card title="Spend this month" description={`${monthLabel(st.month)}. Platform admins set prices and budgets.`}>
      <div className={u.body}>
        <SpendStrip status={st} />
        <EnforcedNote status={st} />
        {d.total.unpriced && <p className={s.muted}>Some usage has no price yet, so it counts as zero.</p>}
        {rows > 0 && (
          <Disclosure title="Spend breakdown" summary="This month's spend by agent and by model.">
            <div className={u.body}>
              <SpendTable caption="By agent" first="Agent" rows={d.agents} currency={cur} />
              <SpendTable caption="By model" first="Model" rows={d.models} currency={cur} />
              <p className={s.muted}>Requests: {requestsHint}</p>
            </div>
          </Disclosure>
        )}
      </div>
    </Card>
  );
}
