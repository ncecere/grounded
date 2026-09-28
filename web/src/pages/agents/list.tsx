/*
 * Team → Agents (W6) on the ListPage template: status facet and search in
 * the URL, an Audience column, an "unpublished changes" dot, the model's
 * display name (Q11), and a row menu (Chat, Test, Share).
 */
import { Link } from "@tanstack/react-router";
import { Bot, FlaskConical, MessageSquare, Pencil, Plus, Share2 } from "lucide-react";
import { useState } from "react";
import { useIntent } from "../../lib/intents";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Avatar } from "@/components/ui/avatar/avatar";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { TextLink } from "@/components/ui/text-link/text-link";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { audienceLabel } from "@/lib/terms";
import s from "../shared.module.css";
import { ArchivedNotice } from "../team/layout";
import { useTeam } from "../team/common";
import { type Agent, AgentStatusBadge, useAgents, useChatModels } from "./common";
import a from "./agents.module.css";
import { CreateAgentDialog } from "./create-agent-dialog";

type Status = "live" | "draft" | "disabled";

const statusOf = (ag: Agent): Status => (ag.status !== "active" ? "disabled" : ag.published ? "live" : "draft");
const statusLabels: Record<Status, string> = { live: "Live", draft: "Not published", disabled: "Disabled" };

const facets: Facet<Agent>[] = [
  { id: "status", label: "Status", type: "toggle", allLabel: "All", accessor: statusOf, options: (Object.keys(statusLabels) as Status[]).map((v) => ({ value: v, label: statusLabels[v] })) },
];

export function AgentsPage() {
  const { slug, canEdit } = useTeam();
  const agents = useAgents(slug);
  const models = useChatModels();
  const [creating, setCreating] = useState(false);
  useIntent("new-agent", () => canEdit && setCreating(true));
  const modelName = (ag: Agent) => models.data?.find((m) => m.id === ag.draft.chatModelId)?.displayName ?? ag.published?.chatModelName ?? "";
  const editor = (ag: Agent, search?: Record<string, string>) => <Link to="/teams/$team/agents/$agentId" params={{ team: slug, agentId: ag.id }} search={search as never} />;

  const columns: DataTableColumn<Agent>[] = [
    {
      id: "name",
      header: "Agent",
      accessor: "name",
      sortable: true,
      rowHeader: true,
      cell: (ag) => (
        <span className={a.nameCell}>
          <Avatar name={ag.name} size="sm" shape="square" decorative />
          <CellText
            primary={
              canEdit ? (
                <TextLink render={editor(ag)} className={s.primary}>
                  {ag.name}
                </TextLink>
              ) : (
                ag.name
              )
            }
            secondary={ag.description}
          />
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: (ag) => statusLabels[statusOf(ag)],
      sortable: true,
      cell: (ag) => (
        <span className={a.statusCell}>
          <AgentStatusBadge agent={ag} />
          {ag.published && ag.hasUnpublishedChanges && (
            <span className={a.changesDot} title="Unpublished changes">
              <VisuallyHidden>Unpublished changes</VisuallyHidden>
            </span>
          )}
        </span>
      ),
    },
    {
      id: "audience",
      header: "Audience",
      accessor: (ag) => audienceLabel(ag.published ? ag.audience : ag.draft.audience),
      sortable: true,
      cell: (ag) => (ag.published ? <Badge variant="outline">{audienceLabel(ag.audience)}</Badge> : <span className={s.muted}>{audienceLabel(ag.draft.audience)} (draft)</span>),
    },
    { id: "model", header: "Model", accessor: modelName, sortable: true, muted: true, cell: (ag) => modelName(ag) || "—" },
    {
      id: "kbs",
      header: "Knowledge bases",
      accessor: (ag) => (ag.published?.knowledgeBases ?? []).map((k) => k.name).join(", "),
      muted: true,
      defaultHidden: true,
    },
    {
      id: "updated",
      header: "Version",
      accessor: (ag) => ag.updatedAt,
      sortable: true,
      cell: (ag) => (
        <span className={a.versionCell}>
          {ag.published ? `v${ag.published.version} · ` : ""}
          <RelativeTime value={ag.updatedAt} />
        </span>
      ),
    },
  ];

  const newAgent = canEdit && (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden /> New agent
    </Button>
  );
  return (
    <>
      <ListPage<Agent>
        id="team-agents"
        title="Agents"
        description="Agents answer questions from your knowledge bases with a chat model. People chat with published agents."
        primaryAction={newAgent}
        notices={<ArchivedNotice>Its agents are read-only.</ArchivedNotice>}
        caption="Agents"
        columns={columns}
        data={agents.data ?? []}
        getRowId={(ag) => ag.id}
        rowLabel={(ag) => ag.name}
        facets={facets}
        search={{ label: "Search agents", placeholder: "Name or description" }}
        rowActions={(ag) => [
          { label: `Chat with ${ag.name}`, icon: <MessageSquare aria-hidden />, render: <Link to="/a/$team/$agent" params={{ team: slug, agent: ag.slug }} />, hidden: !(ag.status === "active" && ag.published) },
          { label: "Edit", icon: <Pencil aria-hidden />, render: editor(ag), hidden: !canEdit },
          { label: "Test", icon: <FlaskConical aria-hidden />, render: editor(ag, { test: "open" }), hidden: !canEdit },
          { label: "Share", icon: <Share2 aria-hidden />, render: editor(ag, { tab: "share" }), hidden: !canEdit },
        ]}
        loading={agents.isLoading}
        error={agents.error}
        onRetry={agents.refetch}
        empty={{
          icon: <Bot />,
          title: "No agents yet.",
          description: canEdit ? "Create an agent, choose its knowledge bases and model, test it, then publish it." : "Editors on your team can create agents.",
          action: newAgent,
        }}
      />
      {creating && <CreateAgentDialog onClose={() => setCreating(false)} />}
    </>
  );
}
