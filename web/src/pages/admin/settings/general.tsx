/*
 * Admin → Settings › Money and time (AD-39): the platform currency, time zone and default monthly budget, moved here
 * from Costs → Settings (which keeps the cost tracking mode and the warning threshold). They are part of the cost
 * settings record: the write sends the other fields as they are, with If-Match, and is audited as costs.settings_update.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { useRevisionForm } from "@/components/templates/revision-form";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Combobox } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { amountError, type CostMode, costSettingsQuery, type CostSettings, modeLabels } from "@/lib/costs";
import { adminOnly } from "@/lib/terms";
import c from "../costs/costs.module.css";

/** The fields shown here, and the cost settings record's other two (Costs → Settings edits them; the save sends them as they are). */
export type GeneralForm = { currency: string; timeZone: string; defaultBudget: string; mode: CostMode; warnPercent: number };

export const generalForm = (st: CostSettings): GeneralForm => ({
  currency: st.currency,
  timeZone: st.timeZone,
  defaultBudget: st.defaultBudget ? String(Number(st.defaultBudget)) : "",
  mode: st.mode,
  warnPercent: st.warnPercent,
});

const currencyCode = /^[A-Z]{3}$/;

/** Field errors of the form (empty when valid). */
export function generalErrors(f: GeneralForm): Partial<Record<keyof GeneralForm, string>> {
  const out: Partial<Record<keyof GeneralForm, string>> = {};
  if (!currencyCode.test(f.currency.trim())) out.currency = "Enter a three-letter ISO 4217 code, such as USD or EUR.";
  if (!f.timeZone.trim()) out.timeZone = "Choose a time zone.";
  const b = amountError(f.defaultBudget, "default budget", false);
  if (b) out.defaultBudget = b;
  return out;
}

/**
 * The currency the budget field is labelled with: the one being typed once it's a valid code, else the saved one, so
 * "us" never relabels the field as "(US)" (AD-34).
 */
export const labelCurrency = (typed: string, saved: string) => (currencyCode.test(typed.trim()) ? typed.trim() : saved);

/** Every IANA zone the browser knows, with the current value kept even if it doesn't. */
function zones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const list = all.includes("UTC") ? all : ["UTC", ...all];
  return list.includes(current) ? list : [current, ...list];
}

const generalLabels = { currency: "Currency", timeZone: "Time zone", defaultBudget: "Default monthly budget", mode: "Cost tracking", warnPercent: "Warning threshold (%)" };
const costsPage = "Costs → Settings";
const revisionOptions = { labels: generalLabels, choices: { mode: modeLabels }, elsewhere: { mode: costsPage, warnPercent: costsPage } };

export function GeneralSettings({ settings, isAdmin }: { settings: CostSettings; isAdmin: boolean }) {
  const qc = useQueryClient();
  // Edits survive a change made elsewhere; SettingsPage lists it and asks whose to keep (AD-01, AD2-01). Costs → Settings
  // writes the same record: its fields are in the form too, so a change there is listed and the save sends the latest.
  const [form, setForm, revision] = useRevisionForm(generalForm(settings), settings.revision, revisionOptions);
  const [submitted, setSubmitted] = useState(false);
  const saved = generalForm(settings);
  const dirty = (Object.keys(form) as (keyof GeneralForm)[]).some((k) => form[k] !== saved[k]);
  const errors = generalErrors(form);
  const invalid = Object.keys(errors).length > 0;
  const shown = submitted ? errors : {};
  const set = <K extends keyof GeneralForm>(k: K, v: GeneralForm[K]) => setForm({ ...form, [k]: v });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT("/v1/admin/costs/settings", {
          params: { header: ifMatch(settings.revision) },
          body: {
            mode: form.mode,
            warnPercent: form.warnPercent,
            currency: form.currency.trim(),
            timeZone: form.timeZone,
            defaultBudget: form.defaultBudget.trim() || null,
          },
        }),
      ),
    onSuccess: (st) => {
      qc.setQueryData(costSettingsQuery().queryKey, st);
      void qc.invalidateQueries({ queryKey: ["admin", "costs"] });
      void qc.invalidateQueries({ queryKey: ["admin", "team"] });
      setForm(generalForm(st));
      setSubmitted(false);
      toast.success("Settings saved");
    },
    onError: () => void qc.invalidateQueries({ queryKey: costSettingsQuery().queryKey }),
  });
  return (
    <SettingsPage
      revision={revision}
      dirty={dirty}
      canEdit={isAdmin}
      readOnlyNote={adminOnly}
      saving={save.isPending}
      error={save.error}
      saveLabel="Save settings"
      message={submitted && invalid ? "Not saved: fix the highlighted field" : undefined}
      saveDisabled={submitted && invalid}
      onSave={() => {
        setSubmitted(true);
        if (!invalid) save.mutate();
      }}
      onDiscard={() => {
        setForm(saved);
        setSubmitted(false);
        save.reset();
      }}
    >
      <SettingsSection
        title="Money and time"
        description="Amounts everywhere are shown in this currency, for display only: nothing is converted. Budget months, cost report days and the date agents are told follow the time zone; daily limits reset at midnight UTC."
      >
        <div className={c.formGrid}>
          <Field label="Currency" description="A three-letter ISO 4217 code." error={shown.currency}>
            <Input value={form.currency} maxLength={3} disabled={!isAdmin} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Time zone" description="Type to search, for example New_York or Berlin." error={shown.timeZone}>
            <Combobox
              items={zones(form.timeZone).map((z) => ({ value: z, label: z }))}
              value={form.timeZone}
              onValueChange={(v) => v && set("timeZone", v)}
              placeholder="Search time zones"
              emptyText="No time zone matches."
              disabled={!isAdmin}
              autoHighlight
              limit={50}
            />
          </Field>
        </div>
      </SettingsSection>
      <SettingsSection title="Default budget" description="Enforced while cost tracking is Enforce, and shown as progress in Track only. A team's own budget, set on its page, replaces it.">
        <Field
          label={`Default monthly budget (${labelCurrency(form.currency, settings.currency)})`}
          description="For teams without their own budget. Leave empty for none: such teams are tracked but never refused."
          error={shown.defaultBudget}
        >
          <Input inputMode="decimal" value={form.defaultBudget} disabled={!isAdmin} onChange={(e) => set("defaultBudget", e.target.value)} />
        </Field>
      </SettingsSection>
    </SettingsPage>
  );
}
