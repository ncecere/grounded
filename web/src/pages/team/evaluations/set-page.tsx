/*
 * An evaluation set's page (docs/evaluations.md §5): a DetailPage with Run
 * as the primary action and pill tabs Questions · Runs · Settings. A
 * question and a run open as record pages (?record=), the import as a form
 * page (?form=import).
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Download, History, ListChecks, Play, Settings2 } from "lucide-react";
import { useId, useState } from "react";
import { NotFoundState, isNotFound } from "@/components/not-found";
import { DetailPage } from "@/components/templates/detail-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Tooltip } from "@/components/ui/tooltip/tooltip";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { evaluationSetTabs } from "@/lib/tabs";
import { plural, useTeam } from "../common";
import { EditorsOnlyState } from "../access";
import { ArchivedNotice, PageSkeleton } from "../layout";
import { scoreText } from "./labels";
import { type EvalSet, evalProblemsQuery, evalSetQuery, useEvaluationsOn } from "./queries";
import { QuestionsTab } from "./questions";
import { RunDialog } from "./run-dialog";
import { RunsTab } from "./runs";
import { SetSettings } from "./set-settings";

export function EvaluationSetPage() {
  const { setId } = useParams({ from: "/app/teams/$team/evaluations/$setId" });
  const { slug, canEdit, role } = useTeam();
  const on = useEvaluationsOn();
  const set = useQuery({ ...evalSetQuery(slug, setId), enabled: on && canEdit });
  if (on && role === "member") return <EditorsOnlyState title="Evaluation set" what="evaluations" />;
  if (!on || !canEdit || isNotFound(set.error)) return <NotFoundState what="object" />;
  if (set.isLoading) return <PageSkeleton />;
  if (set.error || !set.data) return <ErrorAlert error={set.error} title="Couldn't load this evaluation set" />;
  return <SetPage set={set.data} />;
}

function TargetLink({ set }: { set: EvalSet }) {
  const { slug } = useTeam();
  const t = set.target;
  return t.type === "agent" ? (
    <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team: slug, agentId: t.id }} search={{ tab: "evaluations" }} />}>{t.name}</TextLink>
  ) : (
    <TextLink render={<Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId: t.id }} search={{ tab: "evaluations" }} />}>{t.name}</TextLink>
  );
}

/**
 * Run, the page's one primary action. When the set can't run it stays
 * focusable (aria-disabled, not disabled) and says why, so keyboard,
 * screen-reader and touch users get the reason too (P-04).
 */
function RunButton({ set, onRun }: { set: EvalSet; onRun: () => void }) {
  const { archived } = useTeam();
  const reasonId = useId();
  const reason = archived ? "The team is archived." : set.questionCount === 0 ? "Add questions first." : undefined;
  if (!reason)
    return (
      <Button onClick={onRun}>
        <Play aria-hidden /> Run
      </Button>
    );
  return (
    <>
      <Tooltip content={reason}>
        {/* A non-native button: aria-disabled and focusable, activation cancelled. */}
        <Button disabled render={<button type="button" />} aria-describedby={reasonId}>
          <Play aria-hidden /> Run
        </Button>
      </Tooltip>
      <VisuallyHidden id={reasonId}>{reason}</VisuallyHidden>
    </>
  );
}

/** "3 questions need attention": a link to the Questions tab's Needs attention filter (checked when the page opens). */
function NeedsAttention({ n }: { n: number }) {
  const search = ((prev: Record<string, unknown>) => ({ ...prev, tab: "questions", attention: "needs", record: undefined, result: undefined })) as never;
  return (
    <TextLink render={<Link to="." search={search} />}>
      {plural(n, "question")} {n === 1 ? "needs" : "need"} attention
    </TextLink>
  );
}

function SetPage({ set }: { set: EvalSet }) {
  const { slug, archived } = useTeam();
  const [running, setRunning] = useState(false);
  const last = set.lastRun;
  const problems = useQuery(evalProblemsQuery(slug, set.id)).data ?? [];
  return (
    <>
      <DetailPage
        title={set.name}
        description={set.description || undefined}
        facts={[
          { id: "target", label: set.target.type === "agent" ? "Agent" : "Knowledge base", value: <>Tests <TargetLink set={set} /></> },
          { id: "questions", label: "Questions", value: plural(set.questionCount, "question") },
          { id: "score", label: "Latest score", value: last && last.status === "completed" ? scoreText(last) : undefined },
          { id: "auto", label: "Automatic runs", value: set.autoRun ? "Automatic runs on" : "Automatic runs off" },
          { id: "attention", label: "Needs attention", value: problems.length > 0 ? <NeedsAttention n={problems.length} /> : undefined },
        ]}
        primaryAction={<RunButton set={set} onRun={() => setRunning(true)} />}
        menuActions={[
          {
            label: "Export questions (CSV)",
            icon: <Download aria-hidden />,
            render: <a href={`/v1/teams/${encodeURIComponent(slug)}/evaluation-sets/${set.id}/questions.csv`} download />,
          },
        ]}
        notices={<ArchivedNotice>Its evaluation sets can be viewed but not run or changed.</ArchivedNotice>}
        tabIds={evaluationSetTabs}
        tabsLabel="Evaluation set sections"
        tabs={[
          { value: "questions", label: "Questions", icon: <ListChecks aria-hidden />, count: set.questionCount, content: <QuestionsTab set={set} /> },
          { value: "runs", label: "Runs", icon: <History aria-hidden />, content: <RunsTab set={set} /> },
          { value: "settings", label: "Settings", icon: <Settings2 aria-hidden />, hidden: archived, content: <SetSettings set={set} /> },
        ]}
      />
      {running && <RunDialog set={set} onClose={() => setRunning(false)} />}
    </>
  );
}
