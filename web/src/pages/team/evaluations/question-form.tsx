/*
 * The question form (docs/evaluations.md §1): the question, its expected
 * documents (picked from the knowledge base, or URLs, URL prefixes ending
 * in * and filenames), must-mention phrases and a note. Used to add and
 * change a question, and by "Add to evaluations".
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import { toast } from "@/components/ui/toast/toast";
import { useDebounced } from "../../admin/hooks";
import { useTeam } from "../common";
import { splitExpected } from "./labels";
import { type DocumentScope, type EvalDocument, type EvalQuestion, evalQuestionsKey, evalSetKey, evalSetsKey, useEvalDocuments } from "./queries";

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

type FieldsProps = { team: string; scope?: DocumentScope; form: QuestionForm; onChange: (f: QuestionForm) => void; errors: ReturnType<typeof questionErrors> };

/**
 * A document's option: its title, then its filename (or URL) when that's
 * different. The server matches the typed text on the title, filename and
 * URL, but the Combobox filters the options again by their label and has no
 * way to turn that off, so the label carries what the server matched on.
 */
export function documentLabel(d: Pick<EvalDocument, "title" | "filename" | "url">) {
  const other = d.filename || d.url;
  if (!d.title) return other || "Untitled document";
  return other && other !== d.title ? `${d.title} · ${other}` : d.title;
}

/** The fields; `scope` is where the document picker searches. */
export function QuestionFields({ team: slug, scope, form, onChange, errors }: FieldsProps) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ComboboxOption[]>([]);
  const docs = useEvalDocuments(slug, scope, useDebounced(text));
  const options: ComboboxOption[] = (docs.data ?? []).map((d) => ({ value: d.id, label: documentLabel(d), hint: d.sourceName }));
  // Picked documents stay listed (with their names) while the search changes.
  for (const p of picked) if (!options.some((o) => o.value === p.value)) options.push(p);
  return (
    <>
      <Field label="Question" error={errors.question}>
        <Textarea aria-required rows={2} maxLength={4000} value={form.question} onChange={(e) => onChange({ ...form, question: e.target.value })} />
      </Field>
      <Field
        label="Expected documents"
        description="Pick documents from the knowledge base, or enter URLs and filenames below: at least one. Any of them counts as a good result."
        error={errors.expected}
      >
        <Combobox
          multiple
          items={options}
          value={form.documentIds}
          onInputValueChange={setText}
          onValueChange={(ids, opts) => {
            setPicked(opts);
            onChange({ ...form, documentIds: ids });
          }}
          placeholder="Search documents by title, filename or URL"
          chipsLabel="Picked documents"
          emptyText="No matching documents."
        />
      </Field>
      <Field label="URLs and filenames" description="Pages (end a URL with * for everything under it) and filenames, one at a time.">
        <TagInput value={form.others} onValueChange={(others) => onChange({ ...form, others })} maxTags={20} maxTagLength={2048} normalize={(t) => t.trim()} placeholder="https://example.edu/registrar/transcripts*" />
      </Field>
      <Field label="Must mention" labelHint="Optional" description="Phrases a good answer contains (full-answer checks only; case doesn't matter).">
        <TagInput value={form.mustMention} onValueChange={(mustMention) => onChange({ ...form, mustMention })} maxTags={20} maxTagLength={200} normalize={(t) => t.trim()} placeholder="Add a phrase…" />
      </Field>
      <Field label="Note" labelHint="Optional">
        <Textarea rows={2} maxLength={2000} value={form.note} onChange={(e) => onChange({ ...form, note: e.target.value })} />
      </Field>
    </>
  );
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

/** "New question" and "Edit question". */
export function QuestionDialog({ setId, question, onClose }: { setId: string; question?: EvalQuestion; onClose: () => void }) {
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
      <QuestionFields team={slug} scope={{ setId }} form={form} onChange={setForm} errors={errors} />
    </FormDialog>
  );
}
