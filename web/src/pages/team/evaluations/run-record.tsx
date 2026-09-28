/*
 * A run as a record page (?record=<run id> on the Runs tab): its scores and
 * configuration, live progress and Cancel while it runs, the results
 * (filterable to failures; a result opens as a page over the run,
 * ?result=<id>, result-record.tsx), and a comparison with another run
 * (?compare=<run id>).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Eye } from "lucide-react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { ListPage } from "@/components/templates/list-page";
import { RecordLink, RecordPage, useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Progress } from "@/components/ui/progress/progress";
import { toast } from "@/components/ui/toast/toast";
import { useTeam } from "../common";
import { Comparison } from "./compare";
import { decimal, kindLabels, missingText, pct, resultStatus, runStatus, triggerLabels } from "./labels";
import { hitTitles, rankText, whyText } from "./result-detail";
import { RESULT_PARAM, ResultRecord } from "./result-record";
import { type EvalResult, type EvalRun, type EvalSet, active, evalRunsKey, evalSetKey, useEvalRun } from "./queries";
import e from "./evaluations.module.css";
import { formatDate } from "@/lib/format";

const statusFacet: Facet<EvalResult>[] = [
  {
    // ?status=fail; ?result= is the open result's page.
    id: "status",
    label: "Result",
    type: "toggle",
    allLabel: "All",
    accessor: (r) => r.status,
    options: [
      { value: "fail", label: "Failures" },
      { value: "pass", label: "Passes" },
      { value: "missing", label: "Documents deleted" },
      { value: "error", label: "Check failed" },
    ],
  },
];

function facts(run: EvalRun) {
  const c = run.config;
  const s = run.summary;
  return [
    { label: "Check", value: `${kindLabels[run.kind]} · ${triggerLabels[run.trigger]}` },
    { label: "Tested", value: c.version ? (c.version === "published" && c.agentVersion ? `Published version ${c.agentVersion}` : "The draft") : undefined },
    // Names can hold parentheses themselves: "Help (Qwen3) · Qwen3 4B 768 (Spark) · 6 per search".
    { label: "Searched", value: c.kbs.map((k) => [k.name, k.profile, `${k.topK} per search`].filter(Boolean).join(" · ")).join("; ") || undefined },
    run.kind === "answer"
      ? { label: "Pass rate", value: `${pct(s.passRate)} (${s.passed} of ${s.passed + s.failed}); ${s.cited} cited an expected document, ${s.refused} refused` }
      : { label: `Recall@${s.k}`, value: `${pct(s.recall)} (${s.passed} of ${s.passed + s.failed}) · MRR ${decimal(s.mrr)}` },
    { label: "Supported claims", value: s.supportedShare !== undefined ? pct(s.supportedShare) : undefined },
    { label: "Not scored", value: [missingText(s.missing), s.errors ? `${s.errors} checks failed.` : ""].filter(Boolean).join(" ") || undefined },
  ].filter((f) => f.value !== undefined);
}

export function RunRecord({ set, runs }: { set: EvalSet; runs: EvalRun[] }) {
  const { slug, canEdit } = useTeam();
  const record = useRecordParam();
  const resultPage = useRecordParam(RESULT_PARAM);
  const qc = useQueryClient();
  const d = useEvalRun(slug, set.id, record.id);
  const run = d.data?.run;
  const cancel = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/teams/{team}/evaluation-sets/{setId}/runs/{runId}/cancel", { params: { path: { team: slug, setId: set.id, runId: record.id! } } })),
    onSuccess: () => toast.success("Run cancelled"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: evalRunsKey(slug, set.id) });
      void qc.invalidateQueries({ queryKey: evalSetKey(slug, set.id) });
    },
  });
  const answers = run?.kind === "answer";
  const columns: DataTableColumn<EvalResult>[] = [
    {
      id: "question",
      header: "Question",
      rowHeader: true,
      accessor: (r) => r.question,
      cell: (r) => <CellText primary={<RecordLink id={r.id} param={RESULT_PARAM}>{r.question}</RecordLink>} secondary={r.error || undefined} />,
    },
    { id: "status", header: "Result", accessor: (r) => r.status, cell: (r) => <StatusBadge tone={resultStatus[r.status].tone}>{resultStatus[r.status].label}</StatusBadge> },
    // Full answers have no rank; they say why they failed instead (the first failed score).
    answers
      ? { id: "why", header: "Why", accessor: (r) => whyText(r), cell: (r) => whyText(r) || "—" }
      : { id: "rank", header: "Rank", accessor: (r) => r.rank ?? 99, cell: (r) => (r.rank ? String(r.rank) : "—"), sortable: true },
    {
      id: "came",
      header: answers ? "Cited" : "What came back",
      accessor: (r) => hitTitles(r.hits),
      cell: (r) => <span className={e.oneLine} title={hitTitles(r.hits)}>{hitTitles(r.hits) || rankText(r)}</span>,
      muted: true,
    },
  ];
  return (
    <RecordPage
      open={Boolean(record.id)}
      onClose={record.close}
      title={run ? `${kindLabels[run.kind]}, ${formatDate(run.createdAt)}` : "Run"}
      label="Run"
      meta={run && <StatusBadge tone={runStatus[run.status].tone} pulse={active(run)}>{runStatus[run.status].label}</StatusBadge>}
      description="A run of this evaluation set."
      loading={d.isLoading}
      error={d.error}
      actions={
        run &&
        active(run) &&
        canEdit && (
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            <Ban aria-hidden /> Cancel run
          </Button>
        )
      }
      facts={run ? facts(run) : []}
      sections={[
        {
          title: "Progress",
          hidden: !run || !active(run),
          content: run && <Progress className={e.progress} label={`${run.done} of ${run.total} questions checked`} value={run.done} max={Math.max(run.total, 1)} />,
        },
        { title: "Why it stopped", hidden: !run?.error, content: <Alert tone="danger">{run?.error}</Alert> },
        {
          title: "Results",
          content: (
            <>
              <ApiErrorAlert error={cancel.error} />
              <ListPage<EvalResult>
                id="evaluation-results"
                caption="Results"
                columns={columns}
                data={d.data?.results ?? []}
                getRowId={(r) => r.id}
                rowLabel={(r) => r.question}
                facets={statusFacet}
                rowActions={(r) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => resultPage.open(r.id) }]}
                empty={{ title: run && active(run) ? "No results yet." : "No results." }}
              />
            </>
          ),
        },
        { title: "Compare", hidden: !run || active(run), content: run && <Comparison set={set} run={run} runs={runs} /> },
      ]}
    >
      {/* A result opens as a page over this one (its back link returns here). */}
      <ResultRecord run={run} results={d.data?.results ?? []} loading={d.isLoading} />
    </RecordPage>
  );
}
