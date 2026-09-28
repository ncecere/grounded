/*
 * A question's result in one run, as a record page over the run's page
 * (?result=<result id> next to ?record=<run id>): what came back, or the
 * answer with its citations and scores. Its back link returns to the run,
 * with its filters; "Open the question" goes to the question's own page.
 */
import { Link } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { formatDate } from "@/lib/format";
import { kindLabels, resultStatus } from "./labels";
import type { EvalResult, EvalRun } from "./queries";
import { ResultDetail, whyText } from "./result-detail";

export const RESULT_PARAM = "result";

export function ResultRecord({ run, results, loading }: { run?: EvalRun; results: EvalResult[]; loading: boolean }) {
  const page = useRecordParam(RESULT_PARAM);
  const r = results.find((x) => x.id === page.id);
  const questionSearch = (id: string) => ((prev: Record<string, unknown>) => ({ ...prev, tab: undefined, record: id, [RESULT_PARAM]: undefined, compare: undefined })) as never;
  return (
    <RecordPage
      open={Boolean(page.id)}
      param={RESULT_PARAM}
      onClose={page.close}
      title={r?.question ?? "Result"}
      label="Result"
      description={run ? `This question's result in the ${kindLabels[run.kind].toLowerCase()} of ${formatDate(run.createdAt)}.` : "This question's result in the run."}
      meta={r && <StatusBadge tone={resultStatus[r.status].tone}>{resultStatus[r.status].label}</StatusBadge>}
      loading={loading}
      actions={
        r?.questionId && (
          <Button variant="secondary" render={<Link to="." search={questionSearch(r.questionId)} />}>
            <ListChecks aria-hidden /> Open the question
          </Button>
        )
      }
      facts={r && whyText(r) ? [{ label: "Why", value: whyText(r) }] : []}
      sections={[{ title: r?.answer !== null && r?.answer !== undefined ? "Answer" : "What came back", content: r ? <ResultDetail result={r} /> : <p>This result isn't in the run.</p> }]}
    />
  );
}
