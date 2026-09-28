/*
 * Logs › Audit (A3, Q6): the platform audit log as a ListPage with server
 * filters in the URL (action group, target type, person, date range), sign-ins
 * hidden by default (?signins=show shows them), CSV export, and each entry in
 * a RecordPage with a before/after diff.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { Eye, FileClock } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { actionGroups, actionLabel, actorName, targetTypeLabel, targetTypeLabels } from "@/components/audit/labels";
import { AuditTarget } from "@/components/audit/target";
import { ListPage, timeColumn, useListFilters } from "@/components/templates/list-page";
import { useRecordParam } from "@/components/templates/record-page";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Switch } from "@/components/ui/switch/switch";
import { useSearchParams } from "@/lib/url-search";
import s from "../../shared.module.css";
import { AuditEntryPage, AuditTeam } from "./audit-record";
import { ExportButton, one, rangeWindow, usePeopleOptions } from "./common";
import l from "./logs.module.css";

type Entry = Schemas["AuditEntry"];

/** ?signins=show turns off the default "Hide sign-ins" (Q6). */
export const SIGNINS_PARAM = "signins";

function useFacets(): Facet<Entry>[] {
  const people = usePeopleOptions();
  return [
    { id: "action", label: "Action", type: "select", placeholder: "All actions", options: actionGroups.map((g) => ({ value: g.prefix, label: g.label })) },
    {
      id: "target",
      label: "Target type",
      type: "select",
      placeholder: "Any target",
      options: Object.entries(targetTypeLabels)
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    },
    { id: "person", label: "Person", type: "select", placeholder: "Anyone", options: people },
    { id: "range", label: "Date", type: "date-range" },
  ];
}

const columns: DataTableColumn<Entry>[] = [
  { ...timeColumn<Entry>("occurredAt", "When", (e) => e.occurredAt), sortable: false },
  {
    id: "who",
    header: "Who",
    accessor: (e) => actorName(e.actor, e),
    cell: (e) => (
      <span className={e.actor.kind === "system" ? s.muted : s.primary} title={e.actor.email ?? undefined}>
        {actorName(e.actor, e)}
        {e.actor.kind === "api_key" && <span className={s.secondary}>API key{e.actor.apiKeyName ? `: ${e.actor.apiKeyName}` : ""}</span>}
      </span>
    ),
  },
  {
    id: "action",
    header: "Action",
    accessor: (e) => actionLabel(e.action),
    rowHeader: true,
    cell: (e) => <CellText primary={actionLabel(e.action)} secondary={<span className={s.mono}>{e.action}</span>} />,
  },
  {
    id: "target",
    header: "Target",
    accessor: (e) => e.targetLabel ?? targetTypeLabel(e.targetType),
    // A sign-in's target is the person who signed in: say nothing twice.
    cell: (e) =>
      e.action.startsWith("auth.") ? (
        <span className={s.muted}>—</span>
      ) : (
        <span className={l.target}>
          <AuditTarget entry={e} scope={{ kind: "platform" }} />
        </span>
      ),
  },
  {
    id: "team",
    header: "Team",
    accessor: (e) => e.teamName ?? "",
    cell: (e) => (e.teamId ? <AuditTeam entry={e} /> : <span className={s.muted}>—</span>),
  },
  { id: "request", header: "Request ID", accessor: "requestId", muted: true, defaultHidden: true, cell: (e) => <span className={s.mono}>{e.requestId}</span> },
];

const pageSize = 50;

export function AuditLogTab() {
  const facets = useFacets();
  const { values } = useListFilters(facets);
  const [params, setParams] = useSearchParams();
  const showSignIns = params.get(SIGNINS_PARAM) === "show";
  const record = useRecordParam();
  const action = one(values, "action");
  const query = {
    action: action || undefined,
    // Hiding sign-ins doesn't fight an explicit "Sign-in" action filter.
    excludeAction: !showSignIns && action !== "auth." ? "auth." : undefined,
    targetType: one(values, "target") || undefined,
    actorUserId: one(values, "person") || undefined,
    ...rangeWindow(values),
  };
  const fetchPage = async (cursor?: string, limit = pageSize) => unwrap(await api.GET("/v1/admin/audit", { params: { query: { ...query, cursor, limit } } }));
  const log = useInfiniteQuery({
    queryKey: ["admin", "audit", query],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const open = items.find((e) => String(e.id) === record.id);
  const setShow = (show: boolean) =>
    setParams((p) => {
      const out = new URLSearchParams(p);
      if (show) out.set(SIGNINS_PARAM, "show");
      else out.delete(SIGNINS_PARAM);
      return out;
    });

  return (
    <>
      <ListPage<Entry>
        id="admin-audit"
        caption="Audit log"
        columns={columns}
        data={items}
        getRowId={(e) => String(e.id)}
        rowLabel={(e) => `${actionLabel(e.action)} ${e.targetLabel ?? ""}`.trim()}
        facets={facets}
        manual
        loading={log.isLoading}
        error={log.error}
        onRetry={() => void log.refetch()}
        onRowClick={(e) => record.open(String(e.id))}
        rowActions={(e) => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(String(e.id)) }]}
        empty={{ icon: <FileClock />, title: Object.values(query).some(Boolean) ? "No entries match these filters." : "No audit entries yet." }}
        tableProps={{
          facetCounts: false,
          loadMore: { hasMore: Boolean(log.hasNextPage), loading: log.isFetchingNextPage, onLoadMore: () => void log.fetchNextPage() },
          toolbar: (
            <div className={l.toolbar}>
              <Switch label="Hide sign-ins" checked={!showSignIns} disabled={action === "auth."} onCheckedChange={(v) => setShow(!v)} />
              <ExportButton
                filename="audit-log.csv"
                fetchPage={(cursor) => fetchPage(cursor, 200)}
                header={["occurredAt", "actor", "actorEmail", "action", "targetType", "targetId", "target", "teamId", "requestId", "before", "after", "metadata"]}
                row={(e) => [
                  e.occurredAt,
                  actorName(e.actor, e),
                  e.actor.email ?? "",
                  e.action,
                  e.targetType,
                  e.targetId,
                  e.targetLabel ?? "",
                  e.teamId ?? "",
                  e.requestId,
                  e.before ?? "",
                  e.after ?? "",
                  e.metadata,
                ]}
              />
            </div>
          ),
        }}
      />
      <AuditEntryPage id={record.id} listed={open} onClose={record.close} />
    </>
  );
}
