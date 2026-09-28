/*
 * Domain requests as a ListPage (status facet and search in the URL) with
 * each request in a RecordPage (?record=<id>): the reference use of both
 * templates (D4, D5). A team's own requests, or every team's for platform
 * staff (`admin`: a Team column, and Approve / Deny / Revoke for admins).
 */
import { Link } from "@tanstack/react-router";
import { Check, Eye, Globe, Plus, Undo2, X } from "lucide-react";
import type { ReactNode } from "react";
import { ListPage, RelativeTime, timeColumn } from "../../components/templates/list-page";
import { RecordPage, useRecordParam } from "../../components/templates/record-page";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import type { ActionItem } from "../../components/templates/action-menu";
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
  /** Platform staff: every team's requests; `onReview` for admins (auditors get none). */
  admin?: { onReview?: (r: DomainRequest, decision: Decision) => void };
};

export type Decision = "approve" | "deny" | "revoke";

const person = (p: DomainRequest["requester"]) => (p ? p.displayName || p.email : "Deleted user");

const columns: DataTableColumn<DomainRequest>[] = [
  { id: "pattern", header: "Host pattern", accessor: "pattern", sortable: true, rowHeader: true, cell: (r) => <code className={`${s.mono} ${s.primary}`}>{r.pattern}</code> },
  { id: "status", header: "Status", accessor: (r) => domainStatusLabels[r.status], sortable: true, cell: (r) => <DomainStatusBadge status={r.status} /> },
  { id: "requester", header: "Requested by", accessor: (r) => person(r.requester), sortable: true, cell: (r) => <CellText primary={person(r.requester)} secondary={r.requester?.email} /> },
  timeColumn("createdAt", "Requested", (r) => r.createdAt),
  { id: "reason", header: "Reason", accessor: "reason", muted: true, defaultHidden: true },
];

const teamColumn: DataTableColumn<DomainRequest> = {
  id: "team",
  header: "Team",
  accessor: "teamName",
  sortable: true,
  cell: (r) => <TextLink render={<Link to="/admin/teams/$team" params={{ team: r.teamSlug }} />}>{r.teamName}</TextLink>,
};

/** The review actions a request offers: Approve and Deny while pending, Revoke once approved. */
function reviewActions(r: DomainRequest, onReview?: (r: DomainRequest, d: Decision) => void): ActionItem[] {
  if (!onReview) return [];
  if (r.status === "pending")
    return [
      { label: "Approve…", icon: <Check aria-hidden />, onSelect: () => onReview(r, "approve") },
      { label: "Deny…", icon: <X aria-hidden />, danger: true, onSelect: () => onReview(r, "deny") },
    ];
  if (r.status === "approved") return [{ label: "Revoke…", icon: <Undo2 aria-hidden />, danger: true, onSelect: () => onReview(r, "revoke") }];
  return [];
}

// Pending first, then newest first.
const byStatus = (a: DomainRequest, b: DomainRequest) =>
  Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.localeCompare(a.createdAt);

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

export function DomainRequestList({ list, loading, error, onRetry, requestAction, admin }: Props) {
  const record = useRecordParam();
  const open = list.find((r) => r.id === record.id);
  const onReview = admin?.onReview;
  const review = open ? reviewActions(open, onReview) : [];
  return (
    <>
      <ListPage<DomainRequest>
        id={admin ? "admin-domain-requests" : "team-domain-requests"}
        caption="Domain requests"
        columns={admin ? [teamColumn, ...columns] : columns}
        data={[...list].sort(byStatus)}
        getRowId={(r) => r.id}
        rowLabel={(r) => (admin ? `${r.pattern} for ${r.teamName}` : r.pattern)}
        facets={statusFacets()}
        search={{ label: "Search domain requests", placeholder: admin ? "Host, team or reason" : "Host or reason" }}
        onRowClick={(r) => record.open(r.id)}
        rowActions={(r) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(r.id) }, ...reviewActions(r, onReview)]}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={{
          icon: <Globe />,
          title: "No domain requests yet.",
          description: admin ? "Teams request hosts that aren't on the allowlist; they appear here for review." : "Hosts on the platform allowlist need no request.",
          action: requestAction && (
            <Button variant="secondary" onClick={requestAction}>
              <Plus aria-hidden /> Request a domain
            </Button>
          ),
        }}
      />
      <RecordPage
        open={Boolean(record.id)}
        onClose={record.close}
        title={open?.pattern ?? "Domain request"}
        description={open && admin ? `A request by ${open.teamName} to crawl a host outside the platform allowlist.` : "A request to crawl a host outside the platform allowlist."}
        loading={loading && !open}
        error={!loading && record.id && !open ? new Error("This request doesn't exist, or the link is wrong.") : undefined}
        facts={open ? requestFacts(open, Boolean(admin)) : []}
        sections={open?.reason ? [{ title: "Reason", content: <p className={s.settingDescription}>{open.reason}</p> }] : []}
        actions={
          review.length > 0 && (
            <>
              {/* Destructive first, the main action last. */}
              {[...review].reverse().map((a) => (
                <Button key={a.label} variant={a.danger ? "danger" : "primary"} onClick={a.onSelect}>
                  {a.icon} {a.label}
                </Button>
              ))}
            </>
          )
        }
      />
    </>
  );
}

function requestFacts(r: DomainRequest, admin: boolean): { label: string; value: ReactNode }[] {
  return [
    ...(admin ? [{ label: "Team", value: r.teamName }] : []),
    { label: "Status", value: <DomainStatusBadge status={r.status} /> },
    { label: "Requested by", value: <CellText primary={person(r.requester)} secondary={r.requester?.email} /> },
    { label: "Requested", value: <RelativeTime value={r.createdAt} /> },
    {
      label: "Reviewed",
      value: r.reviewedAt ? (
        <>
          {person(r.reviewer)}, <RelativeTime value={r.reviewedAt} />
        </>
      ) : (
        "Not reviewed yet"
      ),
    },
    { label: "Review note", value: r.reviewNote || undefined },
  ];
}
