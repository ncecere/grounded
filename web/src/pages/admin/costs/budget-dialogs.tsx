/*
 * The team budget dialogs (docs/costs.md §4): change the cost tracking, budget
 * and threshold (If-Match), and grant an extension. The team's Budget card and
 * Costs → Budgets ("Change budget…") open the same dialog.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loading } from "@/components/ui/spinner/spinner";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { amountError, modeLabels, monthLabel, overrideLabels, useCostSettings } from "@/lib/costs";
import { formatMoney } from "@/lib/format";
import c from "./costs.module.css";

type TeamBudget = Schemas["TeamBudget"];
type Override = Schemas["CostModeOverride"];

export const teamBudgetQuery = (team: string) => ({
  queryKey: ["admin", "team", team, "budget"],
  queryFn: async () =>
    unwrap(
      await api.GET("/v1/admin/teams/{team}/budget", {
        params: { path: { team } },
      }),
    ),
});

function useSaved(team: string, onClose: () => void, title: string) {
  const qc = useQueryClient();
  return (tb: TeamBudget) => {
    qc.setQueryData(teamBudgetQuery(team).queryKey, tb);
    qc.invalidateQueries({ queryKey: ["admin", "costs"] });
    toast.success(title, tb.teamName);
    onClose();
  };
}

export function BudgetDialog({ team, budget, onClose }: { team: string; budget: TeamBudget; onClose: () => void }) {
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
          body: {
            mode,
            amount: amount.trim() || null,
            warnPercent: warn.trim() ? w : null,
          },
        }),
      ),
    onSuccess: saved,
  });
  const platform = useCostSettings().data;
  const cur = budget.status.currency;
  const fallback = budget.defaultBudget
    ? `Leave empty to use the platform default budget, ${formatMoney(budget.defaultBudget, cur)} a month.`
    : "Leave empty for no budget: the platform has no default budget.";
  return (
    <FormDialog
      title={`Budget of ${budget.teamName}`}
      description={`Set how much ${budget.teamName} can spend each month and what happens at the limit.`}
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
        <Field
          label="Cost tracking"
          description={`Inherit follows the platform setting${platform ? ` (${modeLabels[platform.mode]})` : ""}; another choice applies to this team only, for example to pilot Enforce.`}
        >
          <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as Override)}>
            {(["inherit", "off", "track", "enforce"] as const).map((m) => (
              <option key={m} value={m}>
                {overrideLabels[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <ul className={c.modeList} aria-label="What each choice does">
          <li>
            <strong>Off:</strong> nothing is tracked or refused.
          </li>
          <li>
            <strong>Track only:</strong> progress against the budget, never blocks.
          </li>
          <li>
            <strong>Enforce:</strong> chats, searches and ingestion stop at 100%; raising the budget lets them continue at once.
          </li>
        </ul>
        <Field label={`Monthly budget (${cur})`} description={fallback} error={submitted ? amountErr : undefined}>
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

export function ExtensionDialog({ team, budget, onClose }: { team: string; budget: TeamBudget; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const amountErr = amountError(amount, "amount") ?? (Number(amount) > 0 ? undefined : "The extension must be more than zero.");
  const reasonErr = reason.trim() ? undefined : "Give a reason.";
  const saved = useSaved(team, onClose, "Extension granted");
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/admin/teams/{team}/budget/extensions", {
          params: { path: { team } },
          body: { amount: amount.trim(), reason: reason.trim() },
        }),
      ),
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

/** "Change budget…" from a row of Costs → Budgets: the same dialog, once the team's budget has loaded. */
export function ChangeBudgetDialog({ team, onClose }: { team: string; onClose: () => void }) {
  const q = useQuery(teamBudgetQuery(team));
  if (q.data) return <BudgetDialog team={team} budget={q.data} onClose={onClose} />;
  return (
    <FormDialog title="Change budget" onClose={onClose} submitLabel="Save budget" submitDisabled onSubmit={() => {}}>
      {q.error ? <ErrorAlert error={q.error} title="Couldn't load the team's budget" /> : <Loading label="Loading the team's budget…" />}
    </FormDialog>
  );
}
