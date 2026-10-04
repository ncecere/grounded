/*
 * Admin → Maintenance (docs/phase5-deploy.md §5 P5): the platform switch that
 * pauses new ingestion while chat and search keep working, with the reason
 * users see and an optional planned end. On the settings template; turning
 * it on asks for confirmation and says what pauses. Audited.
 */
import { adminOnly } from "@/lib/terms";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { QueryView } from "@/components/query-view";
import { useRevisionForm } from "@/components/templates/revision-form";
import { SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Alert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { formatDate } from "@/lib/format";
import { maintenanceKey } from "@/lib/maintenance";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import m from "./maintenance.module.css";

type Settings = Schemas["MaintenanceSettings"];
type Form = { enabled: boolean; reason: string; plannedEnd: string };

const settingsKey = ["admin", "maintenance"];
const maxReason = 500;

/** What pauses and what keeps working: on the page and in the confirmation. */
const pauses = [
  "Uploads, new web sources, Sync now, page re-fetches and retries (refused with the reason)",
  "Scheduled syncs and crawls (they start once maintenance ends)",
  "Documents waiting to be processed, and crawls in progress after their current page (they continue by themselves)",
  "Re-processing after settings changes, such as repeated-block settings (it waits)",
];
const keepsWorking = "Sign-in, chat (team, signed-in and public agents), search and retrieval, the OpenAI-compatible API, reading everything, and platform administration.";

export function MaintenancePage() {
  const isAdmin = useIsPlatformAdmin();
  const settings = useQuery({ queryKey: settingsKey, queryFn: async () => unwrap(await api.GET("/v1/admin/settings/maintenance")) });
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Maintenance"
        description="Pause new ingestion while you change models, migrate embeddings or upgrade. Chat and search keep working, and paused work continues by itself when you turn it off."
      />
      <QueryView query={settings} loadingLabel="Loading maintenance mode…">
        {settings.data && <MaintenanceEditor saved={settings.data} isAdmin={isAdmin} />}
      </QueryView>
      <Card title="While maintenance mode is on">
        <DescriptionList
          dividers
          items={[
            { label: "Paused", value: <PauseList /> },
            { label: "Keeps working", value: keepsWorking },
            { label: "Who sees it", value: "Platform admins and team owners, admins and editors see a banner with your reason; upload and sync buttons are disabled. Members and chat users see nothing unless something they do is refused." },
          ]}
        />
      </Card>
    </Stack>
  );
}

