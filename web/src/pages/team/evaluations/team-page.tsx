/*
 * The team's Evaluations page (I3, docs/v0.2.1.md): every evaluation set of
 * the team, with what it tests, its latest score (the Evaluations tabs'
 * Score, with when it last ran), the trend against the latest earlier
 * scored run, and a Regressions filter (?trend=down). Its columns are the
 * Evaluations tabs' (set-columns.tsx), plus the knowledge base or agent,
 * and the set's name is its only link (no row menu repeating it). The
 * parent of every set's address, the target of the team sidebar's
 * Evaluations item, of ⌘K "evaluations" and of the Overview's "All
 * evaluations". Sets are created on a knowledge base's
 * or an agent's Evaluations tab, which is where they belong. Editors and
 * above while evaluations are on; others get the not-found page, as on a set.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, TrendingDown } from "lucide-react";
import { NotFoundState } from "@/components/not-found";
import { ListPage, useListFilters } from "@/components/templates/list-page";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { EditorsOnlyState } from "../access";
import { useTeam } from "../common";
import { smallList } from "./labels";
import { type EvalSet, evalSetsQuery, useEvaluationsOn } from "./queries";
import { setColumns } from "./set-columns";
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
  const { slug, team, canEdit, role } = useTeam();
  const on = useEvaluationsOn();
  const sets = useQuery({ ...evalSetsQuery(slug), enabled: on && canEdit });
  const filters = useListFilters(trendFacet);
  if (on && role === "member") return <EditorsOnlyState title="Evaluations" what="evaluations" />;
  if (!on || !canEdit) return <NotFoundState />;

  const c = setColumns(slug);
  const columns: DataTableColumn<EvalSet>[] = [
    c.name,
    {
      id: "target",
      header: "Knowledge base or agent",
      sortable: true,
      defaultHiddenNarrow: true,
      accessor: (x) => x.target.name,
      cell: (x) => <CellText primary={<TargetLink set={x} slug={slug} />} secondary={x.target.type === "agent" ? "Agent" : "Knowledge base"} />,
    },
    c.questions,
    c.score,
    // On a phone the set's name and score share the width; the trend is left out.
    { ...c.trend, defaultHiddenNarrow: true },
  ];
  // Regressions alone matching nothing is good news, said as such.
  const regressionsOnly = (filters.values.trend as string[] | undefined)?.includes("down") && !filters.query;

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
      search={{ label: "Search evaluation sets", placeholder: "Set, knowledge base or agent", showLabel: true }}
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
      tableProps={{
        ...smallList,
        noResults: regressionsOnly ? (
          <EmptyState
            size="compact"
            icon={<TrendingDown />}
            title="No set got worse since its previous run."
            description="The latest run of every set scored the same as the run before it, or better."
          />
        ) : undefined,
      }}
      loading={sets.isLoading}
      error={sets.error}
      onRetry={() => void sets.refetch()}
    />
  );
}
