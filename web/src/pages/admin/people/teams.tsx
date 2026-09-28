/*
 * Admin → Teams (A7): every team as a ListPage (status facet and search in
 * the URL, filtered by the server) with Agents, Sources and Storage, so large
 * teams stand out.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Users, UsersRound } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { PersonCell } from "@/components/person-cell";
import { ListPage, useListFilters } from "@/components/templates/list-page";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { formatBytes } from "@/lib/bitop-format";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import s from "../../shared.module.css";
import { one, useDebounced, useIsPlatformAdmin } from "../hooks";
import { TeamStatusBadge } from "./common";
import { CreateTeamDialog } from "./create-team-dialog";

type Summary = Schemas["TeamSummary"];

const facets: Facet<Summary>[] = [
  {
    id: "status",
    label: "Status",
    type: "toggle",
    allLabel: "All",
    options: [
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived" },
    ],
  },
];

function columns(levels: ReturnType<typeof useClassificationLevels>["data"]): DataTableColumn<Summary>[] {
  return [
    {
      id: "team",
      header: "Team",
      accessor: (r) => r.team.name,
      rowHeader: true,
      hideable: false,
      cell: ({ team }) => (
        <PersonCell name={team.name} shape="square">
          <CellText
            primary={<TextLink render={<Link to="/admin/teams/$team" params={{ team: team.slug }} />}>{team.name}</TextLink>}
            secondary={<span className={s.mono}>{team.slug}</span>}
          />
        </PersonCell>
      ),
    },
    { id: "classification", header: "Classification", accessor: (r) => r.team.maxClassification, cell: (r) => <ClassificationBadge levels={levels} value={r.team.maxClassification} /> },
    {
      id: "members",
      header: "Members",
      accessor: "memberCount",
      numeric: true,
      cell: (r) => (
        <>
          {r.memberCount}
          {r.ownerCount === 0 && (
            <span className={s.secondary}>
              <Badge tone="warning" size="sm">
                No owner
              </Badge>
            </span>
          )}
        </>
      ),
    },
    { id: "agents", header: "Agents", accessor: "agentCount", numeric: true },
    { id: "sources", header: "Sources", accessor: "sourceCount", numeric: true },
    { id: "kbs", header: "Knowledge bases", accessor: "kbCount", numeric: true, defaultHidden: true },
    { id: "storage", header: "Storage", accessor: "storageBytes", numeric: true, cell: (r) => formatBytes(r.storageBytes) },
    { id: "status", header: "Status", accessor: (r) => r.team.status, cell: (r) => <TeamStatusBadge status={r.team.status} /> },
  ];
}

export function AdminTeamsPage() {
  const isAdmin = useIsPlatformAdmin();
  const levels = useClassificationLevels();
  const [creating, setCreating] = useState(false);
  const { values, query } = useListFilters(facets);
  const q = useDebounced(query.trim());
  const status = one(values, "status") as Schemas["TeamStatus"] | "";
  const teams = useInfiniteQuery({
    queryKey: ["admin", "teams", q, status],
    queryFn: async ({ pageParam }) => unwrap(await api.GET("/v1/admin/teams", { params: { query: { q: q || undefined, status: status || undefined, cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = teams.data?.pages.flatMap((p) => p.items) ?? [];
  const create = isAdmin && (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden /> Create team
    </Button>
  );
  return (
    <>
      <ListPage<Summary>
        id="admin-teams"
        title="Teams"
        description="Teams own data sources, knowledge bases and agents. Only platform admins create teams."
        primaryAction={create}
        caption="Teams"
        columns={columns(levels.data)}
        data={items}
        getRowId={(r) => r.team.id}
        rowLabel={(r) => r.team.name}
        facets={facets}
        search={{ label: "Search teams", placeholder: "Name or slug" }}
        manual
        loading={teams.isLoading}
        error={teams.error}
        onRetry={() => void teams.refetch()}
        rowActions={(r) => [
          { label: "Open", icon: <Users aria-hidden />, render: <Link to="/admin/teams/$team" params={{ team: r.team.slug }} /> },
          { label: "Limits", render: <Link to="/admin/teams/$team" params={{ team: r.team.slug }} search={{ tab: "limits" }} /> },
          { label: "Agents", render: <Link to="/admin/agents" search={{ team: r.team.slug }} /> },
        ]}
        empty={{ icon: <UsersRound />, title: q || status ? "No teams match." : "No teams yet.", action: create || undefined }}
        tableProps={{ facetCounts: false, loadMore: { hasMore: Boolean(teams.hasNextPage), loading: teams.isFetchingNextPage, onLoadMore: () => void teams.fetchNextPage() } }}
      />
      <CreateTeamDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
