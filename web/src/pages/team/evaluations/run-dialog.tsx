/*
 * Run a set (docs/evaluations.md §2-§4): a retrieval run (the default, no
 * model calls) or, for an agent's set, a full-answer run of its draft
 * or published version, with the number of answers it asks for and, when
 * the team's budget is enforced, that they count against it. When some
 * questions can't pass (attention.tsx), it says how many, without blocking
 * the run.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { useNavigate } from "@tanstack/react-router";
import { Alert } from "@/components/ui/alert/alert";
import { Field } from "@/components/ui/field/field";
import { NativeSelect } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { useBudgetStatus } from "@/lib/costs";
import { useRerankStatus } from "@/lib/rerank";
import { plural, useTeam } from "../common";
import { cantPassText } from "./attention";
import { type EvalSet, evalProblemsQuery, evalRunsKey, evalSetKey, evalSetsKey } from "./queries";

type Kind = "retrieval" | "answer";
type Version = "draft" | "published";

/**
 * What a full-answer check asks the agent: one answer per question (the
 * number is exact), counted as chat usage, and against the monthly budget
 * when the team has an enforced one (costs on, docs/costs.md).
 */
export const answerEstimate = (questions: number, budgeted = false) =>
  `${plural(questions, "answer")} from the agent, counted as chat usage${budgeted ? " and against the team's monthly budget" : ""}.`;

/** Starts a run, then shows it: the Runs tab with the run's record page (one history entry). */
export function RunDialog({ set, onClose }: { set: EvalSet; onClose: () => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const agentSet = set.target.type === "agent";
  const [kind, setKind] = useState<Kind>("retrieval");
  const [version, setVersion] = useState<Version>("draft");
  // Reranking (docs/v0.4.0.md §3): runs rerank like searches do; off compares with the usual order.
  const canRerank = Boolean(useRerankStatus().data?.available);
  const [rerank, setRerank] = useState(true);
  // "none" unless the budget is enforced; the amounts are for owners and admins only.
  const budget = useBudgetStatus(agentSet ? slug : undefined).data?.state;
  const cantPass = cantPassText(useQuery(evalProblemsQuery(slug, set.id)).data, agentSet ? kind : "retrieval");
  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST("/v1/teams/{team}/evaluation-sets/{setId}/runs", {
          params: { path: { team: slug, setId: set.id } },
          body: { ...(agentSet ? { kind, version } : { kind: "retrieval" as const }), ...(canRerank && !rerank ? { rerank: false } : {}) },
        }),
      ),
    onSuccess: (run) => {
      void qc.invalidateQueries({ queryKey: evalRunsKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
      toast.success(kind === "answer" ? "Full-answer run started" : "Retrieval run started");
      onClose();
      void navigate({ to: ".", search: ((prev: Record<string, unknown>) => ({ ...prev, tab: "runs", record: run.id, compare: undefined })) as never });
    },
  });
  return (
    <FormDialog title={`Run ${set.name}`} onClose={onClose} onSubmit={() => start.mutate()} submitLabel="Start run" busy={start.isPending}>
      <ApiErrorAlert error={start.error} />
      {agentSet ? (
        <RadioGroup<Kind>
          legend="Kind"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "retrieval", label: "Retrieval", description: "Runs the agent's search for each question: did the expected document come back? No model calls." },
            {
              value: "answer",
              label: "Full answer",
              description: "Asks the agent each question and scores the answer: cites an expected document and mentions the must-mention phrases.",
            },
          ]}
        />
      ) : (
        <p>A retrieval run does this knowledge base's search for each question and reports whether the expected document came back, at what rank. No model calls except embedding the questions.</p>
      )}
      {agentSet && (
        <Field label="Version" description="The draft as saved, or the version people chat with.">
          <NativeSelect value={version} onChange={(e) => setVersion(e.target.value as Version)}>
            <option value="draft">Draft</option>
            <option value="published">Published version</option>
          </NativeSelect>
        </Field>
      )}
      {canRerank && (
        <Switch
          label="Rerank"
          description={agentSet ? "Rerank as the agent does, unless it turned reranking off. Turn it off to compare." : "Rerank as searches do. Turn it off to compare."}
          checked={rerank}
          onCheckedChange={setRerank}
        />
      )}
      {cantPass && <Alert tone="warning">{cantPass}</Alert>}
      {kind === "answer" && (
        <Alert tone={budget === "warning" || budget === "exhausted" ? "warning" : "info"}>
          {answerEstimate(set.questionCount, Boolean(budget && budget !== "none"))}
          {budget === "exhausted" && " The budget is used up, so the run would stop at the first answer."}
          {budget === "warning" && " The team is near its budget."}
        </Alert>
      )}
    </FormDialog>
  );
}
