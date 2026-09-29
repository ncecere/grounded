/*
 * The question form (docs/evaluations.md §1): its state, checks and request
 * body, and the "New question" and "Edit question" dialog. The fields are
 * question-fields.tsx, shared with "Add to evaluations".
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { splitExpected } from "./labels";
import { type EvalQuestion, type EvalSet, evalQuestionsKey, evalSetKey, evalSetsKey } from "./queries";
import { QuestionFields } from "./question-fields";

export type QuestionForm = { question: string; documentIds: string[]; others: string[]; mustMention: string[]; note: string };

export const emptyQuestion = (question = ""): QuestionForm => ({ question, documentIds: [], others: [], mustMention: [], note: "" });

export const questionFormOf = (q: EvalQuestion): QuestionForm => ({
  question: q.question,
  documentIds: q.expected.documentIds,
  others: [...q.expected.urls, ...q.expected.filenames],
  mustMention: q.mustMention,
  note: q.note,
});

/** Field errors of the form ({} when it can be saved). */
export function questionErrors(f: QuestionForm): { question?: string; expected?: string } {
  const out: { question?: string; expected?: string } = {};
  if (!f.question.trim()) out.question = "Enter the question.";
  if (f.documentIds.length + f.others.length === 0) out.expected = "Pick a document or enter a URL or filename.";
  return out;
}

/** The request body of a question. */
export const questionBody = (f: QuestionForm) => ({ question: f.question.trim(), expected: splitExpected(f.others, f.documentIds), mustMention: f.mustMention, note: f.note.trim() });

/** Saves a question: new (no `question`) or changed. */
export function useSaveQuestion(slug: string, setId: string, question?: EvalQuestion) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: QuestionForm) => {
      const body = questionBody(f);
      const path = { team: slug, setId };
      return question
        ? unwrap(
            await api.PATCH("/v1/teams/{team}/evaluation-sets/{setId}/questions/{questionId}", {
              params: { path: { ...path, questionId: question.id }, header: ifMatch(question.revision) },
              body,
            }),
          )
        : unwrap(await api.POST("/v1/teams/{team}/evaluation-sets/{setId}/questions", { params: { path }, body }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalQuestionsKey(slug, setId) });
      void qc.invalidateQueries({ queryKey: evalSetKey(slug, setId) });
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
    },
  });
}

/** Where a set's documents are, for the form's warnings: "Student handbook" or "Helper's knowledge bases". */
export const setWhere = (set: Pick<EvalSet, "target">) => (set.target.type === "agent" ? `${set.target.name}'s knowledge bases` : set.target.name);

/** "New question" and "Edit question". Must-mention phrases only on an agent's sets (the only ones with full-answer runs). */
export function QuestionDialog({ set, question, onClose }: { set: EvalSet; question?: EvalQuestion; onClose: () => void }) {
  const setId = set.id;
  const [form, setForm] = useState<QuestionForm>(() => (question ? questionFormOf(question) : emptyQuestion()));
  const [submitted, setSubmitted] = useState(false);
  const { slug } = useTeam();
  const save = useSaveQuestion(slug, setId, question);
  const errors = submitted ? questionErrors(form) : {};
  return (
    <FormDialog
      title={question ? "Edit question" : "New question"}
      size="lg"
      onClose={onClose}
      submitLabel={question ? "Save question" : "Create question"}
      busy={save.isPending}
      formProps={{ noValidate: true }}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(questionErrors(form)).length > 0) return;
        save.mutate(form, {
          onSuccess: () => {
            toast.success(question ? "Question saved" : "Question created");
            onClose();
          },
        });
      }}
    >
      <ApiErrorAlert error={save.error} />
      <QuestionFields team={slug} scope={{ setId }} form={form} onChange={setForm} errors={errors} answers={set.target.type === "agent"} where={setWhere(set)} />
    </FormDialog>
  );
}
