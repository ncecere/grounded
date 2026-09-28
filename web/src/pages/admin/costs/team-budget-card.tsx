/*
 * A team's Budget card on its admin page (Limits tab; docs/costs.md §5):
 * mode override, monthly budget, this month's spend and extensions. Platform
 * admins change the budget (If-Match) and grant extensions; auditors read.
 * Hidden while costs are off for the whole platform and the team inherits.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { dayLabel } from "@/components/analytics/format";
import { FormDialog } from "@/components/form-dialog";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { Loading } from "@/components/ui/spinner/spinner";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { amountError, modeLabels, monthLabel, overrideLabels, stateLabels, stateTones, useCostSettings } from "@/lib/costs";
import { formatMoney } from "@/lib/format";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import { BudgetMeter } from "./budgets";
import c from "./costs.module.css";

type TeamBudget = Schemas["TeamBudget"];
type Override = Schemas["CostModeOverride"];

export const teamBudgetQuery = (team: string) => ({
  queryKey: ["admin", "team", team, "budget"],
  queryFn: async () => unwrap(await api.GET("/v1/admin/teams/{team}/budget", { params: { path: { team } } })),
});

export function AdminTeamBudgetCard({ team }: { team: string }) {
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  const settings = useCostSettings();
  const q = useQuery(teamBudgetQuery(team));
  const [editing, setEditing] = useState(false);
  const [extending, setExtending] = useState(false);
  if (q.isLoading || settings.isLoading) return <Loading label="Loading the team's budget…" />;
  if (!q.data) return <ErrorAlert error={q.error ?? settings.error} title="Couldn't load the team's budget" />;
  const b = q.data;
  if (settings.data?.mode === "off" && b.modeOverride === "inherit") return null;
  const st = b.status;
  const cur = st.currency;
  const enforced = st.mode === "enforce";
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
              <Pencil aria-hidden /> Change budget
            </Button>
          </div>
        )
      }
    >
      <div className={c.cardBody}>
        <DescriptionList
          items={[
            { label: "Mode", value: `${modeLabels[st.mode]}${b.modeOverride === "inherit" ? " (platform setting)" : " (set for this team)"}` },
            { label: "Monthly budget", value: b.amount ? formatMoney(b.amount, cur) : b.defaultBudget ? `${formatMoney(b.defaultBudget, cur)} (platform default)` : "None" },
            { label: "Warning at", value: `${st.warnPercent}%${b.warnPercent === null ? " (platform setting)" : ""}` },
            { label: "Spent this month", value: formatMoney(st.spent, cur) },
            { label: "State", value: <StatusBadge tone={stateTones[st.state]}>{stateLabels[st.state]}</StatusBadge> },
          ]}
        />
        {enforced && st.limit !== null && <BudgetMeter status={st} label={`${b.teamName}: share of this month's budget used`} />}
        {b.extensions.length > 0 && (
          <Table caption="Extensions this month" showCaption columns={["Added", { label: "Amount", numeric: true }, "Reason", "By"]} density="compact">
            {b.extensions.map((e) => (
              <Tr key={e.id}>
                <Td nowrap>{dayLabel(e.createdAt.slice(0, 10))}</Td>
                <Td numeric>{formatMoney(e.amount, cur)}</Td>
                <Td>{e.reason}</Td>
                <Td muted>{e.createdByName || "—"}</Td>
              </Tr>
            ))}
          </Table>
        )}
        {!enforced && <p className={s.muted}>Budgets apply only when the mode is Enforce.</p>}
      </div>
      {editing && <BudgetDialog team={team} budget={b} onClose={() => setEditing(false)} />}
      {extending && <ExtensionDialog team={team} budget={b} onClose={() => setExtending(false)} />}
    </Card>
  );
}

function useSaved(team: string, onClose: () => void, title: string) {
  const qc = useQueryClient();
  return (tb: TeamBudget) => {
    qc.setQueryData(teamBudgetQuery(team).queryKey, tb);
    qc.invalidateQueries({ queryKey: ["admin", "costs"] });
    toast.success(title, tb.teamName);
    onClose();
  };
}

function BudgetDialog({ team, budget, onClose }: { team: string; budget: TeamBudget; onClose: () => void }) {
  const [mode, setMode] = useState<Override>(budget.modeOverride);
  const [amount, setAmount] = useState(budget.amount ? String(Number(budget.amount)) : "");
  const [warn, setWarn] = useState(budget.warnPercent === null ? "" : String(budget.warnPercent));
  const [submitted, setSubmitted] = useState(false);
  const amountErr = amountError(amount, "budget", false);
  const w = Number(warn);
  const warnErr = warn.trim() && (!Number.isInteger(w) || w < 1 || w > 100) ? "Enter a whole percentage from 1 to 100, or leave it empty." : undefined;
  const saved = useSaved(team, onClose, "Budget saved");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT("/v1/admin/teams/{team}/budget", {
          params: { path: { team }, header: ifMatch(budget.revision) },
          body: { mode, amount: amount.trim() || null, warnPercent: warn.trim() ? w : null },
        }),
      ),
    onSuccess: saved,
  });
  return (
    <FormDialog
      title={`Budget of ${budget.teamName}`}
      description="Raising the budget lets waiting chats, searches and ingestion continue at once."
      onClose={onClose}
      submitLabel="Save budget"
      busy={save.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (!amountErr && !warnErr) save.mutate();
      }}
    >
      <div className={c.formGrid}>
        <Field label="Mode" description="Inherit follows the platform setting; another mode applies to this team only, for example to pilot Enforce.">
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as Override)}>
            {(["inherit", "off", "track", "enforce"] as const).map((m) => (
              <option key={m} value={m}>
                {overrideLabels[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={`Monthly budget (${budget.status.currency})`} description="Leave empty to use the platform default budget." error={submitted ? amountErr : undefined}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Warning threshold (%)" description="Leave empty to use the platform threshold." error={submitted ? warnErr : undefined}>
          <Input type="number" min={1} max={100} value={warn} onChange={(e) => setWarn(e.target.value)} />
        </Field>
        <ErrorAlert error={save.error} />
      </div>
    </FormDialog>
  );
}

function ExtensionDialog({ team, budget, onClose }: { team: string; budget: TeamBudget; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const amountErr = amountError(amount, "amount") ?? (Number(amount) > 0 ? undefined : "The extension must be more than zero.");
  const reasonErr = reason.trim() ? undefined : "Give a reason.";
  const saved = useSaved(team, onClose, "Extension granted");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/admin/teams/{team}/budget/extensions", { params: { path: { team } }, body: { amount: amount.trim(), reason: reason.trim() } })),
    onSuccess: saved,
  });
  return (
    <FormDialog
      title={`Grant ${budget.teamName} an extension`}
      description={`Adds to this month's budget only (${monthLabel(budget.status.month)}); it lapses when the month ends. Waiting work continues at once.`}
      onClose={onClose}
      submitLabel="Grant extension"
      busy={save.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (!amountErr && !reasonErr) save.mutate();
      }}
    >
      <div className={c.formGrid}>
        <Field label={`Amount (${budget.status.currency})`} error={submitted ? amountErr : undefined}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" description="Recorded in the audit log." error={submitted ? reasonErr : undefined}>
          <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorAlert error={save.error} />
      </div>
    </FormDialog>
  );
}
