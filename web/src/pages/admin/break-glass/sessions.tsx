/* Admin → Break-glass, Sessions: open sessions (pending approvals first) and every session. */
import { Eye, LockOpen } from "lucide-react";
import { type DataTableColumn } from "@/components/ui/data-table/data-table";
import { QueryView } from "@/components/query-view";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, TableActions, Td, Tr } from "@/components/ui/table/table";
import { type BreakGlassSession, personName, scopeWords, statusLabels, statusTone, timeLeft, useNow } from "@/lib/break-glass";
import { formatDate } from "@/lib/format";
import { useCurrentUser } from "@/session";
import s from "../../shared.module.css";
import { useAllSessions, useOpenSessions } from "./queries";

export function OpenSessionsCard({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useOpenSessions();
  const now = useNow();
  const me = useCurrentUser();
  const list = [...(q.data?.items ?? [])].sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending"));
  const pending = list.filter((x) => x.status === "pending").length;
  return (
    <Card title="Open sessions" description="Requests waiting for a second admin, and sessions that can read now.">
      <QueryView
        query={q}
        loadingLabel="Loading open sessions…"
        empty={list.length === 0 && <EmptyState size="compact" icon={<LockOpen />} title="No open break-glass sessions." />}
      >
        <Table caption={`Open break-glass sessions${pending ? `, ${pending} waiting for approval` : ""}`} columns={["Team", "Admin", "Scope", "Status", "Time", ""]}>
          {list.map((x) => (
            <Tr key={x.id}>
              <Td>
                <span className={s.primary}>{x.team.name}</span>
                <span className={s.secondary}>{x.reason}</span>
              </Td>
              <Td>
                {personName(x.requestedBy)}
                {x.requestedBy.id === me.user.id && <span className={s.secondary}>You</span>}
              </Td>
              <Td>{scopeWords(x.scopes)}</Td>
              <Td>
                <StatusBadge tone={statusTone[x.status]}>{statusLabels[x.status]}</StatusBadge>
              </Td>
              <Td>{x.status === "active" && x.expiresAt ? timeLeft(x.expiresAt, now) : `Lapses ${formatDate(x.approvalDeadline)}`}</Td>
              <Td>
                <TableActions>
                  <Button size="sm" variant="secondary" aria-label={`Open the session on ${x.team.name} by ${personName(x.requestedBy)}`} onClick={() => onOpen(x.id)}>
                    {x.status === "pending" && x.requestedBy.id !== me.user.id && me.capabilities.platformAdmin ? "Review" : "Open"}
                  </Button>
                </TableActions>
              </Td>
            </Tr>
          ))}
        </Table>
      </QueryView>
    </Card>
  );
}

const columns: DataTableColumn<BreakGlassSession>[] = [
  {
    id: "team",
    header: "Team",
    accessor: (x) => x.team.name,
    cell: (x) => (
      <>
        <span className={s.primary}>{x.team.name}</span>
        <span className={s.secondary}>{scopeWords(x.scopes)}</span>
      </>
    ),
  },
  { id: "admin", header: "Admin", accessor: (x) => personName(x.requestedBy) },
  { id: "status", header: "Status", accessor: (x) => statusLabels[x.status], cell: (x) => <StatusBadge tone={statusTone[x.status]}>{statusLabels[x.status]}</StatusBadge> },
  timeColumn("requested", "Requested", (x) => x.requestedAt),
  { id: "reason", header: "Reason", accessor: (x) => x.reason, defaultHidden: true },
];

export function AllSessionsList({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useAllSessions();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Card title="All sessions" description="Every session and request, newest first. Open one to see what it read.">
      <ListPage<BreakGlassSession>
        id="admin-break-glass"
        caption="Break-glass sessions"
        columns={columns}
        data={items}
        getRowId={(x) => x.id}
        rowLabel={(x) => `${x.team.name}, ${personName(x.requestedBy)}`}
        rowActions={(x) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => onOpen(x.id) }]}
        onRowClick={(x) => onOpen(x.id)}
        manual
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={{ icon: <LockOpen />, title: "No break-glass sessions yet." }}
        tableProps={{ loadMore: { hasMore: Boolean(q.hasNextPage), loading: q.isFetchingNextPage, onLoadMore: () => void q.fetchNextPage() } }}
      />
    </Card>
  );
}
