/*
 * A question as a record page (?record=<id> on the Questions tab): what a
 * good result is (with a warning for expected documents and phrases the
 * knowledge bases don't hold yet), and its result in each of the latest
 * runs. Edit question is the header's action; Delete is in the "…" menu
 * (destructive actions aren't header buttons, Q12).
 */
import { Pencil, Trash2 } from "lucide-react";
import { ActionMenu } from "@/components/templates/action-menu";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { Time } from "@/components/ui/time/time";
import s from "../../shared.module.css";
import { useTeam } from "../common";
import { ResultDetail } from "./result-detail";
import { expectedList, kindLabels, resultLabel, triggerLabels } from "./labels";
import { type EvalQuestion, type EvalSet, useEvalQuestion, useQuestionCheck } from "./queries";
import { Warnings, checkWarnings } from "./question-fields";
import { setWhere } from "./question-form";
import e from "./evaluations.module.css";

type Props = { set: EvalSet; onEdit: (q: EvalQuestion) => void; onDelete: (q: EvalQuestion) => void };

/** The question's expected documents, and what the knowledge bases don't hold of them (and of its phrases). */
function Expected({ set, question }: { set: EvalSet; question: EvalQuestion }) {
  const { slug } = useTeam();
  const answers = set.target.type === "agent";
  const check = useQuestionCheck(slug, { setId: set.id }, { expected: question.expected, mustMention: answers ? question.mustMention : [] });
  const w = checkWarnings(check.data, setWhere(set), answers);
  return (
    <>
      {expectedList(question).join(", ")}
      <Warnings items={[...w.expected, ...w.phrases]} label="Not in the knowledge base" />
    </>
  );
}

export function QuestionRecord({ set, onEdit, onDelete }: Props) {
  const { slug, canEdit } = useTeam();
  const record = useRecordParam();
  const q = useEvalQuestion(slug, set.id, record.id);
  const question = q.data?.question;
  const results = q.data?.results ?? [];
  const answers = set.target.type === "agent";
  return (
    <RecordPage
      open={Boolean(record.id)}
      onClose={record.close}
      title={question?.question ?? "Question"}
      label="Question"
      description="A question in this evaluation set."
      loading={q.isLoading}
      error={q.error}
      actions={
        question &&
        canEdit && (
          <>
            <ActionMenu label="More actions" size="md" actions={[{ label: "Delete question", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => onDelete(question) }]} />
            <Button onClick={() => onEdit(question)}>
              <Pencil aria-hidden /> Edit question
            </Button>
          </>
        )
      }
      facts={
        question
          ? [
              { label: "Expected documents", value: <Expected set={set} question={question} /> },
              ...(answers || question.mustMention.length > 0 ? [{ label: "Must mention", value: question.mustMention.join(", ") || "—" }] : []),
              { label: "Note", value: question.note || "—" },
            ]
          : []
      }
      sections={[
        {
          title: "Results in the latest runs",
          content:
            results.length === 0 ? (
              <p className={s.muted}>Not run yet.</p>
            ) : (
              <Stack gap={4}>
                {results.map((r) => (
                  <Card key={r.id} flush className={e.result}>
                    <div className={e.resultHead}>
                      <StatusBadge tone={resultLabel(r).tone}>{resultLabel(r).label}</StatusBadge>
                      <span>
                        {kindLabels[r.runKind]} run · {triggerLabels[r.runTrigger]} · <Time value={r.runCreatedAt} />
                      </span>
                    </div>
                    <ResultDetail result={r} />
                  </Card>
                ))}
              </Stack>
            ),
        },
      ]}
    />
  );
}
