/*
 * Import questions (?form=import): a CSV (question,expected,must_mention,
 * with | between several values) or ragbench's URL-judged JSONL. Choosing a
 * file previews it (a dry run: the rows it can't use, by line); the submit
 * button adds the rest.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormPage, FormSection } from "@/components/templates/form-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { DropZone } from "@/components/ui/drop-zone/drop-zone";
import { Field } from "@/components/ui/field/field";
import { NativeSelect, Textarea } from "@/components/ui/input/input";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { plural, useTeam } from "../common";
import { importFormat } from "./labels";
import { type EvalSet, evalQuestionsKey, evalSetKey, evalSetsKey } from "./queries";
import e from "./evaluations.module.css";

type Format = "csv" | "jsonl";
type Preview = Schemas["EvaluationImportResult"];

export function ImportPage({ set, onClose }: { set: EvalSet; onClose: () => void }) {
  const { slug } = useTeam();
  const qc = useQueryClient();
  const [format, setFormat] = useState<Format>("csv");
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  // Closed once added, after the unsaved-changes guard has seen the form is done.
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) onClose();
  }, [done, onClose]);
  const send = async (dryRun: boolean, body = content, fmt = format) =>
    unwrap(await api.POST("/v1/teams/{team}/evaluation-sets/{setId}/questions/import", { params: { path: { team: slug, setId: set.id } }, body: { format: fmt, content: body, dryRun } }));
  const check = useMutation({ mutationFn: async (a: { body: string; fmt: Format }) => send(true, a.body, a.fmt), onSuccess: setPreview });
  const commit = useMutation({
    mutationFn: async () => send(false),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: evalQuestionsKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
      toast.success(`${plural(res.added, "question")} added`);
      setDone(true);
    },
  });
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const fmt = importFormat(file.name);
    setFormat(fmt);
    setContent(text);
    setPreview(null);
    check.mutate({ body: text, fmt });
  };
  const over = preview && preview.max !== null && preview.current + preview.usable > preview.max;

  return (
    <FormPage
      label="Import questions"
      title="Import questions"
      description={`Adds questions to ${set.name}. Preview first: rows that can't be used are listed and left out.`}
      onClose={onClose}
      onSubmit={() => commit.mutate()}
      submitLabel={preview ? `Add ${plural(preview.usable, "question")}` : "Add questions"}
      submitDisabled={!preview || preview.usable === 0 || Boolean(over)}
      busy={commit.isPending}
      dirty={content !== "" && !done}
    >
      <FormSection title="File">
        <p className={s.span2}>
          CSV: <code>question,expected,must_mention</code> (and an optional note column), with | between several values. Expected values are document IDs, URLs
          (end one with * for a prefix) or filenames. JSONL: one <code>{'{"id": "q1", "question": "Where do I park?", "urls": ["https://example.edu/parking/"]}'}</code> per line, as in URL-judged
          benchmark sets.
        </p>
        {/* The same drop zone as a source's uploads: a real button, and drag and drop. */}
        <DropZone
          className={s.span2}
          label="Drag and drop a file here, or"
          buttonLabel="Choose a file"
          description="A .csv or .jsonl file. It's previewed at once; nothing is added until you confirm."
          accept=".csv,.jsonl,.ndjson,text/csv"
          multiple={false}
          busy={check.isPending}
          onFiles={(files) => void onFile(files[0])}
        />
        <Field label="Format">
          <NativeSelect value={format} onChange={(ev) => setFormat(ev.target.value as Format)}>
            <option value="csv">CSV</option>
            <option value="jsonl">JSONL (URL-judged)</option>
          </NativeSelect>
        </Field>
        <Field label="Contents" description="The chosen file's text, or paste it here." className={s.span2}>
          <Textarea
            rows={10}
            className={e.contents}
            value={content}
            onChange={(ev) => {
              setContent(ev.target.value);
              setPreview(null);
            }}
          />
        </Field>
        <div className={s.span2}>
          <Button variant="secondary" disabled={!content.trim()} loading={check.isPending} onClick={() => check.mutate({ body: content, fmt: format })}>
            Preview
          </Button>
        </div>
      </FormSection>
      <ApiErrorAlert error={check.error ?? commit.error} />
      {preview && <PreviewSection preview={preview} over={Boolean(over)} />}
    </FormPage>
  );
}

function PreviewSection({ preview, over }: { preview: Preview; over: boolean }) {
  return (
    <FormSection title="Preview">
      <p role="status">
        {plural(preview.rows, "row")} read: {plural(preview.usable, "question")} can be added
        {preview.problems.length > 0 ? `, ${plural(preview.problems.length, "row")} can't be used` : ""}
        {preview.warnings.length > 0 ? `, ${plural(preview.warnings.length, "question")} expect documents that aren't in the knowledge base yet` : ""}.
      </p>
      {over && (
        <Alert tone="warning" title="Too many questions">
          The set has {preview.current} questions and holds at most {preview.max}. Remove rows or questions first.
        </Alert>
      )}
      {preview.problems.length > 0 && (
        <Table caption="Rows that can't be used" columns={[{ label: "Line", width: "6rem" }, "Why"]}>
          {preview.problems.map((p) => (
            <Tr key={`${p.line}-${p.message}`}>
              <Td>{p.line}</Td>
              <Td>{p.message}</Td>
            </Tr>
          ))}
        </Table>
      )}
      {preview.warnings.length > 0 && (
        // Added anyway: they count once a matching document is added.
        <Table caption="Added, but nothing matches yet" columns={[{ label: "Line", width: "6rem" }, "Warning"]}>
          {preview.warnings.map((p) => (
            <Tr key={`${p.line}-${p.message}`}>
              <Td>{p.line}</Td>
              <Td>{p.message}</Td>
            </Tr>
          ))}
        </Table>
      )}
    </FormSection>
  );
}
