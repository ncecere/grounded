/*
 * Retention → Settings: each data kind's period (the environment default,
 * keep, or a number of days), and the per-level conversation retention,
 * which is edited on Classifications. One save bar; a save that starts or
 * speeds up deletion asks for confirmation first.
 */
import { adminOnly } from "@/lib/terms";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field, Fieldset } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { changedPeriods, daysText, formOf, hoursText, kindLabels, type Kind, type Period, type PeriodForm, periodError, periodSource, periodText, sameForm, shortened } from "./labels";
import r from "./retention.module.css";

type Settings = Schemas["RetentionSettings"];

export const retentionKey = ["admin", "retention"];

const sections: { title: string; description: string; kinds: Kind[] }[] = [
  { title: "Conversations", description: "Transcripts follow their classification level. Deleted conversations disappear for their user at once.", kinds: ["deleted_conversations"] },
  { title: "Logs and events", description: "Metadata only: never questions or answers.", kinds: ["access_log", "analytics_events", "usage_events", "audit_log"] },
  { title: "Deleted content and invites", description: "Deleted documents leave search at once; their stored files wait for this period.", kinds: ["deleted_files", "expired_invites"] },
  { title: "Evaluations", description: "Runs of teams' evaluation sets, with their results and test answers.", kinds: ["evaluation_runs"] },
];

const formsOf = (st: Settings) => Object.fromEntries(st.periods.map((p) => [p.kind, formOf(p)])) as Record<string, PeriodForm>;

export function RetentionSettingsTab({ saved, isAdmin }: { saved: Settings; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [forms, setForms] = useState(() => formsOf(saved));
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const periods = new Map(saved.periods.map((p) => [p.kind, p]));
  const changes = changedPeriods(saved.periods, forms);
  const errors = Object.fromEntries(saved.periods.map((p) => [p.kind, periodError(p, forms[p.kind]!)]));
  const invalid = Object.values(errors).some(Boolean);
  const sooner = shortened(saved.periods, forms);
  const save = useMutation({
    mutationFn: async () => unwrap(await api.PUT("/v1/admin/retention", { params: { header: ifMatch(saved.revision) }, body: { periods: changes } })),
    onSuccess: (st) => {
      setConfirming(false);
      qc.setQueryData(retentionKey, st);
      void qc.invalidateQueries({ queryKey: [...retentionKey, "report"] });
      toast.success("Retention periods saved", "The next run applies them.");
    },
  });
  const set = (kind: Kind, f: PeriodForm) => setForms((cur) => ({ ...cur, [kind]: f }));

  return (
    <SettingsPage
      dirty={changes.length > 0}
      canEdit={isAdmin} readOnlyNote={adminOnly}
      saving={save.isPending && !confirming}
      error={confirming ? undefined : save.error}
      saveLabel="Save periods"
      message={submitted && invalid ? "Not saved: fix the highlighted period" : undefined}
      onSave={() => {
        setSubmitted(true);
        if (invalid) return;
        if (sooner.length > 0) setConfirming(true);
        else save.mutate();
      }}
      onDiscard={() => {
        setForms(formsOf(saved));
        setSubmitted(false);
      }}
    >
      <Alert tone="info" title="Confirm periods with your records management first">
        Nothing is deleted until a period is set. Transcripts and logs can be records under public records law. Legal holds keep what they cover whatever the period.
      </Alert>
      <SettingsSection title="Conversations by classification level" description="Set on each level. Counted from a conversation's last message.">
        <LevelsTable levels={saved.levels} />
      </SettingsSection>
      {sections.map((sec) => (
        <SettingsSection key={sec.title} title={sec.title} description={sec.description}>
          {sec.kinds.map((k) => {
            const p = periods.get(k);
            return p && <PeriodFields key={k} period={p} form={forms[k]!} error={submitted ? errors[k] : undefined} disabled={!isAdmin} onChange={(f) => set(k, f)} />;
          })}
        </SettingsSection>
      ))}
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(false);
            save.reset();
          }
        }}
        tone="danger"
        title="Delete more data?"
        description="The next run, within 10 minutes, permanently deletes what's past these periods. Legal holds still apply. Check the dry run first."
        confirmLabel="Save periods"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate()}
      >
        <ul className={r.list}>
          {sooner.map((p) => (
            <li key={p.kind}>{kindLabels[p.kind].label}</li>
          ))}
        </ul>
      </AlertDialog>
    </SettingsPage>
  );
}

function PeriodFields({ period: p, form, error, disabled, onChange }: { period: Period; form: PeriodForm; error?: string; disabled: boolean; onChange: (f: PeriodForm) => void }) {
  const info = kindLabels[p.kind];
  const envText = p.environmentDays === null ? "keep" : `delete after ${daysText(p.environmentDays)}`;
  const changed = !sameForm(form, formOf(p));
  return (
    <Fieldset legend={info.label} description={info.description}>
      <div className={r.periodRow}>
        <Field label={`${info.label}: retention`} hideLabel>
          <NativeSelect value={form.mode} disabled={disabled} onChange={(e) => onChange({ mode: e.target.value as PeriodForm["mode"], days: form.days })}>
            <option value="default">Default ({envText})</option>
            <option value="keep">Keep</option>
            <option value="days">Delete after…</option>
          </NativeSelect>
        </Field>
        {form.mode === "days" && (
          <Field label={`${info.label}: days`} hideLabel error={error} description={`${p.minDays}–${p.maxDays} days`}>
            <NumberInput maximumFractionDigits={0} value={form.days} disabled={disabled} unit="days" aria-required onValueChange={(v) => onChange({ mode: "days", days: v })} />
          </Field>
        )}
        <p className={r.now}>
          Now: {periodText(p.days)} <span className={s.muted}>· {periodSource(p)}</span>
          {changed && <span className={r.pending}> · changed, not saved</span>}
        </p>
      </div>
    </Fieldset>
  );
}

function LevelsTable({ levels }: { levels: Schemas["RetentionLevel"][] }) {
  return (
    <>
      <Table caption="Conversation retention by level" columns={["Level", "Signed-in conversations", "Anonymous conversations"]}>
        {levels.map((l) => (
          <Tr key={l.key}>
            <Td>
              <span className={s.primary}>{l.name}</span>
            </Td>
            <Td muted>{l.conversationRetentionDays ? `Delete after ${daysText(l.conversationRetentionDays)}` : "Keep until the user deletes it"}</Td>
            <Td muted>Delete after {hoursText(l.anonymousRetentionHours)}</Td>
          </Tr>
        ))}
      </Table>
      <p className={s.settingDescription}>
        {/* Neutral: auditors read this too. */}
        They&apos;re set on <TextLink render={<Link to="/admin/classifications" />}>Classifications</TextLink>.
      </p>
    </>
  );
}
