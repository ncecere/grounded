/*
 * The question form's fields (docs/evaluations.md §1): the question, its
 * expected documents (picked from the knowledge base, or URLs, URL prefixes
 * ending in * and filenames), must-mention phrases (sets of an agent only:
 * a knowledge base's sets run retrieval checks, which don't read answers)
 * and a note. As they're filled in, the server says which expected
 * documents and phrases the knowledge bases don't hold yet: a warning, not
 * an error, since a document added later counts from then on.
 */
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox/combobox";
import { Field } from "@/components/ui/field/field";
import { Textarea } from "@/components/ui/input/input";
import { TagInput } from "@/components/ui/tag-input/tag-input";
import { useDebounced } from "../../admin/hooks";
import { splitExpected } from "./labels";
import { type DocumentScope, type EvalDocument, type EvalQuestionCheck, useEvalDocuments, useQuestionCheck } from "./queries";
import type { QuestionForm, questionErrors } from "./question-form";
import e from "./evaluations.module.css";

export type FieldsProps = {
  team: string;
  /** Where the document picker and the warnings look. */
  scope?: DocumentScope;
  form: QuestionForm;
  onChange: (f: QuestionForm) => void;
  errors: ReturnType<typeof questionErrors>;
  /** Full-answer runs apply (a set of an agent): ask for must-mention phrases. */
  answers: boolean;
  /** Where the documents are, for the warnings: "Student handbook" or "Helper's knowledge bases". */
  where: string;
  /** Documents picked already, with their names (an answer's citations). */
  initialPicked?: ComboboxOption[];
  /** A note under the expected documents ("The answer used Handbook. Is that the right source?"). */
  expectedNote?: string;
  /** Ask what a good answer says first, prominently (after a Not helpful or Incorrect rating). */
  askContent?: boolean;
};

/**
 * A document's option: its title, then its filename (or URL) when that's
 * different. The server matches the typed text on the title, filename and
 * URL (the picker doesn't filter again: filter={null}), and the label shows
 * which one it was.
 */
export function documentLabel(d: Pick<EvalDocument, "title" | "filename" | "url">) {
  const other = d.filename || d.url;
  if (!d.title) return other || "Untitled document";
  return other && other !== d.title ? `${d.title} · ${other}` : d.title;
}

/** The warnings of the server's check, in words. */
export function checkWarnings(check: EvalQuestionCheck | undefined, where: string, answers: boolean) {
  const expected: string[] = [];
  const phrases: string[] = [];
  for (const it of check?.expected ?? []) {
    if (it.state === "not_indexed") expected.push(`No document in ${where} matches “${it.value}” yet. It'll count once one is added.`);
    else if (it.state === "deleted") expected.push(`“${it.title || "A picked document"}” is no longer in ${where}.`);
  }
  if (answers)
    for (const m of check?.mustMention ?? [])
      if (!m.found) phrases.push(`“${m.phrase}” isn't in ${where}, so the answer can't contain it from the sources.`);
  return { expected, phrases };
}

export function Warnings({ items, label }: { items: string[]; label: string }) {
  // Always rendered, so screen readers hear warnings as they appear.
  return (
    <div aria-live="polite">
      {items.length > 0 && (
        <ul className={e.warnings} aria-label={label}>
          {items.map((w) => (
            <li key={w}>
              <TriangleAlert aria-hidden className={e.warningIcon} />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The fields; `scope` is where the document picker searches. */
export function QuestionFields({ team: slug, scope, form, onChange, errors, answers, where, initialPicked = [], expectedNote, askContent = false }: FieldsProps) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ComboboxOption[]>(initialPicked);
  const docs = useEvalDocuments(slug, scope, useDebounced(text));
  const options: ComboboxOption[] = (docs.data ?? []).map((d) => ({ value: d.id, label: documentLabel(d), hint: d.sourceName }));
  // Picked documents stay listed (with their names) while the search changes.
  for (const p of picked) if (!options.some((o) => o.value === p.value)) options.push(p);
  const checked = useDebounced(JSON.stringify({ expected: splitExpected(form.others, form.documentIds), mustMention: answers ? form.mustMention : [] }), 400);
  const check = useQuestionCheck(slug, scope, JSON.parse(checked));
  const warnings = checkWarnings(check.data, where, answers);

  const mention = answers && (
    <>
      <Field
        label={askContent ? "What should a good answer say?" : "Must mention"}
        labelHint="Optional"
        description={
          askContent
            ? "Phrases a good answer must mention, checked in full-answer runs. Without them, a run only checks that the answer cited the right source."
            : "Phrases a good answer contains, checked in full-answer runs; case doesn't matter."
        }
      >
        <TagInput value={form.mustMention} onValueChange={(mustMention) => onChange({ ...form, mustMention })} maxTags={20} maxTagLength={200} normalize={(t) => t.trim()} placeholder="Add a phrase…" />
      </Field>
      <Warnings items={warnings.phrases} label="Phrases not in the knowledge base" />
    </>
  );
  return (
    <>
      <Field label="Question" error={errors.question}>
        <Textarea aria-required rows={2} maxLength={4000} value={form.question} onChange={(ev) => onChange({ ...form, question: ev.target.value })} />
      </Field>
      {askContent && mention}
      <Field
        label="Expected documents"
        description={[expectedNote, "Pick documents from the knowledge base, or enter URLs and filenames below: at least one. Any of them counts as a good result."]
          .filter(Boolean)
          .join(" ")}
        error={errors.expected}
      >
        {/* Enter picks the highlighted document; it never submits the dialog (bitop-ui's Combobox, G19). */}
        <Combobox
          multiple
          filter={null}
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
      <Warnings items={warnings.expected} label="Expected documents not in the knowledge base" />
      {!askContent && mention}
      <Field label="Note" labelHint="Optional">
        <Textarea rows={2} maxLength={2000} value={form.note} onChange={(ev) => onChange({ ...form, note: ev.target.value })} />
      </Field>
    </>
  );
}
