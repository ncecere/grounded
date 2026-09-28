/*
 * Run a set (docs/evaluations.md §2-§4): a retrieval check (the default,
 * no model calls) or, for an agent's set, a full-answer check of its draft
 * or published version, with an estimate of the answers it asks for.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { type EvalSet, evalRunsKey, evalSetKey, evalSetsKey } from "./queries";

type Kind = "retrieval" | "answer";
type Version = "draft" | "published";

/** "About 40 answers": what a full-answer check asks the agent. */
export const answerEstimate = (questions: number) => `About ${questions.toLocaleString()} ${questions === 1 ? "answer" : "answers"} from the agent, counted as chat usage.`;

export function RunDialog({ set, onClose, onStarted }: { set: EvalSet; onClose: () => void; onStarted: () => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const record = useRecordParam();
  const agentSet = set.target.type === "agent";
  const [kind, setKind] = useState<Kind>("retrieval");
  const [version, setVersion] = useState<Version>("draft");
  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/evaluation-sets/{setId}/runs", {
          params: { path: { team: slug, setId: set.id } },
          body: agentSet ? { kind, version } : { kind: "retrieval" },
        }),
      ),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: evalRunsKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
      toast.success(kind === "answer" ? "Full-answer check started" : "Retrieval check started");
      onClose();
      onStarted();
      record.open(run.id);
    },
  });
  return (
    <FormDialog title={`Run ${set.name}`} onClose={onClose} onSubmit={() => start.mutate()} submitLabel="Start run" busy={start.isPending}>
      <ApiErrorAlert error={start.error} />
      {agentSet ? (
        <RadioGroup<Kind>
          legend="Check"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "retrieval", label: "Retrieval check", description: "Runs the agent's search for each question: did the expected document come back? No model calls." },
            { value: "answer", label: "Full-answer check", description: "Asks the agent each question and scores the answer: cites an expected document and mentions the phrases." },
          ]}
        />
      ) : (
        <p>A retrieval check runs this knowledge base's search for each question and reports whether the expected document came back, at what rank. No model calls except embedding the questions.</p>
      )}
      {agentSet && (
        <Field label="Version" description="The draft as saved, or the version people chat with.">
          <NativeSelect value={version} onChange={(e) => setVersion(e.target.value as Version)}>
            <option value="draft">Draft</option>
            <option value="published">Published version</option>
          </NativeSelect>
        </Field>
      )}
      {kind === "answer" && <Alert tone="info">{answerEstimate(set.questionCount)}</Alert>}
    </FormDialog>
  );
}
