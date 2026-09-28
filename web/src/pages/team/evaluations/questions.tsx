/*
 * A set's Questions tab: the questions on a ListPage, each opening as a
 * record page (?record=) with its results across runs; "New question" (a
 * dialog) and "Import questions" (a form page, ?form=import).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, ListChecks, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { useFormParam } from "@/components/templates/form-page";
import { ListPage } from "@/components/templates/list-page";
import { RecordLink, useRecordParam } from "@/components/templates/record-page";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { ImportPage } from "./import";
import { expectedList } from "./labels";
import { QuestionDialog } from "./question-form";
import { QuestionRecord } from "./question-record";
import { type EvalQuestion, type EvalSet, evalQuestionsKey, evalQuestionsQuery, evalSetKey, evalSetsKey } from "./queries";

export function QuestionsTab({ set }: { set: EvalSet }) {
  const { slug, canEdit } = useTeam();
  const record = useRecordParam();
  const form = useFormParam();
  const [editing, setEditing] = useState<EvalQuestion | "new" | null>(null);
  const [deleting, setDeleting] = useState<EvalQuestion | null>(null);
  const questions = useQuery(evalQuestionsQuery(slug, set.id));
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async (q: EvalQuestion) =>
      unwrap(await api.DELETE("/v1/teams/{team}/evaluation-sets/{setId}/questions/{questionId}", { params: { path: { team: slug, setId: set.id, questionId: q.id } } })),
    onSuccess: (_, q) => {
      setDeleting(null);
      if (record.id === q.id) record.close();
      toast.success("Question deleted");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: evalQuestionsKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetsKey(slug) });
    },
  });
  const newQuestion = canEdit ? (
    <Button onClick={() => setEditing("new")}>
      <Plus aria-hidden /> New question
    </Button>
  ) : undefined;

  const columns: DataTableColumn<EvalQuestion>[] = [
    {
      id: "question",
      header: "Question",
      rowHeader: true,
      sortable: true,
      accessor: (q) => q.question,
      cell: (q) => <CellText primary={<RecordLink id={q.id}>{q.question}</RecordLink>} secondary={q.note || undefined} />,
    },
    { id: "expected", header: "Expected", accessor: (q) => expectedList(q).join(", "), muted: true },
    { id: "mention", header: "Must mention", accessor: (q) => q.mustMention.join(", ") || "—", muted: true },
  ];

  return (
    <Stack gap={4}>
      <PageHeader
        title="Questions"
        titleAs="h2"
        description="Each question names the documents a good result finds; must-mention phrases are checked in full-answer runs."
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => form.open("import")}>
                <Upload aria-hidden /> Import questions
              </Button>
              {newQuestion}
            </>
          )
        }
      />
      <ListPage<EvalQuestion>
        id="evaluation-questions"
        caption="Questions"
        columns={columns}
        data={questions.data ?? []}
        getRowId={(q) => q.id}
        rowLabel={(q) => q.question}
        search={{ label: "Search questions" }}
        rowActions={(q) => [
          { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(q.id) },
          { label: "Edit question", icon: <Pencil aria-hidden />, onSelect: () => setEditing(q), hidden: !canEdit },
          { label: "Delete question", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setDeleting(q), hidden: !canEdit },
        ]}
        empty={{ icon: <ListChecks />, title: "No questions yet.", description: "Type questions in or import a CSV or JSONL file.", action: newQuestion }}
        loading={questions.isLoading}
        error={questions.error}
        onRetry={() => void questions.refetch()}
      />
      <QuestionRecord set={set} onEdit={setEditing} onDelete={setDeleting} />
      {form.id === "import" && <ImportPage set={set} onClose={form.close} />}
      {editing && <QuestionDialog setId={set.id} question={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={remove}
        onConfirm={(q) => remove.mutate(q)}
        title="Delete this question?"
        description="Past runs keep its results."
        confirmLabel="Delete question"
      />
    </Stack>
  );
}
