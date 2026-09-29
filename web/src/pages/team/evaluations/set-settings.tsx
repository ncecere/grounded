/* A set's Settings tab: name, description, automatic runs, and deleting the set. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { DangerAction, DangerZone, SettingsPage, SettingsSection } from "@/components/templates/settings-page";
import { Button } from "@/components/ui/button/button";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { autoRunNotice } from "./labels";
import { type EvalSet, evalSetKey, evalSetsKey } from "./queries";

const formOf = (x: EvalSet) => ({ name: x.name, description: x.description, autoRun: x.autoRun });

export function SetSettings({ set }: { set: EvalSet }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => formOf(set));
  const [deleting, setDeleting] = useState(false);
  const nameError = form.name.trim() ? undefined : "Enter a name.";
  const dirty = form.name.trim() !== set.name || form.description !== set.description || form.autoRun !== set.autoRun;
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH("/v1/teams/{team}/evaluation-sets/{setId}", {
          params: { path: { team: slug, setId: set.id }, header: ifMatch(set.revision) },
          body: { name: form.name.trim(), description: form.description.trim(), autoRun: form.autoRun },
        }),
      ),
    onSuccess: (next) => {
      qc.setQueryData(evalSetKey(slug, set.id), next);
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
      setForm(formOf(next));
      toast.success("Settings saved");
    },
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(await api.DELETE("/v1/teams/{team}/evaluation-sets/{setId}", { params: { path: { team: slug, setId: set.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
      toast.success(`${set.name} was deleted`);
      const t = set.target;
      if (t.type === "agent") void navigate({ to: "/teams/$team/agents/$agentId", params: { team: slug, agentId: t.id }, search: { tab: "evaluations" }, replace: true });
      else void navigate({ to: "/teams/$team/kbs/$kbId", params: { team: slug, kbId: t.id }, search: { tab: "evaluations" }, replace: true });
    },
  });
  return (
    <SettingsPage
      dirty={dirty}
      saving={save.isPending}
      error={save.error}
      onSave={() => save.mutate()}
      onDiscard={() => {
        setForm(formOf(set));
        save.reset();
      }}
      saveLabel="Save settings"
      message={nameError ? "Not saved: fix the highlighted field" : undefined}
      saveDisabled={Boolean(nameError)}
    >
      <SettingsSection title="General">
        <Field label="Name" error={nameError}>
          <Input aria-required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description" labelHint="Optional">
          <Textarea maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
      </SettingsSection>
      <SettingsSection title="Automatic runs" description="Retrieval runs only; full-answer runs are always started by hand.">
        <Switch
          label="Run automatically"
          description={`A retrieval run after the agent is published, after the knowledge base switches embedding profile, and nightly when its documents changed. ${autoRunNotice}`}
          checked={form.autoRun}
          onCheckedChange={(autoRun) => setForm({ ...form, autoRun })}
        />
      </SettingsSection>
      <DangerZone>
        <DangerAction
          title="Delete this set"
          description="Its questions and runs are deleted too."
          action={
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete set
            </Button>
          }
        />
      </DangerZone>
      <AlertDialog
        open={deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(false);
            remove.reset();
          }
        }}
        title={`Delete ${set.name}?`}
        description="Its questions and every run are deleted. This can't be undone."
        confirmLabel="Delete set"
        busy={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
      />
    </SettingsPage>
  );
}
