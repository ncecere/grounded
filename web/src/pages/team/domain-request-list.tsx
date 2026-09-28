/*
 * The team's domain requests as a ListPage (status facet and search in the
 * URL) with each request in a RecordSheet (?record=<id>): the reference use
 * of both templates (D4, D5).
 */
import { Eye, Globe, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ListPage, RelativeTime, timeColumn } from "../../components/templates/list-page";
import { RecordSheet, useRecordParam } from "../../components/templates/record-sheet";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import s from "../shared.module.css";
import { type DomainRequest, DomainStatusBadge, domainStatusLabels } from "./domains";

type Props = {
  list: DomainRequest[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  /** "Request a domain", when the viewer may. */
  requestAction?: () => void;
};

const person = (p: DomainRequest["requester"]) => (p ? p.displayName || p.email : "Deleted user");

const columns: DataTableColumn<DomainRequest>[] = [
  { id: "pattern", header: "Host pattern", accessor: "pattern", sortable: true, rowHeader: true, cell: (r) => <code className={`${s.mono} ${s.primary}`}>{r.pattern}</code> },
  { id: "status", header: "Status", accessor: (r) => domainStatusLabels[r.status], sortable: true, cell: (r) => <DomainStatusBadge status={r.status} /> },
  { id: "requester", header: "Requested by", accessor: (r) => person(r.requester), sortable: true, cell: (r) => <CellText primary={person(r.requester)} secondary={r.requester?.email} /> },
  timeColumn("createdAt", "Requested", (r) => r.createdAt),
  { id: "reason", header: "Reason", accessor: "reason", muted: true, defaultHidden: true },
];

// Built on use: domains.tsx and this file import each other.
const statusFacets = (): Facet<DomainRequest>[] => [
  {
    id: "status",
    label: "Status",
    type: "toggle",
    allLabel: "All",
    accessor: (r) => r.status,
    options: (Object.keys(domainStatusLabels) as DomainRequest["status"][]).map((v) => ({ value: v, label: domainStatusLabels[v] })),
  },
];

export function DomainRequestList({ list, loading, error, onRetry, requestAction }: Props) {
  const record = useRecordParam();
  const open = list.find((r) => r.id === record.id);
  return (
    <>
      <ListPage<DomainRequest>
        id="team-domain-requests"
        caption="Domain requests"
        columns={columns}
        data={list}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.pattern}
        facets={statusFacets()}
        search={{ label: "Search domain requests", placeholder: "Host or reason" }}
        onRowClick={(r) => record.open(r.id)}
        rowActions={(r) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(r.id) }]}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={{
          icon: <Globe />,
          title: "No domain requests yet.",
          description: "Hosts on the platform allowlist need no request.",
          action: requestAction && (
            <Button variant="secondary" onClick={requestAction}>
              <Plus aria-hidden /> Request a domain
            </Button>
          ),
        }}
      />
      <RecordSheet
        open={Boolean(record.id)}
        onClose={record.close}
        title={open?.pattern ?? "Domain request"}
        description="A request to crawl a host outside the platform allowlist."
        loading={loading && !open}
        facts={open ? requestFacts(open) : []}
        sections={open?.reason ? [{ title: "Reason", content: <p className={s.settingDescription}>{open.reason}</p> }] : []}
      />
    </>
  );
}

function requestFacts(r: DomainRequest): { label: string; value: ReactNode }[] {
  return [
    { label: "Status", value: <DomainStatusBadge status={r.status} /> },
    { label: "Requested by", value: person(r.requester) },
    { label: "Requested", value: <RelativeTime value={r.createdAt} /> },
    { label: "Reviewed by", value: r.reviewedAt ? person(r.reviewer) : "Not reviewed yet" },
    { label: "Reviewed", value: r.reviewedAt ? <RelativeTime value={r.reviewedAt} /> : undefined },
    { label: "Review note", value: r.reviewNote || undefined },
  ];
}
