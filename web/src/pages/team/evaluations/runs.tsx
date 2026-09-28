/*
 * A set's Runs tab: the score over time, and the runs on a ListPage (live
 * while one is in progress), each opening as a record page (?record=) with
 * its results and a comparison with another run. Run is the set page's
 * primary action (one per view), so the tab has no button of its own.
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
import { decimal, kindLabels, pct, runStatus, triggerLabels } from "./labels";
import { type EvalRun, type EvalSet, active, useEvalRuns } from "./queries";
import { RunRecord } from "./run-record";
import { formatDate } from "@/lib/format";

const kindFacet: Facet<EvalRun>[] = [
  {
    id: "kind",
    label: "Check",
    type: "toggle",
    allLabel: "All",
    accessor: (r) => r.kind,
    options: [
      { value: "retrieval", label: "Retrieval" },
      { value: "answer", label: "Full answer" },
    ],
  },
];

/** "3 of 40 checked" while running, the score once done. */
export function progressText(r: EvalRun) {
  if (active(r)) return `${r.done} of ${r.total} checked`;
  if (r.kind === "answer") return `Pass rate ${pct(r.summary.passRate)}`;
  return `Recall@${r.summary.k} ${pct(r.summary.recall)} · MRR ${decimal(r.summary.mrr)}`;
}

export function RunsTab({ set }: { set: EvalSet }) {
  const { slug } = useTeam();
  const record = useRecordParam();
  const runs = useEvalRuns(slug, set.id);
  const list = runs.data ?? [];
  const columns: DataTableColumn<EvalRun>[] = [
    timeColumn("createdAt", "Started", (r) => r.createdAt),
    {
      id: "kind",
      header: "Check",
      rowHeader: true,
      accessor: (r) => kindLabels[r.kind],
      cell: (r) => (
        <CellText
          primary={
            <RecordLink id={r.id}>
              {kindLabels[r.kind]}
              <VisuallyHidden>, {formatDate(r.createdAt)}</VisuallyHidden>
            </RecordLink>
          }
          secondary={triggerLabels[r.trigger]}
        />
      ),
    },
    { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge tone={runStatus[r.status].tone} pulse={active(r)}>{runStatus[r.status].label}</StatusBadge> },
    { id: "score", header: "Score", accessor: progressText },
    { id: "counts", header: "Questions", accessor: (r) => `${r.summary.passed} passed · ${r.summary.failed} failed${r.summary.missing ? ` · ${r.summary.missing} deleted` : ""}`, muted: true },
  ];
  return (
    <Stack gap={4}>
      <PageHeader title="Runs" titleAs="h2" description="Retrieval checks and full-answer checks of this set, newest first. Start one with Run above." />
      <ScoreChart runs={list} />
      <ListPage<EvalRun>
        id="evaluation-runs"
        caption="Runs"
        columns={columns}
        data={list}
        getRowId={(r) => r.id}
        rowLabel={(r) => `${kindLabels[r.kind]}, ${formatDate(r.createdAt)}`}
        facets={kindFacet}
        rowActions={(r) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(r.id) }]}
        empty={{ icon: <History />, title: "No runs yet.", description: "A retrieval check runs each question through the search and needs no model." }}
        loading={runs.isLoading}
        error={runs.error}
        onRetry={() => void runs.refetch()}
      />
      <RunRecord set={set} runs={list} />
    </Stack>
  );
}
