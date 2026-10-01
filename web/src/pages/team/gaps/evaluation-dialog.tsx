/*
 * "Add to evaluations" for a shared question of a gap topic (docs/gaps.md):
 * the question form (its text, editable, and the documents a good answer
 * comes from) and one of the agent's evaluation sets. The server adds the
 * shared question to the set and records it on the topic (audited).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { evalSetsKey, evalSetsQuery } from "../evaluations/queries";
import { QuestionFields } from "../evaluations/question-fields";
import { emptyQuestion, questionBody, questionErrors } from "../evaluations/question-form";
import { type GapSharedQuestion, type GapTopic, gapTopicsKey } from "./queries";

type Props = { team: string; topic: GapTopic; question: GapSharedQuestion; onClose: () => void };

export function GapEvaluationDialog({ team, topic, question, onClose }: Props) {
  const qc = useQueryClient();
  const sets = useQuery(evalSetsQuery(team, { agentId: topic.agentId }));
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const [form, setForm] = useState(() => emptyQuestion(question.question));
  const [submitted, setSubmitted] = useState(false);
  const setId = choice ?? sets.data?.[0]?.id;
  const errors = submitted ? questionErrors(form) : {};
  const add = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/gap-topics/{topicId}/evaluations", {
          params: { path: { team, topicId: topic.id } },
          body: { ...questionBody(form), setId: setId!, sharedQuestionId: question.id },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: gapTopicsKey(team) });
      void qc.invalidateQueries({ queryKey: evalSetsKey(team) });
      toast.success("Added to evaluations", `The question is in ${sets.data?.find((x) => x.id === setId)?.name ?? "the set"}.`);
      onClose();
    },
  });
  const none = sets.isSuccess && sets.data.length === 0;
  return (
    <FormDialog
      title="Add to evaluations"
      description="The shared question becomes a test question. Say which documents a good answer comes from."
      size="lg"
      onClose={onClose}
      submitLabel="Add question"
      busy={add.isPending}
      submitDisabled={!setId}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (setId && Object.keys(questionErrors(form)).length === 0) add.mutate();
      }}
    >
      <ApiErrorAlert error={add.error ?? sets.error} />
      {none ? (
        <Alert tone="info" title={`${topic.agentName} has no evaluation set yet.`}>
          Create one on the agent's{" "}
          <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team, agentId: topic.agentId }} search={{ tab: "evaluations" }} />}>
            Evaluations tab
          </TextLink>
          , then come back.
        </Alert>
      ) : (
        <>
          <Field label="Evaluation set">
            <NativeSelect value={setId ?? ""} onChange={(e) => setChoice(e.target.value)} disabled={sets.isLoading}>
              {(sets.data ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {setId && (
            <QuestionFields team={team} scope={{ setId }} form={form} onChange={setForm} errors={errors} answers where={`${topic.agentName}'s knowledge bases`} />
          )}
        </>
      )}
    </FormDialog>
  );
}
