/*
 * A question as a record page (?record=<id> on the Questions tab): what a
 * good result is, and its result in each of the latest runs (what came back,
 * and for full answers the answer and its scores).
 */
import { Pencil, Trash2 } from "lucide-react";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { Stack } from "@/components/ui/layout/layout";
import { Time } from "@/components/ui/time/time";
import s from "../../shared.module.css";
import { useTeam } from "../common";
import { ResultDetail } from "./result-detail";
import { expectedList, kindLabels, resultStatus, triggerLabels } from "./labels";
import { type EvalQuestion, type EvalSet, useEvalQuestion } from "./queries";
import e from "./evaluations.module.css";

type Props = { set: EvalSet; onEdit: (q: EvalQuestion) => void; onDelete: (q: EvalQuestion) => void };

export function QuestionRecord({ set, onEdit, onDelete }: Props) {
  const { slug, canEdit } = useTeam();
  const record = useRecordParam();
  const q = useEvalQuestion(slug, set.id, record.id);
  const question = q.data?.question;
  const results = q.data?.results ?? [];
  return (
    <RecordPage
      open={Boolean(record.id)}
      onClose={record.close}
      title={question?.question ?? "Question"}
      label="Question"
      description={`A question of ${set.name}.`}
      loading={q.isLoading}
      error={q.error}
      actions={
        question &&
        canEdit && (
          <>
            <Button variant="danger" onClick={() => onDelete(question)}>
              <Trash2 aria-hidden /> Delete
            </Button>
            <Button onClick={() => onEdit(question)}>
              <Pencil aria-hidden /> Edit question
            </Button>
          </>
        )
      }
      facts={
        question
          ? [
              { label: "Expected documents", value: expectedList(question).join(", ") },
              { label: "Must mention", value: question.mustMention.join(", ") || "—" },
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
                      <StatusBadge tone={resultStatus[r.status].tone}>{resultStatus[r.status].label}</StatusBadge>
                      <span>
                        {kindLabels[r.runKind]} · {triggerLabels[r.runTrigger]} · <Time value={r.runCreatedAt} />
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
