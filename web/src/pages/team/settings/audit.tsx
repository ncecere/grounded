/*
 * Team settings › Audit log (D4, D5, Q13): the team's audit log on a
 * ListPage, filtered on the server by area or action, person (or "System
 * (group mapping)") and a date range (all in the URL), with Load more. The
 * action's label, with a simple change under it ("Monthly budget $5.00 →
 * none"); its code is on the record page. Each entry opens in a RecordPage
 * (?record=<id>, fetched by id so links from the overview work) with the
 * before/after field by field. Sign-ins aren't team entries, so there is
 * no "Hide sign-ins" here. Editors' log has no cost entries (budgets and
 * extensions; the API leaves them out), so their Area filter has no Costs.
 */
import { auditSections } from "../../admin/logs/audit-record";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Eye, FileClock } from "lucide-react";
import { api, unwrap, type Schemas } from "../../../api/client";
import { auditKey } from "../../../components/audit/audit-log";
import { changeSummary } from "../../../components/audit/changes";
import { actionLabel, actorName, areaOptions, groupMappingPersonOption, personFilter, viaLabel } from "../../../components/audit/labels";
import { AuditTarget } from "../../../components/audit/target";
import { rangeWindow } from "../../admin/logs/common";
import { ListPage, RelativeTime, useListFilters } from "../../../components/templates/list-page";
import { RecordPage, useRecordParam } from "../../../components/templates/record-page";
import { membersKey } from "../../../components/members";
import { terms } from "../../../lib/terms";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
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

function useFacets(team: string, hideCosts: boolean): Facet<Entry>[] {
  const members = useQuery({
    queryKey: membersKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team } } })),
  });
  return [
    {
      id: "action",
      label: "Area",
      type: "select",
      placeholder: "All areas, or type an action",
      options: areaOptions(false, { hideCosts }),
    },
    {
      id: "person",
      label: "Person",
      type: "select",
      placeholder: "Anyone",
      options: [groupMappingPersonOption, ...(members.data ?? []).map((m) => ({ value: m.user.id, label: m.user.displayName || m.user.email }))],
    },
    { id: "range", label: "Date", type: "date-range" },
  ];
}

export function TeamAuditLog() {
  const { slug: team, role } = useTeam();
  const scope = { kind: "team" as const, team };
  // Editors don't see the team's spend, so their log has no cost entries (docs/costs.md §5).
  const facets = useFacets(team, role === "editor");
  const filters = useListFilters(facets);
  const record = useRecordParam();
  const query = {
    action: first(filters.values.action),
    ...personFilter(first(filters.values.person)),
    ...rangeWindow(filters.values),
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
    { id: "who", header: "Who", accessor: (e) => actorName(e.actor, e), cell: (e) => <CellText primary={actorName(e.actor, e)} secondary={who(e)} /> },
    {
      id: "action",
      header: "Action",
      accessor: (e) => actionLabel(e.action, e),
      rowHeader: true,
      cell: (e) => <CellText primary={actionLabel(e.action, e)} secondary={changeSummary(e) ?? undefined} />,
    },
    { id: "target", header: "Target", accessor: (e) => e.targetLabel ?? e.targetType, cell: (e) => <AuditTarget entry={e} scope={{ ...scope, member: Boolean(role) }} /> },
  ];

  return (
    <>
      <ListPage<Entry>
        id="team-audit"
        caption={terms.auditLog}
        columns={columns}
        data={items}
        getRowId={(e) => String(e.id)}
        rowLabel={(e) => `${actionLabel(e.action, e)}, ${new Date(e.occurredAt).toLocaleString()}`}
        facets={facets}
        manual
        onRowClick={(e) => record.open(String(e.id))}
        rowActions={(e) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(String(e.id)) }]}
        loading={log.isLoading}
        error={log.error}
        onRetry={() => void log.refetch()}
        empty={{ icon: <FileClock />, title: filtered ? "No entries match these filters." : "No audit entries yet." }}
        tableProps={{
          loadMore: { hasMore: Boolean(log.hasNextPage), loading: log.isFetchingNextPage, onLoadMore: () => void log.fetchNextPage() },
        }}
      />
      <AuditEntryPage id={record.id} loaded={items.find((e) => String(e.id) === record.id)} onClose={record.close} />
    </>
  );
}

function AuditEntryPage({ id, loaded, onClose }: { id?: string; loaded?: Entry; onClose: () => void }) {
  const { slug: team, role } = useTeam();
  const entry = useQuery({
    queryKey: [...auditKey({ kind: "team", team }), "entry", id],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/audit/{entryId}", { params: { path: { team, entryId: Number(id) } } })),
    enabled: Boolean(id) && !loaded,
    initialData: loaded,
  });
  const e = entry.data;
  return (
    <RecordPage
      open={Boolean(id)}
      onClose={onClose}
      title={e ? actionLabel(e.action, e) : "Audit entry"}
      description="An entry of this team's audit log."
      loading={entry.isLoading}
      error={entry.error}
      facts={
        e
          ? [
              { label: "When", value: <Time value={e.occurredAt} format="datetime" /> },
              { label: "Who", value: [actorName(e.actor, e), who(e)].filter(Boolean).join(" · ") },
              ...(e.via ? [{ label: "How", value: viaLabel(e.via) }] : []),
              { label: "Action", value: <code className={s.mono}>{e.action}</code> },
              { label: "Target", value: <AuditTarget entry={e} scope={{ kind: "team", team, member: Boolean(role) }} /> },
              { label: "Request", value: e.requestId ? <code className={s.mono}>{e.requestId}</code> : undefined },
            ]
          : []
      }
      sections={e ? auditSections(e) : []}
    />
  );
}
