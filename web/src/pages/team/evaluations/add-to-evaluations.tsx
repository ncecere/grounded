/*
 * "Add to evaluations" (docs/evaluations.md §1, owner decision 2): from the
 * editor's own conversation with one of the team's agents (a thumbs-down
 * answer, or one without sources) and from the agent editor's Test panel.
 * It opens the question form with the question text only: nothing else of
 * the conversation is copied (ADR-0010). The editor picks one of the agent's
 * sets, or names a new one, and adds what a good result is: the document
 * picker searches the agent's knowledge bases, a new set's too. The toast
 * links to the set.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { QuestionFields, emptyQuestion, questionBody, questionErrors } from "./question-form";
import { evalSetsKey, evalSetsQuery } from "./queries";

const NEW = "new";

type Props = { team: string; agentId: string; agentName: string; question: string; onClose: () => void };

export function AddToEvaluationsDialog({ team, agentId, agentName, question, onClose }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sets = useQuery(evalSetsQuery(team, { agentId }));
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const [newName, setNewName] = useState(`${agentName} questions`);
  const [form, setForm] = useState(() => emptyQuestion(question));
  const [submitted, setSubmitted] = useState(false);
  const setId = choice ?? sets.data?.[0]?.id ?? NEW;
  const errors = submitted ? questionErrors(form) : {};
  const nameError = submitted && setId === NEW && !newName.trim() ? "Name the new set." : undefined;
  const add = useMutation({
    mutationFn: async () => {
      let target = sets.data?.find((x) => x.id === setId);
      if (!target) target = unwrap(await api.POST("/v1/teams/{team}/evaluation-sets", { params: { path: { team } }, body: { agentId, name: newName.trim() } }));
      unwrap(await api.POST("/v1/teams/{team}/evaluation-sets/{setId}/questions", { params: { path: { team, setId: target.id } }, body: questionBody(form) }));
      return target;
    },
    onSuccess: (target) => {
      void qc.invalidateQueries({ queryKey: evalSetsKey(team) });
      void qc.invalidateQueries({ queryKey: ["team", team, "evaluation-set"] });
      toast.add({
        tone: "success",
        title: "Added to evaluations",
        description: `The question is in ${target.name}.`,
        action: { label: "Open the set", onClick: () => void navigate({ to: "/teams/$team/evaluations/$setId", params: { team, setId: target.id } }) },
      });
      onClose();
    },
  });
  return (
    <FormDialog
      title="Add to evaluations"
      description="Only the question is copied. Say which documents a good answer should come from."
      size="lg"
      onClose={onClose}
      submitLabel="Add question"
      busy={add.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(questionErrors(form)).length === 0 && !(setId === NEW && !newName.trim())) add.mutate();
      }}
    >
      <ApiErrorAlert error={add.error ?? sets.error} />
      <Field label="Evaluation set">
        <NativeSelect value={setId} onChange={(e) => setChoice(e.target.value)} disabled={sets.isLoading}>
          {(sets.data ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
          <option value={NEW}>A new set for {agentName}</option>
        </NativeSelect>
      </Field>
      {setId === NEW && (
        <Field label="New set's name" error={nameError}>
          <Input aria-required maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Field>
      )}
      <QuestionFields team={team} scope={setId === NEW ? { agentId } : { setId }} form={form} onChange={setForm} errors={errors} />
    </FormDialog>
  );
}
