/*
 * Admin → Agents (Q3): every team's agents, metadata only, as a ListPage that
 * fits at 1280 px. The kill switch stays visible as a danger icon button on
 * each row; the rest is in the row menu and the agent's RecordPage
 * (?record=<id>), which also edits the short name.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Eye, Power, PowerOff } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { ActionMenu } from "@/components/templates/action-menu";
import { useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { IconButton } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Tooltip } from "@/components/ui/tooltip/tooltip";
import { audienceLabels } from "@/lib/terms";
import s from "../../shared.module.css";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { useIsPlatformAdmin } from "../hooks";
import { AgentRecordPage } from "./agent-record";
import a from "./agents.module.css";
import { KillSwitchDialog } from "./kill-switch";

type AdminAgent = Schemas["AdminAgent"];
type AgentStatus = Schemas["AgentStatus"];
type Levels = ReturnType<typeof useClassificationLevels>["data"];

export const agentStatusLabels: Record<AgentStatus, string> = { active: "Enabled", disabled_by_team: "Disabled by team", disabled_by_platform: "Disabled by platform" };
export const agentStatusTone = { active: "success", disabled_by_team: "warning", disabled_by_platform: "danger" } as const;
// Platform-disabled agents sort first: they are what an admin is looking for.
const statusOrder: Record<AgentStatus, number> = { disabled_by_platform: 0, disabled_by_team: 1, active: 2 };

export const adminAgentsQuery = (team = "", status = "") => ({
  queryKey: ["admin", "agents", team, status],
  queryFn: async () => unwrap(await api.GET("/v1/admin/agents", { params: { query: { team: team || undefined, status: (status || undefined) as AgentStatus | undefined } } })),
});

function columns(levels: Levels): DataTableColumn<AdminAgent>[] {
  return [
    {
      id: "name",
      header: "Agent",
      accessor: (r) => `${r.name} ${r.slug}`,
      sortable: true,
      sortFn: (x, y) => x.name.localeCompare(y.name),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className={a.agentCell}>
          <CellText primary={<span className={a.nowrap}>{r.name}</span>} secondary={<span className={`${s.mono} ${a.nowrap}`}>{r.slug}</span>} />
        </span>
      ),
    },
    {
      id: "team",
      header: "Team",
      accessor: "teamName",
      sortable: true,
      cell: (r) => (
        <TextLink render={<Link to="/admin/teams/$team" params={{ team: r.teamSlug }} />} className={a.nowrap}>
          {r.teamName}
        </TextLink>
      ),
    },
    {
      id: "audience",
      header: "Audience",
      accessor: (r) => `${audienceLabels[r.audience]} ${r.shortName ?? ""}`,
      sortable: true,
      cell: (r) => (
        <CellText
          primary={<span className={a.nowrap}>{audienceLabels[r.audience]}</span>}
          secondary={r.shortName ? <span className={`${s.mono} ${a.nowrap}`}>/a/{r.shortName}</span> : undefined}
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: (r) => agentStatusLabels[r.status],
      sortable: true,
      sortFn: (x, y) => statusOrder[x.status] - statusOrder[y.status],
      cell: (r) => (
        <StatusBadge tone={agentStatusTone[r.status]}>{agentStatusLabels[r.status]}</StatusBadge>
      ),
    },
    {
      id: "classification",
      header: "Classification",
      accessor: (r) => r.classification ?? "",
      sortable: true,
      cell: (r) => (r.classification ? <ClassificationBadge levels={levels} value={r.classification} /> : <span className={`${s.muted} ${a.nowrap}`}>Not published</span>),
    },
    { id: "model", header: "Model", accessor: (r) => r.chatModelName ?? "", muted: true, defaultHidden: true },
    {
      id: "version",
      header: "Version",
      accessor: (r) => r.publishedVersion ?? 0,
      numeric: true,
      sortable: true,
      defaultHidden: true,
      cell: (r) => (r.publishedVersion ? `v${r.publishedVersion}` : "—"),
    },
    { ...timeColumn<AdminAgent>("updatedAt", "Updated", (r) => r.updatedAt), defaultHidden: true },
  ];
}

function facets(list: AdminAgent[]): Facet<AdminAgent>[] {
  const teams = new Map(list.map((r) => [r.teamSlug, r.teamName]));
  return [
    {
      id: "audience",
      label: "Audience",
      type: "toggle",
      allLabel: "All",
      accessor: (r) => r.audience,
      options: (Object.keys(audienceLabels) as (keyof typeof audienceLabels)[]).map((v) => ({ value: v, label: audienceLabels[v] })),
    },
    {
      id: "status",
      label: "Status",
      type: "toggle",
      allLabel: "Any",
      accessor: (r) => r.status,
      options: (Object.keys(agentStatusLabels) as AgentStatus[]).map((v) => ({ value: v, label: agentStatusLabels[v] })),
    },
    {
      id: "team",
      label: "Team",
      type: "select",
      placeholder: "All teams",
      accessor: (r) => r.teamSlug,
      options: [...teams].sort((x, y) => x[1].localeCompare(y[1])).map(([value, label]) => ({ value, label })),
    },
  ];
}

export function AdminAgentsPage() {
  const isAdmin = useIsPlatformAdmin();
  const levels = useClassificationLevels();
  const agents = useQuery(adminAgentsQuery());
  const record = useRecordParam();
  const [changing, setChanging] = useState<AdminAgent | null>(null);
  const list = agents.data ?? [];
  const open = list.find((r) => r.id === record.id);

  const rowActions = (r: AdminAgent) => {
    const disabled = r.status === "disabled_by_platform";
    return (
      <div className={a.rowActions}>
        {isAdmin && (
          <Tooltip content={disabled ? `Enable ${r.name}` : `Disable ${r.name} for everyone`}>
            <IconButton
              size="sm"
              className={disabled ? undefined : a.kill}
              icon={disabled ? <Power aria-hidden /> : <PowerOff aria-hidden />}
              label={`${disabled ? "Enable" : "Disable"} ${r.name}`}
              onClick={() => setChanging(r)}
            />
          </Tooltip>
        )}
        <ActionMenu
          label={`Actions for ${r.name}`}
          actions={[
            { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(r.id) },
            { label: "Open access log", render: <Link to="/admin/logs" search={{ tab: "access", agent: r.id } as never} /> },
            {
              label: disabled ? "Enable agent" : "Disable agent…",
              icon: disabled ? <Power aria-hidden /> : <PowerOff aria-hidden />,
              danger: !disabled,
              hidden: !isAdmin,
              onSelect: () => setChanging(r),
            },
          ]}
        />
      </div>
    );
  };

  return (
    <>
      <ListPage<AdminAgent>
        id="admin-agents"
        title="Agents"
        description="Every team's agents, as metadata only. Disabling one (the kill switch) stops all chat with it until a platform admin enables it."
        caption="Agents"
        columns={columns(levels.data)}
        data={list}
        getRowId={(r) => r.id}
        rowLabel={(r) => r.name}
        facets={facets(list)}
        search={{ label: "Search agents", placeholder: "Name, slug or short name" }}
        loading={agents.isLoading}
        error={agents.error}
        onRetry={() => void agents.refetch()}
        empty={{ icon: <Bot />, title: "No agents yet.", description: "Teams create agents in their workspace." }}
        onRowClick={(r) => record.open(r.id)}
        tableProps={{ rowActions, defaultSort: { columnId: "status", direction: "ascending" } }}
      />
      <AgentRecordPage agent={open} open={Boolean(record.id)} loading={agents.isLoading} onClose={record.close} isAdmin={isAdmin} levels={levels.data} onKillSwitch={setChanging} />
      {changing && <KillSwitchDialog agent={changing} onClose={() => setChanging(null)} />}
    </>
  );
}
