/* The Agent templates page's dialogs: what a template holds (read only), renaming a saved one, and deleting it. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { AlertDialog, Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { citationModeLabels } from "../../agents/common";
import { type AgentTemplate, agentTemplatesKey } from "../../agents/templates";
import s from "../../shared.module.css";

/** What a template holds, as an agent made from it starts: the same words and settings, read only. */
export function ViewTemplateDialog({ template, onClose }: { template: AgentTemplate; onClose: () => void }) {
  const c = template.config;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={template.name} description={template.description || undefined} footer={<DialogClose>Close</DialogClose>}>
      <Field label="Instructions">
        <Textarea readOnly rows={10} value={c.instructions} />
      </Field>
      <Field label="Welcome message">
        <Input readOnly value={template.welcomeMessage} />
      </Field>
      <Field label="Starter questions">
        <ul className={s.note}>
          {template.starterQuestions.length === 0 ? <li>None</li> : template.starterQuestions.map((q) => <li key={q}>{q}</li>)}
        </ul>
      </Field>
      <Field label="Settings">
        <ul className={s.note}>
          <li>{c.strictlyGrounded ? "Answers only from the knowledge base" : "May also answer from general knowledge, labelled as such"}</li>
          <li>{citationModeLabels[c.citationMode]}</li>
          <li>{c.chatModelId ? "Names a chat model (used when the platform still offers it)" : "No chat model: the person making the agent chooses"}</li>
          <li>Never holds knowledge bases, tools or an audience: a new agent is for its team until published</li>
        </ul>
      </Field>
    </Dialog>
  );
}

function useTemplateError(error: unknown) {
  return error instanceof ApiError && error.code === "template_name_taken";
}

export function RenameTemplateDialog({ template, onClose }: { template: AgentTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.PATCH("/v1/admin/agent-templates/{templateId}", {
          params: { path: { templateId: template.id } },
          body: { name: name.trim(), description: description.trim() },
        }),
      ),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: agentTemplatesKey });
      toast.success(`Saved "${t.name}"`);
      onClose();
    },
  });
  const taken = useTemplateError(save.error);
  const nameError = !name.trim() ? "Enter a name." : taken ? "A template with that name already exists." : undefined;
  return (
    <FormDialog
      title="Rename template"
      description="Agents already made from it are not changed."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim()) save.mutate();
      }}
      submitLabel="Save"
      busy={save.isPending}
      formProps={{ noValidate: true }}
    >
      <Field label="Name" error={submitted || taken ? nameError : undefined}>
        <Input
          aria-required
          maxLength={80}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            save.reset();
          }}
        />
      </Field>
      <Field label="Description" labelHint="Optional" description="Up to 500 characters.">
        <Textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {!taken && <ApiErrorAlert error={save.error} />}
    </FormDialog>
  );
}

export function DeleteTemplateDialog({ template, onClose }: { template: AgentTemplate | null; onClose: () => void }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (t: AgentTemplate) => unwrap(await api.DELETE("/v1/admin/agent-templates/{templateId}", { params: { path: { templateId: t.id } } })),
    onSuccess: (_, t) => {
      onClose();
      toast.success(`"${t.name}" was deleted`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: agentTemplatesKey }),
  });
  return (
    <AlertDialog
      open={template !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          remove.reset();
        }
      }}
      title={`Delete "${template?.name ?? "this template"}"?`}
      description="Teams can no longer start an agent from it. Agents already made from it keep their own copy of the instructions and settings."
      confirmLabel="Delete template"
      busy={remove.isPending}
      error={remove.error}
      onConfirm={() => template && remove.mutate(template)}
    />
  );
}
