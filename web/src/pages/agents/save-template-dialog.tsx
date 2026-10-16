/* "Save as template…" (platform admins, in the agent's "…" menu): the agent's instructions and settings become a starting point for every team. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, unwrap } from "../../api/client";
import { ApiErrorAlert } from "../../components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import type { Agent } from "./common";
import { agentTemplatesKey } from "./templates";

export function SaveTemplateDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/agents/{agentId}/save-as-template", {
          params: { path: { team: agent.teamSlug, agentId: agent.id } },
          body: { name: name.trim(), description: description.trim() },
        }),
      ),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: agentTemplatesKey });
      toast.success("Saved as a template", `"${t.name}" is now offered to every team that makes an agent.`);
      onClose();
    },
  });
  const taken = save.error instanceof ApiError && save.error.code === "template_name_taken";
  const nameError = !name.trim() ? "Enter a name." : taken ? "A template with that name already exists." : undefined;
  return (
    <FormDialog
      title="Save as a template"
      description="A template is a starting point for a new agent. Anyone who makes an agent can pick it."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim()) save.mutate();
      }}
      submitLabel="Save template"
      busy={save.isPending}
      formProps={{ noValidate: true }}
    >
      <Alert tone="warning" title="Everyone who makes an agent can read the instructions">
        The template keeps this agent's instructions, model, answering mode, safety and SystemOne settings, advanced settings, appearance and starter questions, as last saved.
        It never keeps the knowledge bases, the tools or who may use the agent. {agent.teamSlug}'s audit log records the copy.
      </Alert>
      <Field label="Template name" error={submitted || taken ? nameError : undefined}>
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
      <Field label="Description" labelHint="Optional" description="Shown beside the name when a team picks a template. Up to 500 characters.">
        <Textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {!taken && <ApiErrorAlert error={save.error} />}
    </FormDialog>
  );
}
