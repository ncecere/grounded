/* Agent templates (admin portal, v0.6.0 C4): the starting points teams pick when they make an agent. Five ship with Grounded; a platform admin saves more from an agent. */
import { LayoutTemplate, Eye, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { type AgentTemplate, useAgentTemplates } from "../../agents/templates";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { DeleteTemplateDialog, RenameTemplateDialog, ViewTemplateDialog } from "./dialogs";

const columns: DataTableColumn<AgentTemplate>[] = [
  {
    id: "name",
    header: "Template",
    accessor: "name",
    sortable: true,
    rowHeader: true,
    hideable: false,
    cell: (t) => <CellText primary={t.name} secondary={t.description || undefined} />,
  },
  {
    id: "source",
    header: "Source",
    accessor: (t) => (t.builtIn ? "Built in" : "Saved from an agent"),
    sortable: true,
    cell: (t) => (t.builtIn ? <Badge tone="neutral">Built in</Badge> : "Saved from an agent"),
  },
  {
    id: "added",
    header: "Added",
    accessor: (t) => t.createdAt ?? "",
    muted: true,
    cell: (t) => (t.createdAt ? <RelativeTime value={t.createdAt} /> : "Ships with Grounded"),
  },
];

export function AgentTemplatesPage() {
  const isAdmin = useIsPlatformAdmin();
  const templates = useAgentTemplates();
  const [viewing, setViewing] = useState<AgentTemplate | null>(null);
  const [renaming, setRenaming] = useState<AgentTemplate | null>(null);
  const [deleting, setDeleting] = useState<AgentTemplate | null>(null);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Agent templates"
        description="Starting points for a new agent: good instructions and settings, picked when a team makes an agent. A template never holds knowledge bases, tools or who may use the agent."
      />
      {isAdmin ? (
        <Alert tone="info">
          To add a template, open an agent you can edit, then choose <strong>Save as template…</strong> in its “…” menu. You need to be an editor, admin or owner of its team: platform admins have no
          other access to a team's agents.
        </Alert>
      ) : (
        <Alert tone="info">Auditors can view the templates. Only platform admins can rename or delete them.</Alert>
      )}
      <ListPage<AgentTemplate>
        id="admin-agent-templates"
        caption="Agent templates"
        columns={columns}
        data={templates.data ?? []}
        getRowId={(t) => t.id}
        rowLabel={(t) => t.name}
        search={{ label: "Search templates", placeholder: "Name or description" }}
        loading={templates.isLoading}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        rowActions={(t) => [
          { label: "View…", icon: <Eye aria-hidden />, onSelect: () => setViewing(t) },
          { label: "Rename…", icon: <Pencil aria-hidden />, hidden: !isAdmin || t.builtIn, onSelect: () => setRenaming(t) },
          { label: "Delete…", icon: <Trash2 aria-hidden />, danger: true, hidden: !isAdmin || t.builtIn, onSelect: () => setDeleting(t) },
        ]}
        empty={{ icon: <LayoutTemplate />, title: "No templates.", description: "The built-in templates could not be loaded." }}
      />
      {viewing && <ViewTemplateDialog template={viewing} onClose={() => setViewing(null)} />}
      {renaming && <RenameTemplateDialog template={renaming} onClose={() => setRenaming(null)} />}
      <DeleteTemplateDialog template={deleting} onClose={() => setDeleting(null)} />
    </Stack>
  );
}
