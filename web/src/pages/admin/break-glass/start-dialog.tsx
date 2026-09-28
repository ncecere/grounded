/*
 * Start a break-glass session: team, reason (the owners see it), scope and
 * duration. With the approval setting on, it becomes a request another
 * platform admin approves.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Checkbox, CheckboxGroup } from "@/components/ui/checkbox/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { NativeSelect, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { type BreakGlassDetail, type BreakGlassScope, breakGlassKey, durationText, scopeLabels } from "@/lib/break-glass";
import { useFormState } from "@/lib/use-form-state";
import { useDebounced } from "../hooks";

type Settings = Schemas["BreakGlassSettings"];

const durations = [15, 30, 60, 120, 240, 480, 720, 1440];
const maxReason = 1000;

/** The durations an admin may pick: the presets up to the maximum, plus the maximum itself. */
export function durationChoices(max: number) {
  const list = durations.filter((d) => d <= max);
  if (!list.includes(max)) list.push(max);
  return list;
}

export type StartForm = { team: string; reason: string; scopes: BreakGlassScope[]; duration: number };

/** Problems with a start form, by field (empty when it can be sent). */
export function startProblems(f: StartForm, minReason: number): Partial<Record<keyof StartForm, string>> {
  const out: Partial<Record<keyof StartForm, string>> = {};
  if (!f.team) out.team = "Choose a team.";
  const n = f.reason.trim().length;
  if (n < minReason) out.reason = `Give a reason of at least ${minReason} characters: the team's owners see it.`;
  else if (n > maxReason) out.reason = `At most ${maxReason} characters.`;
  if (f.scopes.length === 0) out.scopes = "Choose what you need to read.";
  return out;
}

function useTeamOptions(text: string): ComboboxOption[] {
  const q = useDebounced(text.trim(), 250);
  const teams = useQuery({
    queryKey: ["admin", "teams", "break-glass-picker", q],
    queryFn: async () => unwrap(await api.GET("/v1/admin/teams", { params: { query: { q: q || undefined, limit: 20 } } })),
  });
  return (teams.data?.items ?? []).map(({ team: t }) => ({ value: t.slug, label: t.name, hint: t.slug }));
}

export function StartDialog({ settings, initialTeam, onClose, onStarted }: { settings: Settings; initialTeam?: string; onClose: () => void; onStarted: (s: BreakGlassDetail) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ComboboxOption | null>(null);
  const options = useTeamOptions(text);
  const items = picked && !options.some((o) => o.value === picked.value) ? [picked, ...options] : options;
  const [form, set] = useFormState<StartForm>({ team: initialTeam ?? "", reason: "", scopes: [], duration: settings.defaultDurationMinutes });
  const [submitted, setSubmitted] = useState(false);
  const problems = startProblems(form, settings.minReasonLength);
  const shown = submitted ? problems : {};
  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/admin/break-glass", {
          body: { team: form.team, reason: form.reason.trim(), scopes: form.scopes, durationMinutes: form.duration },
        }),
      ),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: breakGlassKey });
      toast.success(s.status === "pending" ? "Request sent for approval" : "Break-glass session started", s.team.name);
      onStarted(s);
    },
  });
  return (
    <FormDialog
      title="Start a break-glass session"
      description="Read one team's content for a limited time. Every read is recorded, and the team's owners are notified."
      submitLabel={settings.approvalRequired ? "Request approval" : "Start session"}
      busy={start.isPending}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(problems).length === 0) start.mutate();
      }}
      formProps={{ noValidate: true }}
    >
      {settings.approvalRequired && (
        <Alert tone="info" title="A second admin must approve">
          Another platform admin approves or denies the request. It lapses after {durationText(settings.approvalTimeoutMinutes)}; the session's time starts when it's approved.
        </Alert>
      )}
      <Field label="Team" error={shown.team}>
        <Combobox
          items={items}
          value={form.team || null}
          onValueChange={(v, option) => {
            set("team", v ?? "");
            setPicked(option);
          }}
          onInputValueChange={setText}
          placeholder="Search teams"
          emptyText="No team matches."
          autoHighlight
        />
      </Field>
      <Field label="Reason" description={`At least ${settings.minReasonLength} characters. The team's owners see it, and it's in the audit log.`} error={shown.reason}>
        <Textarea value={form.reason} maxLength={maxReason} rows={3} placeholder="Investigating support ticket 1234: wrong answers about parking" onChange={(e) => set("reason", e.target.value)} />
      </Field>
      <CheckboxGroup legend="What you need to read" description="Nothing else changes: you can't edit anything." error={shown.scopes} value={form.scopes} onValueChange={(v) => set("scopes", v as BreakGlassScope[])}>
        <Checkbox value="documents" label={scopeLabels.documents} description="Data sources, documents and their passages." />
        <Checkbox value="conversations" label={scopeLabels.conversations} description="Conversations with the team's agents and their transcripts (without who had them)." />
      </CheckboxGroup>
      <Field label="Duration" description={`At most ${durationText(settings.maxDurationMinutes)}. You can end it early.`}>
        <NativeSelect value={String(form.duration)} onChange={(e) => set("duration", Number(e.target.value))}>
          {durationChoices(settings.maxDurationMinutes).map((d) => (
            <option key={d} value={d}>
              {durationText(d)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <ErrorAlert error={start.error} title="Couldn't start the session" />
    </FormDialog>
  );
}
