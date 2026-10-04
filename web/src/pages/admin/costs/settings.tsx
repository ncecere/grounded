/*
 * Costs › Settings: the cost tracking mode and the warning threshold. One form and save bar; the write sends If-Match.
 * The currency, time zone and default monthly budget moved to Admin → Settings in v0.4.2 (AD-39): this form sends them
 * as they are.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Link } from "@tanstack/react-router";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Field } from "@/components/ui/field/field";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { NativeSelect } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { costSettingsQuery, type CostMode, type CostSettings, modeDescriptions, modeLabels } from "@/lib/costs";
import { adminOnly } from "@/lib/terms";
import { useCurrentUser } from "@/session";

export type SettingsForm = { mode: CostMode; warnPercent: string };

export const settingsForm = (st: CostSettings): SettingsForm => ({
  mode: st.mode,
  warnPercent: String(st.warnPercent),
});

/** Field errors of the settings form (empty when valid). */
export function settingsErrors(f: SettingsForm): Partial<Record<keyof SettingsForm, string>> {
  const out: Partial<Record<keyof SettingsForm, string>> = {};
  const w = Number(f.warnPercent);
  if (!Number.isInteger(w) || w < 1 || w > 100) out.warnPercent = "Enter a whole percentage from 1 to 100.";
  return out;
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
            warnPercent: Number(form.warnPercent),
            currency: settings.currency,
            timeZone: settings.timeZone,
            defaultBudget: settings.defaultBudget,
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
      <SettingsSection
        title="Budgets"
        description={
          <>
            Enforced in Enforce, and shown as progress (never enforced) in Track only. The currency, time zone and default monthly budget are in{" "}
            <TextLink render={<Link to="/admin/settings" />}>Admin → Settings</TextLink>. A team's own threshold, set on its page, replaces this one.
          </>
        }
      >
        <Field label="Warning threshold (%)" description="In Enforce, owners and admins are notified once a month when spend reaches this share of the budget." error={shown.warnPercent}>
          <NumberInput maximumFractionDigits={0} min={1} max={100} value={form.warnPercent} disabled={!isAdmin} onValueChange={(v) => set("warnPercent", v)} />
        </Field>
      </SettingsSection>
    </SettingsPage>
  );
}
