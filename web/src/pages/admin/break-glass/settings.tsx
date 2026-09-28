/*
 * Admin → Break-glass, Settings: whether a second admin must approve, the
 * longest session and how long a request waits (phase5-deploy.md §9
 * decision 3: by default one admin with a written reason). Audited.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { durationText, personName } from "@/lib/break-glass";
import { formatDate } from "@/lib/format";
import s from "../../shared.module.css";
import { settingsKey } from "./queries";

type Settings = Schemas["BreakGlassSettings"];
type Form = { approvalRequired: boolean; maxDurationMinutes: number; approvalTimeoutMinutes: number };

const maxChoices = [15, 30, 60, 120, 240, 480, 720, 1440];
const timeoutChoices = [5, 15, 30, 60, 120, 240, 480, 1440, 4320, 10080];

/** Preset choices plus the saved value, sorted. */
const withValue = (list: number[], v: number) => [...new Set([...list, v])].sort((a, b) => a - b);

const timeoutText = (m: number) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : durationText(m));

const formOf = (st: Settings): Form => ({
  approvalRequired: st.approvalRequired,
  maxDurationMinutes: st.maxDurationMinutes,
  approvalTimeoutMinutes: st.approvalTimeoutMinutes,
});

export function BreakGlassSettingsForm({ saved, isAdmin }: { saved: Settings; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(() => formOf(saved));
  const initial = formOf(saved);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const save = useMutation({
    mutationFn: async (f: Form) => unwrap(await api.PUT("/v1/admin/settings/break-glass", { params: { header: ifMatch(saved.revision) }, body: f })),
    onSuccess: (st) => {
      qc.setQueryData(settingsKey, st);
      toast.success("Break-glass settings saved", "They apply to sessions started from now on.");
    },
  });
  return (
    <SettingsPage dirty={dirty} canEdit={isAdmin} saving={save.isPending} error={save.error} saveLabel="Save settings" onSave={() => save.mutate(form)} onDiscard={() => setForm(initial)}>
      <SettingsSection title="Approval" description="By default one platform admin starts a session alone, with a written reason. Every session is audited and the team's owners are notified either way.">
        <Switch
          label="Require a second admin's approval"
          description={form.approvalRequired ? "Another platform admin approves or denies each request. Nobody can approve their own." : "An admin's session starts as soon as they give a reason."}
          checked={form.approvalRequired}
          disabled={!isAdmin || save.isPending}
          onCheckedChange={(v) => set({ approvalRequired: v })}
        />
        {form.approvalRequired && (
          <Field label="Requests lapse after" description="A request nobody approves in this time ends, and the admin who asked is told.">
            <NativeSelect value={String(form.approvalTimeoutMinutes)} disabled={!isAdmin} onChange={(e) => set({ approvalTimeoutMinutes: Number(e.target.value) })}>
              {withValue(timeoutChoices, form.approvalTimeoutMinutes).map((m) => (
                <option key={m} value={m}>
                  {timeoutText(m)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </SettingsSection>
      <SettingsSection title="Duration" description="Sessions last 1 hour unless the admin picks another length, up to this maximum. Admins can end them early.">
        <Field label="Longest session">
          <NativeSelect value={String(form.maxDurationMinutes)} disabled={!isAdmin} onChange={(e) => set({ maxDurationMinutes: Number(e.target.value) })}>
            {withValue(maxChoices, form.maxDurationMinutes).map((m) => (
              <option key={m} value={m}>
                {durationText(m)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </SettingsSection>
      {saved.updatedBy && (
        <p className={s.settingDescription}>
          Last changed {formatDate(saved.updatedAt)} by {personName(saved.updatedBy)}.
        </p>
      )}
    </SettingsPage>
  );
}
