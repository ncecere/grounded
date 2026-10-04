/*
 * A set's Questions tab: the questions on a ListPage, each opening as a
 * record page (?record=) with its results across runs; "New question" (a
 * dialog) and "Import questions" (a form page, ?form=import). When some
 * need attention (attention.tsx), a Needs attention column and filter
 * (?attention=needs) show which and why.
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
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { AttentionCell, attentionFacet, problemTexts, problemsById } from "./attention";
import { ImportPage } from "./import";
import { expectedList, smallList } from "./labels";
import { QuestionDialog, setWhere } from "./question-form";
import { QuestionRecord } from "./question-record";
import { type EvalQuestion, type EvalSet, evalProblemsQuery, evalQuestionsKey, evalQuestionsQuery, evalSetKey, evalSetsKey } from "./queries";

export function QuestionsTab({ set }: { set: EvalSet }) {
  const { slug, canEdit } = useTeam();
  const record = useRecordParam();
  const form = useFormParam();
  const [editing, setEditing] = useState<EvalQuestion | "new" | null>(null);
  const [deleting, setDeleting] = useState<EvalQuestion | null>(null);
  const questions = useQuery(evalQuestionsQuery(slug, set.id));
  const problems = problemsById(useQuery(evalProblemsQuery(slug, set.id)).data);
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
  // Secondary: Run is the set page's primary action.
  const newQuestion = canEdit ? (
    <Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
      <Plus aria-hidden /> New question
    </Button>
  ) : undefined;
  // Must-mention phrases are checked in full-answer runs, which only an agent's sets have.
  const answers = set.target.type === "agent";
  const where = setWhere(set);

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
    ...(answers ? [{ id: "mention", header: "Must mention", accessor: (q: EvalQuestion) => q.mustMention.join(", ") || "—", muted: true }] : []),
    ...(problems.size > 0
      ? [
          {
            id: "attention",
            header: "Needs attention",
            sortable: true,
            accessor: (q: EvalQuestion) => {
              const p = problems.get(q.id);
              return p ? problemTexts(p, where, answers).join(" ") : "";
            },
            cell: (q: EvalQuestion) => <AttentionCell problem={problems.get(q.id)} where={where} answers={answers} />,
          },
        ]
      : []),
  ];

  return (
    <Stack gap={4}>
      <Card
        title="Questions"
        description={
          answers
            ? "Each question names the documents a good result finds; must-mention phrases are checked in full-answer runs."
            : "Each question names the documents a good result finds."
        }
        actions={
          canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => form.open("import")}>
                <Upload aria-hidden /> Import questions
              </Button>
              {newQuestion}
            </>
          )
        }
      >
        <ListPage<EvalQuestion>
          id="evaluation-questions"
          caption="Questions"
          columns={columns}
          data={questions.data ?? []}
          getRowId={(q) => q.id}
          rowLabel={(q) => q.question}
          facets={problems.size > 0 ? [attentionFacet(problems)] : undefined}
          search={{ label: "Search questions", showLabel: true }}
          rowActions={(q) => [
            { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(q.id) },
            { label: "Edit question", icon: <Pencil aria-hidden />, onSelect: () => setEditing(q), hidden: !canEdit },
            { label: "Delete question", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setDeleting(q), hidden: !canEdit },
          ]}
          empty={{ icon: <ListChecks />, title: "No questions yet.", description: "Add one with New question, or import a CSV or JSONL file." }}
          tableProps={smallList}
          loading={questions.isLoading}
          error={questions.error}
          onRetry={() => void questions.refetch()}
        />
      </Card>
      <QuestionRecord set={set} onEdit={setEditing} onDelete={setDeleting} />
      {form.id === "import" && <ImportPage set={set} onClose={form.close} />}
      {editing && <QuestionDialog set={set} question={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
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
