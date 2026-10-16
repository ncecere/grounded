/* Admin → Teams › Requests (v0.6.0, E3): the review queue, pending first. Platform admins approve (which creates the team) or decline with a reason; auditors read. */
import { useQuery } from "@tanstack/react-query";
import { Check, Eye, Inbox, X } from "lucide-react";
import { useState } from "react";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Stack } from "@/components/ui/layout/layout";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { type AdminTeamRequest, RequestStatusBadge, adminTeamRequestsQuery, statusLabels } from "../../team-requests/common";
import { useIsPlatformAdmin } from "../hooks";
import { ApproveDialog, DeclineDialog, ViewRequestDialog } from "./request-dialogs";

const facets: Facet<AdminTeamRequest>[] = [
  {
    id: "status",
    label: "Status",
    type: "toggle",
    allLabel: "All",
    options: (["pending", "approved", "declined", "withdrawn"] as const).map((v) => ({ value: v, label: statusLabels[v] })),
  },
];

function columns(levels: ReturnType<typeof useClassificationLevels>["data"]): DataTableColumn<AdminTeamRequest>[] {
  return [
    {
      id: "name",
      header: "Request",
      accessor: "name",
      sortable: true,
      rowHeader: true,
      hideable: false,
      cell: (r) => <CellText primary={r.name} secondary={`${r.requesterName} · ${r.requesterEmail}`} />,
    },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <RequestStatusBadge status={r.status} /> },
    { id: "classification", header: "Classification", accessor: "classification", cell: (r) => <ClassificationBadge levels={levels} value={r.classification} /> },
    { id: "owner", header: "Owner", accessor: (r) => r.ownerEmail, muted: true, defaultHidden: true, cell: (r) => r.ownerEmail || "The requester" },
    { id: "purpose", header: "Purpose", accessor: "purpose", muted: true, cell: (r) => <span title={r.purpose}>{r.purpose.length > 90 ? `${r.purpose.slice(0, 90)}…` : r.purpose}</span> },
    { id: "requested", header: "Requested", accessor: "createdAt", sortable: true, muted: true, cell: (r) => <RelativeTime value={r.createdAt} /> },
  ];
}

export function TeamRequestsTab() {
  const isAdmin = useIsPlatformAdmin();
  const levels = useClassificationLevels();
  const queue = useQuery(adminTeamRequestsQuery());
  const [viewing, setViewing] = useState<AdminTeamRequest | null>(null);
  const [approving, setApproving] = useState<AdminTeamRequest | null>(null);
  const [declining, setDeclining] = useState<AdminTeamRequest | null>(null);
  return (
    <Stack gap={4}>
      {!isAdmin && <Alert tone="info">Auditors can view team requests. Only platform admins can approve or decline them.</Alert>}
      <ListPage<AdminTeamRequest>
        id="admin-team-requests"
        caption="Team requests"
        columns={columns(levels.data)}
        data={queue.data ?? []}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.name}
        facets={facets}
        search={{ label: "Search requests", placeholder: "Name, person or purpose" }}
        loading={queue.isLoading}
        error={queue.error}
        onRetry={() => void queue.refetch()}
        onRowClick={(r) => setViewing(r)}
        rowActions={(r) => [
          { label: "Approve…", icon: <Check aria-hidden />, hidden: !isAdmin || r.status !== "pending", onSelect: () => setApproving(r) },
          { label: "Decline…", icon: <X aria-hidden />, danger: true, hidden: !isAdmin || r.status !== "pending", onSelect: () => setDeclining(r) },
          { label: "View…", icon: <Eye aria-hidden />, onSelect: () => setViewing(r) },
        ]}
        empty={{ icon: <Inbox />, title: "No team requests.", description: "When people ask for a team, their requests wait here for review." }}
      />
      {viewing && <ViewRequestDialog request={viewing} onClose={() => setViewing(null)} />}
      {approving && <ApproveDialog request={approving} onClose={() => setApproving(null)} />}
      {declining && <DeclineDialog request={declining} onClose={() => setDeclining(null)} />}
    </Stack>
  );
}
