/*
 * Admin → Models → Reranking › Settings (docs/v0.4.2.md OW-2): the rerank model, candidates and time limit, moved here
 * from the Models page's dialog. Choosing a model that isn't healthy warns on the page and asks before saving (AD-06):
 * every search would wait for a dead reranker up to the time limit.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import type { Model } from "../models/common";
import type { HealthCheck } from "../models/health";
import rr from "./reranking.module.css";

export type RerankSettings = Schemas["RerankSettings"];

export const rerankSettingsKey = ["admin", "rerank"];

export function rerankSettingsQuery() {
  return { queryKey: rerankSettingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/rerank")) };
}

export function useRerankSettings() {
  return useQuery(rerankSettingsQuery());
}

/** Shown to auditors instead of the save bar, the way locked Features switches say why. */
export const rerankLockedReason = "You can view these settings. Only platform admins can change reranking.";

type Problems = { candidates?: string; timeLimitMs?: string };

const wholeIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

/** Each field's problem, checked before saving (the server checks the same ranges). */
export function rerankProblems(candidates: string, timeLimit: string): Problems {
  const out: Problems = {};
  if (!wholeIn(candidates, 5, 50)) out.candidates = "Enter a whole number from 5 to 50.";
  if (!wholeIn(timeLimit, 200, 10000)) out.timeLimitMs = "Enter a whole number of milliseconds from 200 to 10,000.";
  return out;
}

/** The server's problems by field (details.problems), for any it finds that the form didn't. */
function serverProblems(error: unknown): Problems {
  if (!(error instanceof ApiError) || error.code !== "invalid_settings") return {};
  const list = (error.details?.problems as { field: string; problem: string }[] | undefined) ?? [];
  return Object.fromEntries(list.map((p) => [p.field, p.problem.endsWith(".") ? p.problem : `${p.problem}.`]));
}

/** A model's stored health in words: "Healthy", "Failing" or "Not tested". */
export function healthWord(check?: HealthCheck) {
  if (!check) return "Not tested";
  return check.status === "healthy" ? "Healthy" : "Failing";
}

/** Why a rerank model shouldn't be chosen yet, or undefined when it is enabled and its last test passed. */
export function unhealthyReason(model: Model, check?: HealthCheck) {
  if (!model.enabled) return `${model.displayName} is disabled, so searches aren't reranked until it is enabled again.`;
  if (!check) return `${model.displayName} hasn't been tested.`;
  if (check.status !== "healthy") return `${model.displayName} failed its last test.`;
  return undefined;
}

const consequence = "Until it works, every search waits for it up to the time limit and then keeps the usual order.";

type Form = { modelId: string; candidates: string; timeLimit: string };

const formOf = (st: RerankSettings): Form => ({ modelId: st.modelId ?? "", candidates: String(st.candidates), timeLimit: String(st.timeLimitMs) });

function useSave(saved: RerankSettings) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: Form) =>
      unwrap(
        await api.PUT("/v1/admin/rerank", {
          params: { header: ifMatch(saved.revision) },
          body: { modelId: f.modelId || null, candidates: Number(f.candidates), timeLimitMs: Number(f.timeLimit) },
        }),
      ),
    onSuccess: (st) => {
      qc.setQueryData(rerankSettingsKey, st);
      void qc.invalidateQueries({ queryKey: ["admin", "catalog-usage"] });
      void qc.invalidateQueries({ queryKey: ["rerank", "status"] });
      toast.success("Reranking settings saved");
    },
  });
}

type Props = { saved: RerankSettings; models: Model[]; health: (id: string) => HealthCheck | undefined; isAdmin: boolean };

/** The settings form; keyed by the saved revision, so a save (or someone else's) starts it again from what's saved. */
export function RerankSettingsForm({ saved, models, health, isAdmin }: Props) {
  const [form, setForm] = useState(() => formOf(saved));
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = useSave(saved);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const own = rerankProblems(form.candidates, form.timeLimit);
  const fromServer = serverProblems(save.error);
  const problems = { ...fromServer, ...(submitted ? own : {}) };
  const initial = formOf(saved);
  const changes = (Object.keys(initial) as (keyof Form)[]).filter((k) => form[k].trim() !== initial[k]).length;
  const selected = models.find((m) => m.id === form.modelId);
  const warning = selected && unhealthyReason(selected, health(selected.id));
  // Saving the same settings would start a new revision (and retire every saved answer), so the bar only shows on a change.
  const submit = () => {
    setSubmitted(true);
    save.reset();
    if (Object.keys(own).length > 0) return;
    if (warning && form.modelId !== initial.modelId) setConfirming(true);
    else save.mutate(form);
  };
  const invalid = submitted && Object.keys(own).length > 0;
  return (
    <SettingsPage
      dirty={changes > 0}
      canEdit={isAdmin}
      readOnlyNote={rerankLockedReason}
      saving={save.isPending}
      error={Object.keys(fromServer).length ? undefined : save.error}
      saveLabel="Save settings"
      message={invalid ? `Not saved: ${Object.values(own)[0]}` : changes === 1 ? "1 unsaved change" : `${changes} unsaved changes`}
      onSave={submit}
      onDiscard={() => {
        setForm(initial);
        setSubmitted(false);
        save.reset();
      }}
    >
      <SettingsSection id="settings" title="Settings" description="Agents can turn reranking off for themselves in Build → Advanced.">
        <Field label="Rerank model" description="Rerank models from Admin → Models, with their last test." className={rr.field}>
          <NativeSelect disabled={!isAdmin} value={form.modelId} onChange={(e) => set({ modelId: e.target.value })}>
            <option value="">None (searches aren't reranked)</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.upstreamModel}) · {m.enabled ? healthWord(health(m.id)) : "Disabled"}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {selected && warning && (
          <Alert tone="warning" title="This model may not work">
            {warning} {consequence}{" "}
            <TextLink render={<Link to="/admin/models" search={{ record: selected.id } as never} />}>Test it on its page</TextLink>.
          </Alert>
        )}
        <Field label="Candidates" description="Passages a search fetches and reranks, 5 to 50." error={problems.candidates} className={rr.field}>
          <NumberInput disabled={!isAdmin} min={5} max={50} maximumFractionDigits={0} value={form.candidates} onValueChange={(v) => set({ candidates: v })} />
        </Field>
        <Field
          label="Time limit"
          description="The longest a search waits, 200 to 10,000 ms. A slower or failed call keeps the usual order."
          error={problems.timeLimitMs}
          className={rr.field}
        >
          <NumberInput disabled={!isAdmin} min={200} max={10000} maximumFractionDigits={0} unit="ms" value={form.timeLimit} onValueChange={(v) => set({ timeLimit: v })} />
        </Field>
      </SettingsSection>
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => !o && setConfirming(false)}
        tone="primary"
        title={`Rerank with ${selected?.displayName ?? "this model"}?`}
        description={`${warning ?? ""} ${consequence}`}
        confirmLabel="Save anyway"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(form, { onSuccess: () => setConfirming(false) })}
      />
    </SettingsPage>
  );
}
