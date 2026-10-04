/*
 * Retention → Runs: the latest runs (every 10 minutes, or "Run now"), with
 * counts per data kind. "Run now" asks for confirmation, with what the dry
 * run shows as due, and is audited. The list refreshes while a run waits.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Play } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import { formatDate } from "@/lib/format";
import s from "../../shared.module.css";
import { kindLabels } from "./labels";
import { reportKey, useRetentionReport } from "./report";
import r from "./retention.module.css";
import { retentionKey } from "./settings";

type Run = Schemas["RetentionRun"];

const runsKey = [...retentionKey, "runs"];
const n = (v: number) => v.toLocaleString();
const total = (run: Run, f: "deleted" | "held") => run.results.reduce((sum, x) => sum + x[f], 0);
const waiting = (run: Run) => run.status === "queued" || run.status === "running";

const statusTone = { queued: "neutral", running: "info", ok: "success", error: "danger" } as const;
const statusText = { queued: "Queued", running: "Running", ok: "Done", error: "Failed" } as const;

function RunStatus({ run }: { run: Run }) {
  return <StatusBadge tone={statusTone[run.status]}>{statusText[run.status]}</StatusBadge>;
}

const who = (run: Run) => (run.trigger === "schedule" ? "Scheduled" : `Run now${run.requestedBy ? ` by ${run.requestedBy.displayName || run.requestedBy.email}` : ""}`);

const columns: DataTableColumn<Run>[] = [
  { ...timeColumn<Run>("createdAt", "Started", (x) => x.startedAt ?? x.createdAt), hideable: false },
  { id: "trigger", header: "Trigger", accessor: who, cell: (x) => <CellText primary={who(x)} secondary={x.kinds.length ? x.kinds.map((k) => kindLabels[k].label).join(", ") : undefined} /> },
  { id: "status", header: "Status", accessor: "status", cell: (x) => <RunStatus run={x} /> },
  { id: "deleted", header: "Deleted", accessor: (x) => total(x, "deleted"), numeric: true, cell: (x) => n(total(x, "deleted")) },
  { id: "held", header: "Kept by holds", accessor: (x) => total(x, "held"), numeric: true, cell: (x) => n(total(x, "held")) },
];

export function RetentionRunsTab({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const record = useRecordParam();
  const [confirming, setConfirming] = useState(false);
  const runs = useQuery({
    queryKey: runsKey,
    queryFn: async () => unwrap(await api.GET("/v1/admin/retention/runs", { params: { query: { limit: 50 } } })),
    refetchInterval: (q) => (q.state.data?.some(waiting) ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/retention/runs", { body: {} })),
    onSuccess: (run) => {
      setConfirming(false);
      qc.setQueryData<Run[]>(runsKey, (cur) => [run, ...(cur ?? [])]);
      void qc.invalidateQueries({ queryKey: runsKey });
      void qc.invalidateQueries({ queryKey: reportKey });
      toast.success("Retention run queued", "It starts after any run in progress.");
    },
  });
  const open = runs.data?.find((x) => String(x.id) === record.id);
  return (
    <>
      <ListPage<Run>
        id="admin-retention-runs"
        caption="Retention runs"
        columns={columns}
        data={runs.data ?? []}
        getRowId={(x) => String(x.id)}
        rowLabel={(x) => `Run ${formatDate(x.createdAt)}`}
        loading={runs.isLoading}
        error={runs.error}
        onRetry={() => void runs.refetch()}
        onRowClick={(x) => record.open(String(x.id))}
        empty={{ icon: <History />, title: "No runs yet.", description: "Retention runs every 10 minutes on a worker." }}
        tableProps={{
          toolbar: (
            <div className={r.toolbar}>
              <span className={s.muted}>Runs every 10 minutes. Counts only: nothing that was deleted is shown.</span>
              {isAdmin && (
                <Button size="sm" onClick={() => setConfirming(true)}>
                  <Play aria-hidden /> Run now
                </Button>
              )}
            </div>
          ),
        }}
      />
      <RecordPage
        open={Boolean(record.id)}
        onClose={record.close}
        title={open ? `Run of ${formatDate(open.createdAt)}` : "Retention run"}
        description="What one retention run deleted and what legal holds kept, per kind of data."
        loading={runs.isLoading}
        error={!runs.isLoading && record.id && !open ? new Error("This run isn't one of the latest runs, or the link is wrong.") : undefined}
        facts={
          open && [
            { label: "Status", value: <RunStatus run={open} /> },
            { label: "Trigger", value: who(open) },
            { label: "Started", value: formatDate(open.startedAt) },
            { label: "Finished", value: formatDate(open.finishedAt) },
            { label: "Error", value: open.error || "" },
          ]
        }
        sections={open ? [{ title: "Per kind of data", content: <Results run={open} /> }] : []}
      />
      {confirming && <RunNowDialog busy={start.isPending} error={start.error} onConfirm={() => start.mutate()} onClose={() => (setConfirming(false), start.reset())} />}
    </>
  );
}

function Results({ run }: { run: Run }) {
  if (run.results.length === 0) return <p className={s.muted}>{waiting(run) ? "Not finished yet." : "No results."}</p>;
  return (
    <Table caption="Results per kind of data" columns={["Data", { label: "Deleted", numeric: true }, { label: "Kept by holds", numeric: true }, "Note"]}>
      {run.results.map((x) => (
        <Tr key={x.kind}>
          <Td>{kindLabels[x.kind].label}</Td>
          <Td numeric>{n(x.deleted)}</Td>
          <Td numeric>{n(x.held)}</Td>
          <Td muted>{x.error ? <span className={s.dangerText}>{x.error}</span> : x.kept ? "No period: kept" : ""}</Td>
        </Tr>
      ))}
    </Table>
  );
}

function RunNowDialog({ busy, error, onConfirm, onClose }: { busy: boolean; error: unknown; onConfirm: () => void; onClose: () => void }) {
  const report = useRetentionReport();
  const due = (report.data?.kinds ?? []).filter((k) => k.due > 0);
  return (
    <AlertDialog
      open
      onOpenChange={(o) => !o && onClose()}
      tone="danger"
      title="Run retention now?"
      description="This permanently deletes everything past its period now, instead of at the next scheduled run. Legal holds still apply."
      confirmLabel="Run now"
      busy={busy}
      error={error}
      onConfirm={onConfirm}
    >
      {report.isLoading ? (
        <p className={s.settingDescription}>Counting what's due…</p>
      ) : due.length === 0 ? (
        <p className={s.settingDescription}>The dry run shows nothing due right now.</p>
      ) : (
        <ul className={r.list} aria-label="Due now">
          {due.map((k) => (
            <li key={k.kind}>
              {kindLabels[k.kind].label}: {n(k.due)}
            </li>
          ))}
        </ul>
      )}
    </AlertDialog>
  );
}
