/*
 * A question's result in one run, as a record page over the run's page
 * (?result=<result id> next to ?record=<run id>): the verdict said once,
 * then Expected beside What came back, or the answer with its citations and
 * scores. Actions: Try this search (the knowledge base's Try it with the
 * question), Open expected document, Edit question, and "Open the question"
 * (its results across runs) in the "…" menu. The back link returns to the
 * run, with its filters.
 */
import { Link } from "@tanstack/react-router";
import { FileText, ListChecks, Pencil, Search } from "lucide-react";
import { useState } from "react";
import { ActionMenu } from "@/components/templates/action-menu";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { useTeam } from "../common";
import { resultLabel, runTitle } from "./labels";
import { type EvalResult, type EvalRun, type EvalSet, useEvalQuestion } from "./queries";
import { QuestionDialog } from "./question-form";
import { ResultDetail, verdictText } from "./result-detail";

export const RESULT_PARAM = "result";

/** The knowledge base whose Try it runs this search: the set's, or the only one an agent's run searched. */
function tryKB(set: EvalSet, run?: EvalRun) {
  if (set.target.type === "knowledge_base") return set.target.id;
  return run?.config.kbs.length === 1 ? run.config.kbs[0]!.id : undefined;
}

function Actions({ set, run, result: r, onEdit }: { set: EvalSet; run?: EvalRun; result: EvalResult; onEdit: () => void }) {
  const { slug, canEdit } = useTeam();
  const kbId = tryKB(set, run);
  const doc = r.expectedItems.find((it) => it.documentId && it.sourceId);
  const questionSearch = (id: string) => ((prev: Record<string, unknown>) => ({ ...prev, tab: undefined, record: id, [RESULT_PARAM]: undefined, compare: undefined })) as never;
  return (
    <>
      {r.questionId && (
        <ActionMenu
          label="More actions"
          size="md"
          actions={[{ label: "Open the question", icon: <ListChecks aria-hidden />, render: <Link to="." search={questionSearch(r.questionId)} /> }]}
        />
      )}
      {kbId && (
        <Button variant="secondary" render={<Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId }} search={{ tab: "try", q: r.question } as never} />}>
          <Search aria-hidden /> Try this search
        </Button>
      )}
      {doc && (
        <Button
          variant="secondary"
          render={<Link to="/teams/$team/sources/$sourceId" params={{ team: slug, sourceId: doc.sourceId! }} search={{ tab: "documents", record: doc.documentId } as never} />}
        >
          <FileText aria-hidden /> Open expected document
        </Button>
      )}
      {r.questionId && canEdit && (
        <Button onClick={onEdit}>
          <Pencil aria-hidden /> Edit question
        </Button>
      )}
    </>
  );
}

/** "Edit question" from a result: the question is loaded first. */
function EditQuestion({ set, id, onClose }: { set: EvalSet; id: string; onClose: () => void }) {
  const { slug } = useTeam();
  const q = useEvalQuestion(slug, set.id, id);
  return q.data ? <QuestionDialog set={set} question={q.data.question} onClose={onClose} /> : null;
}

export function ResultRecord({ set, run, results, loading }: { set: EvalSet; run?: EvalRun; results: EvalResult[]; loading: boolean }) {
  const page = useRecordParam(RESULT_PARAM);
  const [editing, setEditing] = useState(false);
  const r = results.find((x) => x.id === page.id);
  const look = r && resultLabel(r);
  return (
    <>
      <RecordPage
        open={Boolean(page.id)}
        param={RESULT_PARAM}
        onClose={page.close}
        title={r?.question ?? "Result"}
        label="Result"
        description={r ? verdictText(r) : run ? `This question's result in the ${runTitle(run)}.` : "This question's result in the run."}
        meta={look && <StatusBadge tone={look.tone}>{look.label}</StatusBadge>}
        loading={loading}
        actions={r && <Actions set={set} run={run} result={r} onEdit={() => setEditing(true)} />}
        sections={[
          {
            title: r?.answer !== null && r?.answer !== undefined ? "Answer" : "Expected and what came back",
            content: r ? <ResultDetail result={r} /> : <p>This result isn't in the run.</p>,
          },
        ]}
      />
      {editing && r?.questionId && <EditQuestion set={set} id={r.questionId} onClose={() => setEditing(false)} />}
    </>
  );
}
