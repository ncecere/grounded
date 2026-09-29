/*
 * The team's Evaluations page (I3, docs/v0.2.1.md): every evaluation set of
 * the team, with what it tests, its latest score (the Evaluations tabs'
 * Score), the trend against the run before and when it last ran, and a
 * Regressions filter (?trend=down). The parent of every set's address, the
 * target of the team sidebar's Evaluations item, of ⌘K "evaluations" and of
 * the Overview's "All evaluations". Sets are created on a knowledge base's
 * or an agent's Evaluations tab, which is where they belong. Editors and
 * above while evaluations are on; others get the not-found page, as on a set.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, FolderOpen } from "lucide-react";
import { NotFoundState } from "@/components/not-found";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { plural, useTeam } from "../common";
import { runScore } from "./labels";
import { type EvalSet, evalSetsQuery, useEvaluationsOn } from "./queries";
import { LastScore, TrendValue } from "./score";
import { setTrend } from "./trend";

/** What a set tests, as a link to that knowledge base's or agent's Evaluations tab. */
export function TargetLink({ set, slug }: { set: Pick<EvalSet, "target">; slug: string }) {
  const t = set.target;
  return t.type === "agent" ? (
    <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team: slug, agentId: t.id }} search={{ tab: "evaluations" }} />}>{t.name}</TextLink>
  ) : (
    <TextLink render={<Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId: t.id }} search={{ tab: "evaluations" }} />}>{t.name}</TextLink>
  );
}

const trendFacet: Facet<EvalSet>[] = [
  {
    id: "trend",
    label: "Trend",
    type: "toggle",
    allLabel: "All sets",
    accessor: (x) => (setTrend(x).direction === "down" ? "down" : "other"),
    options: [{ value: "down", label: "Regressions" }],
  },
];

export function TeamEvaluationsPage() {
  const { slug, team, canEdit } = useTeam();
  const on = useEvaluationsOn();
  const sets = useQuery({ ...evalSetsQuery(slug), enabled: on && canEdit });
  if (!on || !canEdit) return <NotFoundState />;

  const setLink = (x: EvalSet) => <Link to="/teams/$team/evaluations/$setId" params={{ team: slug, setId: x.id }} />;
  const columns: DataTableColumn<EvalSet>[] = [
    {
      id: "name",
      header: "Set",
      rowHeader: true,
      sortable: true,
      accessor: (x) => x.name,
      cell: (x) => (
        <CellText
          primary={
            <TextLink render={setLink(x)} className={s.primary}>
              {x.name}
            </TextLink>
          }
          secondary={plural(x.questionCount, "question")}
        />
      ),
    },
    {
      id: "target",
      header: "Tests",
      sortable: true,
      defaultHiddenNarrow: true,
      accessor: (x) => x.target.name,
      cell: (x) => <CellText primary={<TargetLink set={x} slug={slug} />} secondary={x.target.type === "agent" ? "Agent" : "Knowledge base"} />,
    },
    { id: "score", header: "Latest score", sortable: true, accessor: (x) => (x.lastRun ? (runScore(x.lastRun) ?? -1) : -2), cell: (x) => <LastScore set={x} /> },
    { id: "trend", header: "Trend", sortable: true, accessor: (x) => setTrend(x).points ?? 0, cell: (x) => <TrendValue set={x} /> },
    {
      id: "lastRun",
      header: "Last run",
      sortable: true,
      defaultHiddenNarrow: true,
      accessor: (x) => x.lastRun?.createdAt ?? "",
      cell: (x) => (x.lastRun ? <RelativeTime value={x.lastRun.createdAt} /> : <span className={s.muted}>Never</span>),
    },
  ];

  return (
    <ListPage<EvalSet>
      id="team-evaluation-sets"
      title="Evaluations"
      description={`The evaluation sets of ${team.name}: test questions for its knowledge bases and agents, with each set's latest score and how it changed since the run before. Create a set on a knowledge base's or an agent's Evaluations tab.`}
      caption="Evaluation sets"
      columns={columns}
      data={sets.data ?? []}
      getRowId={(x) => x.id}
      rowLabel={(x) => x.name}
      facets={trendFacet}
      // Its label is for screen readers (bitop-ui's DataTable hides it); the placeholder says what it searches.
      search={{ label: "Search evaluation sets", placeholder: "Set, knowledge base or agent" }}
      rowActions={(x) => [{ label: "Open", icon: <FolderOpen aria-hidden />, render: setLink(x) }]}
      empty={{
        icon: <ClipboardCheck />,
        title: "No evaluation sets yet.",
        description: "A set is a list of questions with the documents that should answer them. Create one on a knowledge base's Evaluations tab.",
        action: (
          <Button variant="secondary" render={<Link to="/teams/$team/kbs" params={{ team: slug }} />}>
            Go to knowledge bases
          </Button>
        ),
      }}
      loading={sets.isLoading}
      error={sets.error}
      onRetry={() => void sets.refetch()}
    />
  );
}
