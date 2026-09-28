/*
 * Team settings › Audit log (D4, D5, Q13): the team's audit log on a
 * ListPage, filtered on the server by action group, person and a date range
 * (all in the URL), with Load more. One line per cell: the action's label
 * (its code is in the sheet). Each entry opens in a RecordSheet
 * (?record=<id>, fetched by id so links from the overview work) with the
 * before/after in a diff viewer. Sign-ins aren't team entries, so there is
 * no "Hide sign-ins" here.
 */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Eye, FileClock } from "lucide-react";
import { api, unwrap, type Schemas } from "../../../api/client";
import { auditKey } from "../../../components/audit/audit-log";
import { actionGroups, actionLabel, actorName } from "../../../components/audit/labels";
import { AuditTarget } from "../../../components/audit/target";
import { DateRangeFilter, useDateRangeParam } from "../../../components/templates/date-range-filter";
import { ListPage, RelativeTime, useListFilters } from "../../../components/templates/list-page";
import { RecordSheet, useRecordParam } from "../../../components/templates/record-sheet";
import { membersKey } from "../../../components/members";
import { terms } from "../../../lib/terms";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { DiffViewer } from "@/components/ui/diff-viewer/diff-viewer";
import type { Facet, FilterValue } from "@/components/ui/filter-bar/filter-bar";
import { Time } from "@/components/ui/time/time";
import s from "../../shared.module.css";
import { useTeam } from "../common";

type Entry = Schemas["AuditEntry"];

function who(e: Entry) {
  const { actor } = e;
  if (actor.kind === "api_key") return `API key${actor.apiKeyName ? `: ${actor.apiKeyName}` : ""}`;
  return actor.kind === "user" && actor.displayName ? actor.email : undefined;
}

/** A select facet's value (one option). */
const first = (v: FilterValue | undefined) => (Array.isArray(v) ? v[0] : undefined);

function useFacets(team: string): Facet<Entry>[] {
  const members = useQuery({
    queryKey: membersKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team } } })),
  });
  return [
    {
      id: "action",
      label: "Action",
      type: "select",
      placeholder: "All actions",
      options: actionGroups.filter((g) => !g.platform).map((g) => ({ value: g.prefix, label: g.label })),
    },
    {
      id: "person",
      label: "Person",
      type: "select",
      placeholder: "Anyone",
      options: (members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.displayName || m.user.email })),
    },
  ];
}

export function TeamAuditLog() {
  const { slug: team } = useTeam();
  const scope = { kind: "team" as const, team };
  const facets = useFacets(team);
  const filters = useListFilters(facets);
  const range = useDateRangeParam();
  const record = useRecordParam();
  const query = {
    action: first(filters.values.action),
    actorUserId: first(filters.values.person),
    from: range.from?.toISOString(),
    to: range.toExclusive?.toISOString(),
  };
  const log = useInfiniteQuery({
    queryKey: [...auditKey(scope), "list", query],
    queryFn: async ({ pageParam }) => unwrap(await api.GET("/v1/teams/{team}/audit", { params: { path: { team }, query: { ...query, cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.values(query).some(Boolean);

  const columns: DataTableColumn<Entry>[] = [
    { id: "when", header: "When", accessor: (e) => new Date(e.occurredAt), cell: (e) => <RelativeTime value={e.occurredAt} /> },
    { id: "who", header: "Who", accessor: (e) => actorName(e.actor), cell: (e) => <CellText primary={actorName(e.actor)} secondary={who(e)} /> },
    { id: "action", header: "Action", accessor: (e) => actionLabel(e.action), rowHeader: true, cell: (e) => <span className={s.primary}>{actionLabel(e.action)}</span> },
    { id: "target", header: "Target", accessor: (e) => e.targetLabel ?? e.targetType, cell: (e) => <AuditTarget entry={e} scope={scope} /> },
  ];

  return (
    <>
      <ListPage<Entry>
        id="team-audit"
        caption={terms.auditLog}
        columns={columns}
        data={items}
        getRowId={(e) => String(e.id)}
        rowLabel={(e) => `${actionLabel(e.action)}, ${new Date(e.occurredAt).toLocaleString()}`}
        facets={facets}
        manual
        onRowClick={(e) => record.open(String(e.id))}
        rowActions={(e) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(String(e.id)) }]}
        loading={log.isLoading}
        error={log.error}
        onRetry={() => void log.refetch()}
        empty={{ icon: <FileClock />, title: filtered ? "No entries match these filters." : "No audit entries yet." }}
        tableProps={{
          toolbar: <DateRangeFilter range={range} label="When" />,
          loadMore: { hasMore: Boolean(log.hasNextPage), loading: log.isFetchingNextPage, onLoadMore: () => void log.fetchNextPage() },
        }}
      />
      <AuditEntrySheet id={record.id} loaded={items.find((e) => String(e.id) === record.id)} onClose={record.close} />
    </>
  );
}

function AuditEntrySheet({ id, loaded, onClose }: { id?: string; loaded?: Entry; onClose: () => void }) {
  const { slug: team } = useTeam();
  const entry = useQuery({
    queryKey: [...auditKey({ kind: "team", team }), "entry", id],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/audit/{entryId}", { params: { path: { team, entryId: Number(id) } } })),
    enabled: Boolean(id) && !loaded,
    initialData: loaded,
  });
  const e = entry.data;
  const changed = e && (e.before != null || e.after != null);
  const metadata = e && Object.keys(e.metadata).length > 0;
  return (
    <RecordSheet
      open={Boolean(id)}
      onClose={onClose}
      title={e ? actionLabel(e.action) : "Audit entry"}
      description="An entry of this team's audit log."
      loading={entry.isLoading}
      error={entry.error}
      facts={
        e
          ? [
              { label: "When", value: <Time value={e.occurredAt} format="datetime" /> },
              { label: "Who", value: [actorName(e.actor), who(e)].filter(Boolean).join(" · ") },
              { label: "Action", value: <code className={s.mono}>{e.action}</code> },
              { label: "Target", value: <AuditTarget entry={e} scope={{ kind: "team", team }} /> },
              { label: "Request", value: e.requestId ? <code className={s.mono}>{e.requestId}</code> : undefined },
            ]
          : []
      }
      sections={[
        ...(changed ? [{ title: "Changes", content: <DiffViewer label={`Changes: ${actionLabel(e.action)}`} before={e.before ?? null} after={e.after ?? null} format="json" /> }] : []),
        ...(metadata ? [{ title: "Details", content: <pre className={s.pre}>{JSON.stringify(e.metadata, null, 2)}</pre> }] : []),
      ]}
    />
  );
}
