/* Costs › Settings: mode, currency, time zone, warning threshold and default budget. One form and save bar; the write sends If-Match. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Link } from "@tanstack/react-router";
import { Combobox } from "@/components/ui/combobox/combobox";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { amountError, costSettingsQuery, type CostMode, type CostSettings, modeDescriptions, modeLabels } from "@/lib/costs";
import { adminOnly } from "@/lib/terms";
import { useCurrentUser } from "@/session";
import c from "./costs.module.css";

export type SettingsForm = { mode: CostMode; currency: string; timeZone: string; warnPercent: string; defaultBudget: string };

export const settingsForm = (st: CostSettings): SettingsForm => ({
  mode: st.mode,
  currency: st.currency,
  timeZone: st.timeZone,
  warnPercent: String(st.warnPercent),
  defaultBudget: st.defaultBudget ? String(Number(st.defaultBudget)) : "",
});

/** Field errors of the settings form (empty when valid). */
export function settingsErrors(f: SettingsForm): Partial<Record<keyof SettingsForm, string>> {
  const out: Partial<Record<keyof SettingsForm, string>> = {};
  if (!/^[A-Z]{3}$/.test(f.currency.trim())) out.currency = "Enter a three-letter ISO 4217 code, such as USD or EUR.";
  if (!f.timeZone.trim()) out.timeZone = "Choose a time zone.";
  const w = Number(f.warnPercent);
  if (!Number.isInteger(w) || w < 1 || w > 100) out.warnPercent = "Enter a whole percentage from 1 to 100.";
  const b = amountError(f.defaultBudget, "default budget", false);
  if (b) out.defaultBudget = b;
  return out;
}

/** Every IANA zone the browser knows, with the current value kept even if it doesn't. */
function zones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const list = all.includes("UTC") ? all : ["UTC", ...all];
  return list.includes(current) ? list : [current, ...list];
}

export function CostSettingsTab({ settings }: { settings: CostSettings }) {
  const isAdmin = useCurrentUser().capabilities.platformAdmin;
  const qc = useQueryClient();
  const [form, setForm] = useState(() => settingsForm(settings));
  const [submitted, setSubmitted] = useState(false);
  const saved = settingsForm(settings);
  const dirty = (Object.keys(form) as (keyof SettingsForm)[]).some((k) => form[k] !== saved[k]);
  const errors = settingsErrors(form);
  const invalid = Object.keys(errors).length > 0;
  const shown = submitted ? errors : {};
  const set = <K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm({ ...form, [k]: v });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PUT("/v1/admin/costs/settings", {
          params: { header: ifMatch(settings.revision) },
          body: {
            mode: form.mode,
            currency: form.currency.trim(),
            timeZone: form.timeZone,
            warnPercent: Number(form.warnPercent),
            defaultBudget: form.defaultBudget.trim() || null,
          },
        }),
      ),
    onSuccess: (st) => {
      qc.setQueryData(costSettingsQuery().queryKey, st);
      qc.invalidateQueries({ queryKey: ["admin", "costs"] });
      qc.invalidateQueries({ queryKey: ["admin", "team"] });
      setForm(settingsForm(st));
      setSubmitted(false);
      toast.success("Cost settings saved", modeLabels[st.mode]);
    },
    onError: () => qc.invalidateQueries({ queryKey: costSettingsQuery().queryKey }),
  });
  return (
    <SettingsPage
      dirty={dirty}
      canEdit={isAdmin}
      readOnlyNote={adminOnly}
      saving={save.isPending}
      error={save.error}
      saveLabel="Save cost settings"
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
        title="Mode"
        description={
          <>
            A team's own cost tracking, set on its page under{" "}
            <TextLink render={<Link to="/admin/teams" />}>Admin → Teams</TextLink> (its Budget card), overrides this.
          </>
        }
      >
        <Field label="Cost tracking" description={modeDescriptions[form.mode]}>
          <NativeSelect value={form.mode} disabled={!isAdmin} onChange={(e) => set("mode", e.target.value as CostMode)}>
            {(["off", "track", "enforce"] as const).map((m) => (
              <option key={m} value={m}>
                {modeLabels[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </SettingsSection>
      <SettingsSection title="Money and time" description="The currency is for display only; nothing is converted.">
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
      <SettingsSection title="Budgets" description="Enforced in Enforce, and shown as progress (never enforced) in Track only. A team's own budget or threshold, set on its page, replaces these.">
        <div className={c.formGrid}>
          <Field label="Warning threshold (%)" description="In Enforce, owners and admins are notified once a month when spend reaches this share of the budget." error={shown.warnPercent}>
            <Input type="number" min={1} max={100} value={form.warnPercent} disabled={!isAdmin} onChange={(e) => set("warnPercent", e.target.value)} />
          </Field>
          <Field
            label={`Default monthly budget (${form.currency || "currency"})`}
            description="For teams without their own budget. Leave empty for none: such teams are tracked but never refused."
            error={shown.defaultBudget}
          >
            <Input inputMode="decimal" value={form.defaultBudget} disabled={!isAdmin} onChange={(e) => set("defaultBudget", e.target.value)} />
          </Field>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}