function PauseList() {
  return (
    <ul className={m.list}>
      {pauses.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/** ISO time → the value of a datetime-local input (local time), and back. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const formOf = (st: Settings): Form => ({ enabled: st.enabled, reason: st.reason, plannedEnd: toLocalInput(st.plannedEndAt) });

function problemsOf(f: Form): { reason?: string; plannedEnd?: string } {
  if (!f.enabled) return {};
  const out: { reason?: string; plannedEnd?: string } = {};
  if (!f.reason.trim()) out.reason = "Give a reason: users see it while maintenance mode is on.";
  else if (f.reason.trim().length > maxReason) out.reason = `At most ${maxReason} characters.`;
  if (f.plannedEnd && !(new Date(f.plannedEnd).getTime() > Date.now())) out.plannedEnd = "The planned end must be in the future.";
  return out;
}

function MaintenanceEditor({ saved, isAdmin }: { saved: Settings; isAdmin: boolean }) {
  const qc = useQueryClient();
  // Edits survive a change made elsewhere; SettingsPage asks whose to keep (AD-01).
  const [form, setForm, revision] = useRevisionForm(formOf(saved), saved.revision, { labels: { enabled: "Maintenance mode", reason: "Reason", plannedEnd: "Planned end" } });
  const [submitted, setSubmitted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const initial = formOf(saved);
  const dirty = form.enabled !== initial.enabled || (form.enabled && (form.reason !== initial.reason || form.plannedEnd !== initial.plannedEnd));
  const problems = problemsOf(form);
  const shown = submitted ? problems : {};
  const turningOn = form.enabled && !saved.enabled;
  const turningOff = !form.enabled && saved.enabled;

  const save = useMutation({
    mutationFn: async (f: Form) =>
      unwrap(
        await api.PUT("/v1/admin/settings/maintenance", {
          params: { header: ifMatch(saved.revision) },
          body: f.enabled ? { enabled: true, reason: f.reason.trim(), plannedEndAt: fromLocalInput(f.plannedEnd) } : { enabled: false },
        }),
      ),
    onSuccess: (st) => {
      setConfirming(false);
      qc.setQueryData(settingsKey, st);
      void qc.invalidateQueries({ queryKey: maintenanceKey });
      toast.success(turningOn ? "Maintenance mode is on" : turningOff ? "Maintenance mode is off" : "Maintenance mode updated", turningOff ? "Paused work continues by itself." : undefined);
    },
  });

  return (
    <SettingsPage
      revision={revision}
      dirty={dirty}
      canEdit={isAdmin} readOnlyNote={adminOnly}
      saving={save.isPending && !confirming}
      error={confirming ? undefined : save.error}
      saveLabel={turningOn ? "Turn on maintenance mode" : turningOff ? "Turn off maintenance mode" : "Save changes"}
      message={submitted && Object.keys(problems).length ? `Not saved: ${Object.values(problems)[0]}` : undefined}
      onSave={() => {
        setSubmitted(true);
        if (Object.keys(problems).length) return;
        if (turningOn) setConfirming(true);
        else save.mutate(form);
      }}
      onDiscard={() => {
        setForm(initial);
        setSubmitted(false);
      }}
    >
      <SettingsSection
        title="Maintenance mode"
        description="New ingestion pauses on every server within a few seconds. It only ends when an admin turns it off."
        actions={saved.enabled ? <StatusBadge tone="warning">On</StatusBadge> : <StatusBadge tone="neutral">Off</StatusBadge>}
      >
        <Switch
          label="Pause ingestion"
          description={form.enabled ? "Uploads, syncs and crawls are paused; chat and search keep working." : "Everything runs normally."}
          checked={form.enabled}
          disabled={!isAdmin || save.isPending}
          onCheckedChange={(v) => set({ enabled: v })}
        />
        {saved.enabled && (
          <p className={s.settingDescription}>
            Turned on {formatDate(saved.startedAt)}
            {saved.startedBy ? ` by ${saved.startedBy.displayName || saved.startedBy.email}` : ""}.
            {saved.updatedBy && saved.startedBy && saved.updatedBy.id !== saved.startedBy.id ? ` Last changed by ${saved.updatedBy.displayName || saved.updatedBy.email}.` : ""}
          </p>
        )}
        {turningOff && (
          <Alert tone="info" title="Paused work continues when you save">
            Waiting documents, parked crawls and due scheduled syncs start again by themselves.
          </Alert>
        )}
      </SettingsSection>
      {form.enabled && (
        <SettingsSection title="Message for users" description="Shown in the banner and whenever an upload, sync or crawl is refused.">
          <Field label="Reason" description={`Required. Up to ${maxReason} characters.`} error={shown.reason}>
            <Textarea
              value={form.reason}
              maxLength={maxReason}
              rows={3}
              disabled={!isAdmin}
              placeholder="Moving to a new embedding model"
              onChange={(e) => set({ reason: e.target.value })}
            />
          </Field>
          <Field label="Planned end" labelHint="Optional" description="Tells users when to expect ingestion back. Maintenance mode doesn't end by itself." error={shown.plannedEnd}>
            <Input type="datetime-local" value={form.plannedEnd} disabled={!isAdmin} onChange={(e) => set({ plannedEnd: e.target.value })} />
          </Field>
        </SettingsSection>
      )}
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          if (!o) {
            setConfirming(false);
            save.reset();
          }
        }}
        tone="primary"
        title="Turn on maintenance mode?"
        description="New ingestion pauses for every team until you turn it off. Users who manage content see your reason."
        confirmLabel="Turn on maintenance mode"
        busy={save.isPending}
        error={save.error}
        onConfirm={() => save.mutate(form)}
      >
        <p className={s.settingDescription}>These pause:</p>
        <PauseList />
        <p className={s.settingDescription}>Keeps working: {keepsWorking}</p>
      </AlertDialog>
    </SettingsPage>
  );
}
