/*
 * A team's Budget card on its admin page (Overview tab, v0.2.1 I7; docs/costs.md
 * §5): mode override, monthly budget, this month's spend and extensions, and
 * a Track-only budget's progress ("Tracking: 12% of $5.00 · not enforced"). Platform
 * admins change the budget (If-Match) and grant extensions; auditors read.
 * Hidden while costs are off for the whole platform and the team inherits.
 */
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { dayLabel } from "@/components/analytics/format";
import { Money } from "@/components/money";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import type { Schemas } from "@/api/client";
import { Card } from "@/components/ui/card/card";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { budgetThisMonth, monthLabel, trackingText, useCostSettings } from "@/lib/costs";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import { BudgetDialog, ExtensionDialog, RevokeExtensionDialog, teamBudgetQuery } from "./budget-dialogs";
import { BudgetMeter, BudgetStateBadge, ModeText } from "./budget-parts";
import c from "./costs.module.css";

export function AdminTeamBudgetCard({ team }: { team: string }) {
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  const settings = useCostSettings();
  const q = useQuery(teamBudgetQuery(team));
  const [editing, setEditing] = useState(false);
  const [extending, setExtending] = useState(false);
  const [revoking, setRevoking] = useState<Schemas["BudgetExtension"] | null>(null);
  if (q.isLoading || settings.isLoading) return <Loading label="Loading the team's budget…" />;
  if (!q.data) return <ErrorAlert error={q.error ?? settings.error} title="Couldn't load the team's budget" />;
  const b = q.data;
  if (settings.data?.mode === "off" && b.modeOverride === "inherit") return null;
  const st = b.status;
  const cur = st.currency;
  const enforced = st.enforced;
  // A budget in force is enforced or tracked (progress only); with costs off, extensions are history.
  const inForce = st.limit !== null;
  const tracking = trackingText(st);
  const thisMonth = budgetThisMonth(st, { platformDefault: !b.amount });
  const own = b.amount ? (
    <Money amount={b.amount} currency={cur} />
  ) : b.defaultBudget ? (
    <>
      <Money amount={b.defaultBudget} currency={cur} /> (platform default)
    </>
  ) : (
    "None"
  );
  return (
    <Card
      title="Budget"
      description={`${monthLabel(st.month)}. Resets on ${dayLabel(st.resetsAt.slice(0, 10))}.`}
      actions={
        isAdmin && (
          <div className={c.actions}>
            {enforced && (
              <Button size="sm" variant="secondary" onClick={() => setExtending(true)}>
                <Plus aria-hidden /> Grant extension
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Change budget…
            </Button>
          </div>
        )
      }
    >
      <div className={c.cardBody}>
        <DescriptionList
          items={[
            {
              label: "Cost tracking",
              value: <ModeText mode={st.mode} override={b.modeOverride} />,
            },
            thisMonth
              ? {
                  label: "Budget this month",
                  value: <span title={thisMonth.exact}>{thisMonth.parts ? `${thisMonth.total} (${thisMonth.parts})` : thisMonth.total}</span>,
                }
              : { label: "Monthly budget", value: own },
            {
              label: "Warning at",
              value: `${st.warnPercent}%${b.warnPercent === null ? " (platform setting)" : ""}`,
            },
            {
              label: "Spent this month",
              value: <Money amount={st.spent} currency={cur} />,
            },
            { label: "State", value: <BudgetStateBadge status={st} /> },
          ]}
        />
        {inForce && <BudgetMeter status={st} label={`${b.teamName}: share of this month's budget used`} />}
        {tracking && <p className={s.muted}>{tracking}: Track only shows progress against the budget and never blocks or notifies anyone.</p>}
        {b.extensions.length > 0 && (
          <Table
            caption={inForce ? "Extensions this month" : "Extensions granted this month (not counted: no budget is in force)"}
            showCaption
            columns={["Added", { label: "Amount", numeric: true }, "Reason", "By", ...(isAdmin ? [{ label: "Actions", hideLabel: true }] : [])]}
            density="compact"
          >
            {b.extensions.map((e) => (
              <Tr key={e.id}>
                <Td nowrap>{dayLabel(e.createdAt.slice(0, 10))}</Td>
                <Td numeric>
                  <Money amount={e.amount} currency={cur} />
                </Td>
                <Td>{e.reason}</Td>
                <Td muted>{e.createdByName || "—"}</Td>
                {isAdmin && (
                  <Td>
                    <Button size="sm" variant="ghost" aria-label={`Revoke the extension of ${dayLabel(e.createdAt.slice(0, 10))}: ${e.reason}`} onClick={() => setRevoking(e)}>
                      Revoke
                    </Button>
                  </Td>
                )}
              </Tr>
            ))}
          </Table>
        )}
        {st.mode === "off" && <p className={s.muted}>Cost tracking is off for this team: budgets apply in Track only (progress) and Enforce.</p>}
      </div>
      {editing && <BudgetDialog team={team} budget={b} onClose={() => setEditing(false)} />}
      {extending && <ExtensionDialog team={team} budget={b} onClose={() => setExtending(false)} />}
      <RevokeExtensionDialog team={team} extension={revoking} currency={cur} onClose={() => setRevoking(null)} />
    </Card>
  );
}
