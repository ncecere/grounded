/*
 * Team settings › Usage & spend › Agent budgets (docs/specs/agent-budgets/DESIGN.md): each agent's spend this month and its
 * own monthly budget, which the team's owners and admins set ("Set budget…"). Enforced only while the team's budget is
 * enforced; at 100% only that agent's chats stop.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { Money } from "@/components/money";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Dialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { toast } from "@/components/ui/toast/toast";
import { agentsKey } from "./common";
import s from "../shared.module.css";

type Spend = Schemas["TeamSpend"];
type AgentBudget = Schemas["AgentBudget"];
type Row = { id: string; name: string; spent: string; budget?: AgentBudget };

const stateTone = { none: "neutral", ok: "success", warning: "warning", exhausted: "danger" } as const;
const stateLabel = { none: "No budget", ok: "Within budget", warning: "Near budget", exhausted: "Used up" } as const;

/** A budget amount as typed: digits with up to six decimals ("" removes the budget). */
export function budgetProblem(text: string): string | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  return /^[0-9]{1,14}(\.[0-9]{1,6})?$/.test(t) ? undefined : "Enter an amount such as 25 or 25.50, or leave it empty for no budget.";
}

export function AgentBudgets({ team, spend, canEdit }: { team: string; spend: Spend; canEdit: boolean }) {
  const agents = useQuery({ queryKey: agentsKey(team), queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents", { params: { path: { team } } })) });
  const [editing, setEditing] = useState<Row | null>(null);
  const cur = spend.status.currency;
  const spentBy = new Map(spend.agents.map((r) => [r.key, r.spend]));
  const budgetBy = new Map((spend.agentBudgets ?? []).map((b) => [b.agentId, b]));
  const rows: Row[] = (agents.data ?? []).map((a) => ({ id: a.id, name: a.name, spent: spentBy.get(a.id) ?? "0", budget: budgetBy.get(a.id) }));
  if (agents.error) return <ErrorAlert error={agents.error} title="Couldn't load the agents" />;
  if (rows.length === 0) return null;
  const columns: DataTableColumn<Row>[] = [
    { id: "name", header: "Agent", rowHeader: true, accessor: (r) => r.name },
    { id: "spent", header: "Spent this month", numeric: true, accessor: (r) => Number(r.spent), cell: (r) => <Money amount={r.spent} currency={cur} /> },
    {
      id: "budget",
      header: "Budget",
      numeric: true,
      accessor: (r) => Number(r.budget?.amount ?? -1),
      cell: (r) => (r.budget?.amount ? <Money amount={r.budget.amount} currency={cur} /> : <span className={s.muted}>None</span>),
    },
    {
      id: "state",
      header: "State",
      accessor: (r) => r.budget?.state ?? "none",
      cell: (r) =>
        r.budget ? (
          <StatusBadge tone={stateTone[r.budget.state]}>
            {stateLabel[r.budget.state]}
            {r.budget.enforced ? "" : " · not enforced"}
          </StatusBadge>
        ) : (
          <span className={s.muted}>—</span>
        ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: <VisuallyHidden>Actions</VisuallyHidden>,
            label: "Actions",
            hideable: false,
            cell: (r: Row) => (
              <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                {r.budget ? "Change budget" : "Set budget"} <VisuallyHidden>for {r.name}</VisuallyHidden>
              </Button>
            ),
          } satisfies DataTableColumn<Row>,
        ]
      : []),
  ];
  return (
    <>
      <DataTable
        caption="Agent budgets"
        showCaption
        density="compact"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
      />
      <p className={s.muted}>
        An agent's budget stops only that agent's chats at 100%, while the team's budget is enforced; the team's budget still applies to every agent.
      </p>
      {editing && <BudgetDialog team={team} row={editing} currency={cur} onClose={() => setEditing(null)} />}
    </>
  );
}

function BudgetDialog({ team, row, currency, onClose }: { team: string; row: Row; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(row.budget?.amount ?? "");
  const [submitted, setSubmitted] = useState(false);
  const problem = budgetProblem(text);
  const save = useMutation({
    mutationFn: async (amount: string | null) =>
      unwrap(
        await api.PUT("/v1/teams/{team}/agents/{agentId}/budget", {
          params: { path: { team, agentId: row.id }, header: ifMatch(row.budget?.revision ?? 1) },
          body: { amount },
        }),
      ),
    onSuccess: (b) => {
      toast.success(b.amount ? `${row.name}'s budget was saved` : `${row.name}'s budget was removed`);
      void qc.invalidateQueries({ queryKey: ["team", team, "spend"] });
      onClose();
    },
  });
  const submit = () => {
    setSubmitted(true);
    if (!problem) save.mutate(text.trim() === "" ? null : text.trim());
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Budget for ${row.name}`}
      description={`A monthly amount in ${currency}. Leave it empty for no budget of its own.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            Save budget
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Field label="Monthly budget" error={submitted ? problem : undefined}>
          <Input value={text} inputMode="decimal" autoFocus onChange={(e) => (save.reset(), setText(e.target.value))} />
        </Field>
        <ErrorAlert error={save.error} />
      </Stack>
    </Dialog>
  );
}
