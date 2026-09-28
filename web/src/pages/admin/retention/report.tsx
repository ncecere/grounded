/*
 * Retention → Dry run: what a run would delete now, per data kind, and what
 * legal holds keep. Counts only, computed without writing anything. A kind
 * opens a sheet with its breakdown per team, level, audience and reason.
 */
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage } from "@/components/templates/list-page";
import { RecordSheet, useRecordParam } from "@/components/templates/record-sheet";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { formatDate } from "@/lib/format";
import s from "../../shared.module.css";
import { audienceText, kindLabels, periodText, reasonLabels, type Kind } from "./labels";
import r from "./retention.module.css";
import { retentionKey } from "./settings";

type KindReport = Schemas["RetentionKindReport"];
type Settings = Schemas["RetentionSettings"];

export const reportKey = [...retentionKey, "report"];
const n = (v: number) => v.toLocaleString();

/** The period shown for a kind: per level, at expiry, or its setting. */
function periodOf(kind: Kind, settings?: Settings) {
  if (kind === "conversations") return "Per classification level";
  if (kind === "anonymous_sessions") return "When they expire";
  const p = settings?.periods.find((x) => x.kind === kind);
  return p ? periodText(p.days) : "—";
}

export function useRetentionReport() {
  return useQuery({ queryKey: reportKey, queryFn: async () => unwrap(await api.GET("/v1/admin/retention/report")) });
}

export function RetentionReportTab({ settings }: { settings?: Settings }) {
  const report = useRetentionReport();
  const record = useRecordParam();
  const open = report.data?.kinds.find((k) => k.kind === record.id);
  const columns: DataTableColumn<KindReport>[] = [
    {
      id: "kind",
      header: "Data",
      accessor: (k) => kindLabels[k.kind].label,
      rowHeader: true,
      hideable: false,
      cell: (k) => <CellText primary={kindLabels[k.kind].label} secondary={periodOf(k.kind, settings)} />,
    },
    {
      id: "due",
      header: "Would be deleted now",
      accessor: (k) => k.due,
      numeric: true,
      cell: (k) => (k.kept ? <span className={s.muted}>Kept (no period)</span> : n(k.due)),
    },
    {
      id: "held",
      header: "Kept by legal holds",
      accessor: (k) => k.held,
      numeric: true,
      cell: (k) => (k.held > 0 ? <Badge tone="warning">{n(k.held)}</Badge> : <span className={s.muted}>0</span>),
    },
  ];
  return (
    <>
      <ListPage<KindReport>
        id="admin-retention-report"
        caption="What retention would delete now"
        columns={columns}
        data={report.data?.kinds ?? []}
        getRowId={(k) => k.kind}
        rowLabel={(k) => kindLabels[k.kind].label}
        loading={report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        onRowClick={(k) => record.open(k.kind)}
        rowActions={(k) => [{ label: "View breakdown", onSelect: () => record.open(k.kind) }]}
        tableProps={{
          toolbar: (
            <div className={r.toolbar}>
              <span className={s.muted}>{report.data ? `As of ${formatDate(report.data.generatedAt)}. Nothing is deleted by viewing this.` : "Counting…"}</span>
              <Button variant="secondary" size="sm" loading={report.isFetching} onClick={() => void report.refetch()}>
                <RefreshCw aria-hidden /> Refresh
              </Button>
            </div>
          ),
        }}
      />
      <RecordSheet
        open={Boolean(record.id)}
        onClose={record.close}
        title={open ? kindLabels[open.kind].label : "Retention"}
        description={open ? kindLabels[open.kind].description : "What retention would delete now."}
        loading={report.isLoading}
        facts={
          open && [
            { label: "Period", value: periodOf(open.kind, settings) },
            { label: "Would be deleted now", value: open.kept ? "Nothing: kept until a period is set" : n(open.due) },
            { label: "Kept by legal holds", value: n(open.held) },
          ]
        }
        sections={open && !open.kept ? [{ title: "Breakdown", content: <Groups report={open} /> }] : []}
      />
    </>
  );
}

function Groups({ report }: { report: KindReport }) {
  if (report.groups.length === 0) return <EmptyState size="compact" icon={<ShieldCheck />} title="Nothing is past its period." />;
  return (
    <Table caption="Breakdown by team, level and audience" columns={["Team", "Level", "Audience", "Why", { label: "Due", numeric: true }, { label: "Held", numeric: true }]}>
      {report.groups.map((g, i) => (
        <Tr key={i}>
          <Td>{g.teamId ? g.teamName || "Deleted team" : <span className={s.muted}>Platform</span>}</Td>
          <Td muted>{g.level?.name ?? "—"}</Td>
          <Td muted>{g.audience ? audienceText(g.audience) : "—"}</Td>
          <Td muted>{reasonLabels[g.reason]}</Td>
          <Td numeric>{n(g.due)}</Td>
          <Td numeric>{n(g.held)}</Td>
        </Tr>
      ))}
    </Table>
  );
}
