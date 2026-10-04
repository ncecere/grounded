/*
 * Logs › Access (A3): every use of a Sensitive or Restricted agent (never
 * questions or answers), on the same filter bar as the audit log: agent,
 * person, channel and date range in the URL, and CSV export.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileClock } from "lucide-react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage, timeColumn, useListFilters } from "@/components/templates/list-page";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { dateFacet, ExportButton, noMatches, one, rangeWindow, useAgentOptions, usePeopleOptions } from "./common";
import l from "./logs.module.css";

type Entry = Schemas["AccessLogEntry"];
type Channel = Entry["channel"];
type Levels = ReturnType<typeof useClassificationLevels>["data"];

export const channelLabels: Record<Channel, string> = { ui: "Chat page", api: "API", openai: "OpenAI API", test: "Draft test", public: "Public page", widget: "Widget", mcp: "MCP server" };

function useFacets(): Facet<Entry>[] {
  const agents = useAgentOptions();
  const people = usePeopleOptions();
  return [
    { id: "agent", label: "Agent", type: "select", placeholder: "All agents", options: agents },
    { id: "person", label: "Person", type: "select", placeholder: "Anyone", options: people },
    { id: "channel", label: "Channel", type: "select", placeholder: "Any channel", options: (Object.keys(channelLabels) as Channel[]).map((v) => ({ value: v, label: channelLabels[v] })) },
    dateFacet<Entry>(),
  ];
}

function columns(levels: Levels): DataTableColumn<Entry>[] {
  return [
    { ...timeColumn<Entry>("at", "When", (e) => e.at), sortable: false },
    {
      id: "who",
      header: "Who",
      accessor: (e) => e.userName || e.userEmail,
      cell: (e) =>
        e.userId ? (
          <span title={e.userEmail}>
            <TextLink render={<Link to="/admin/users/$userId" params={{ userId: e.userId }} />}>{e.userName || e.userEmail}</TextLink>
            {e.apiKeyId && <span className={s.secondary}>via API key</span>}
          </span>
        ) : (
          <span className={s.muted}>Service API key</span>
        ),
    },
    {
      id: "agent",
      header: "Agent",
      accessor: "agentName",
      rowHeader: true,
      cell: (e) => (
        <CellText
          primary={<span className={l.nowrap}>{e.agentName}</span>}
          secondary={
            <span className={`${s.mono} ${l.nowrap}`}>
              {e.teamSlug}/{e.agentSlug}
            </span>
          }
        />
      ),
    },
    { id: "version", header: "Version", accessor: (e) => e.agentVersion ?? 0, numeric: true, cell: (e) => (e.agentVersion ? `v${e.agentVersion}` : "Draft") },
    { id: "classification", header: "Classification", accessor: "classification", cell: (e) => <ClassificationBadge levels={levels} value={e.classification} /> },
    { id: "channel", header: "Channel", accessor: (e) => channelLabels[e.channel], muted: true },
  ];
}

export function AccessLogTab() {
  const levels = useClassificationLevels();
  const facets = useFacets();
  const { values } = useListFilters(facets);
  const query = {
    agentId: one(values, "agent") || undefined,
    userId: one(values, "person") || undefined,
    channel: (one(values, "channel") || undefined) as Channel | undefined,
    ...rangeWindow(values),
  };
  const fetchPage = async (cursor?: string, limit = 50) => unwrap(await api.GET("/v1/admin/access-log", { params: { query: { ...query, cursor, limit } } }));
  const log = useInfiniteQuery({
    queryKey: ["admin", "access-log", query],
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <ListPage<Entry>
      id="admin-access-log"
      caption="Access log"
      columns={columns(levels.data)}
      data={items}
      getRowId={(e) => String(e.id)}
      rowLabel={(e) => `${e.agentName} by ${e.userName || e.userEmail || "a service key"}`}
      facets={facets}
      manual
      loading={log.isLoading}
      error={log.error}
      onRetry={() => void log.refetch()}
      empty={{ icon: <FileClock />, title: "No entries.", description: "Only agents classified Sensitive or above are logged." }}
      tableProps={{
        noResults: noMatches,
        facetCounts: false,
        loadMore: { hasMore: Boolean(log.hasNextPage), loading: log.isFetchingNextPage, onLoadMore: () => void log.fetchNextPage() },
        toolbar: (
          <ExportButton
            filename="access-log.csv"
            fetchPage={(cursor) => fetchPage(cursor, 200)}
            header={["at", "userEmail", "userName", "apiKeyId", "team", "agent", "agentSlug", "version", "classification", "channel"]}
            row={(e) => [e.at, e.userEmail, e.userName, e.apiKeyId ?? "", e.teamSlug, e.agentName, e.agentSlug, e.agentVersion ?? "", e.classification, e.channel]}
          />
        ),
      }}
    />
  );
}
