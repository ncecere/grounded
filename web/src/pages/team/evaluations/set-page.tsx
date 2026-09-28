/*
 * An evaluation set's page (docs/evaluations.md §5): a DetailPage with Run
 * as the primary action and pill tabs Questions · Runs · Settings. A
 * question and a run open as record pages (?record=), the import as a form
 * page (?form=import).
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Download, History, ListChecks, Play, Settings2 } from "lucide-react";
import { useState } from "react";
import { NotFoundState, isNotFound } from "@/components/not-found";
import { useUrlTab } from "@/components/page-tabs";
import { DetailPage } from "@/components/templates/detail-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { TextLink } from "@/components/ui/text-link/text-link";
import { evaluationSetTabs } from "@/lib/tabs";
import { plural, useTeam } from "../common";
import { ArchivedNotice, PageSkeleton } from "../layout";
import { scoreText } from "./labels";
import { type EvalSet, evalSetQuery, useEvaluationsOn } from "./queries";
import { QuestionsTab } from "./questions";
import { RunDialog } from "./run-dialog";
import { RunsTab } from "./runs";
import { SetSettings } from "./set-settings";

export function EvaluationSetPage() {
  const { setId } = useParams({ from: "/app/teams/$team/evaluations/$setId" });
  const { slug, canEdit } = useTeam();
  const on = useEvaluationsOn();
  const set = useQuery({ ...evalSetQuery(slug, setId), enabled: on && canEdit });
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

function SetPage({ set }: { set: EvalSet }) {
  const { slug, archived } = useTeam();
  const [, setTab] = useUrlTab(evaluationSetTabs);
  const [running, setRunning] = useState(false);
  const last = set.lastRun;
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
        ]}
        primaryAction={
          <Button onClick={() => setRunning(true)} disabled={archived || set.questionCount === 0} title={set.questionCount === 0 ? "Add questions first" : undefined}>
            <Play aria-hidden /> Run
          </Button>
        }
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
          { value: "runs", label: "Runs", icon: <History aria-hidden />, content: <RunsTab set={set} onRun={() => setRunning(true)} /> },
          { value: "settings", label: "Settings", icon: <Settings2 aria-hidden />, hidden: archived, content: <SetSettings set={set} /> },
        ]}
      />
      {running && <RunDialog set={set} onClose={() => setRunning(false)} onStarted={() => setTab("runs")} />}
    </>
  );
}
