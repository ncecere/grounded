/*
 * A set's Runs tab: the runs on a ListPage (live while one is in progress),
 * each opening as a record page (?record=) with its results and a
 * comparison with another run, then, from three completed runs, a compact
 * chart of the score over time. Run is the set page's primary action (one
 * per view), so the tab has no button of its own. A knowledge base's sets
 * only have retrieval runs: no kind filter.
 */
import { Eye, History } from "lucide-react";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { RecordLink, useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { useTeam } from "../common";
import { ScoreChart } from "./chart";
import { kindLabels, runStatusLook, runTitle, triggerLabels, unscored } from "./labels";
import { type EvalRun, type EvalSet, active, useEvalRuns } from "./queries";
import { RunRecord } from "./run-record";
import { ScoreValue } from "./score";
import { formatDate } from "@/lib/format";

const kindFacet: Facet<EvalRun>[] = [
  {
    id: "kind",
    label: "Kind",
    type: "toggle",
    allLabel: "All",
    accessor: (r) => r.kind,
    options: [
      { value: "retrieval", label: "Retrieval" },
      { value: "answer", label: "Full answer" },
    ],
  },
];

/** "3 of 40 checked" while running. */
export const progressText = (r: EvalRun) => `${r.done} of ${r.total} checked`;

/** "1 passed · 1 failed · 1 not scored · 2 checks failed": not scored (no expected document indexed) and failed checks apart, as the results filter has them. */
export function countsText(r: EvalRun) {
  const s = r.summary;
  const errors = s.errors ? ` · ${s.errors} ${s.errors === 1 ? "check" : "checks"} failed` : "";
  return `${s.passed} passed · ${s.failed} failed${s.missing ? ` · ${s.missing} not scored` : ""}${errors}`;
}

/** The score while it's known: the same column for both kinds, the metric in the tooltip; "No score" when no question could be scored. */
function ScoreCell({ run }: { run: EvalRun }) {
  if (active(run)) return <>{progressText(run)}</>;
  if (unscored(run)) return <>No score</>;
  if (run.status !== "completed" && run.summary.passed + run.summary.failed === 0) return <>—</>;
  return <ScoreValue run={run} />;
}

export function RunsTab({ set }: { set: EvalSet }) {
  const { slug } = useTeam();
  const record = useRecordParam();
  const runs = useEvalRuns(slug, set.id);
  const list = runs.data ?? [];
  const agentSet = set.target.type === "agent";
  const columns: DataTableColumn<EvalRun>[] = [
    timeColumn("createdAt", "Started", (r) => r.createdAt),
    {
      id: "kind",
      header: "Kind",
      rowHeader: true,
      accessor: (r) => kindLabels[r.kind],
      cell: (r) => (
        <CellText
          primary={
            // The name is one text ("Retrieval, Sep 28, 2026, 7:20 PM"): split over two elements, browsers read "Retrieval , Sep 28" (G20).
            <RecordLink id={r.id}>
              <span aria-hidden>{kindLabels[r.kind]}</span>
              <VisuallyHidden>{`${kindLabels[r.kind]}, ${formatDate(r.createdAt)}`}</VisuallyHidden>
            </RecordLink>
          }
          secondary={triggerLabels[r.trigger]}
        />
      ),
    },
    { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge tone={runStatusLook(r).tone} pulse={active(r)}>{runStatusLook(r).label}</StatusBadge> },
    { id: "score", header: "Score", accessor: (r) => r.summary.recall ?? r.summary.passRate ?? -1, cell: (r) => <ScoreCell run={r} /> },
    { id: "counts", header: "Questions", accessor: countsText, muted: true },
  ];
  return (
    <Stack gap={4}>
      <PageHeader
        title="Runs"
        titleAs="h2"
        description={`${agentSet ? "Retrieval and full-answer runs" : "Retrieval runs"} of this set, newest first. Start one with Run above.`}
      />
      <ListPage<EvalRun>
        id="evaluation-runs"
        caption="Runs"
        columns={columns}
        data={list}
        getRowId={(r) => r.id}
        rowLabel={runTitle}
        facets={agentSet ? kindFacet : undefined}
        tableProps={{ columnsMenu: false }}
        rowActions={(r) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(r.id) }]}
        empty={{ icon: <History />, title: "No runs yet.", description: "A retrieval run puts each question through the search and needs no model." }}
        loading={runs.isLoading}
        error={runs.error}
        onRetry={() => void runs.refetch()}
      />
      <ScoreChart runs={list} />
      <RunRecord set={set} runs={list} />
    </Stack>
  );
}
