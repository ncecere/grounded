/*
 * Admin → Models → MCP servers (docs/mcp-client.md): remote MCP servers whose
 * approved tools agents may call, as a ListPage with stored health and a
 * Health filter; each server in a RecordPage (?record=: settings, Test, the
 * tools with their approval) and a FormPage (?form=) to add or edit one.
 * Platform admins change them; auditors read (the copy says so). Delete
 * names the agents that block it (delete-dialog.tsx).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Blocks, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { useFormParam } from "@/components/templates/form-page";
import { useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { useClassifications, useIsPlatformAdmin } from "../hooks";
import { EnabledBadge } from "../models/common";
import { type HealthCheck, healthColumn, healthFacet, useHealthChecks } from "../models/health";
import { type MCPServer, serversKey, useMCPServers } from "./common";
import { DeleteServerDialog } from "./delete-dialog";
import { ServerForm } from "./server-form";
import { ServerRecordPage } from "./server-record";

const columns = (health: (id: string) => HealthCheck | undefined, level: (key: string) => string): DataTableColumn<MCPServer>[] => [
  {
    id: "name",
    header: "Server",
    accessor: (x) => `${x.name} ${x.url}`,
    sortFn: (a, b) => a.name.localeCompare(b.name),
    sortable: true,
    rowHeader: true,
    hideable: false,
    cell: (x) => <CellText primary={x.name} secondary={<span className={s.mono}>{x.url}</span>} />,
  },
  {
    id: "tools",
    header: "Approved tools",
    accessor: (x) => x.approvedCount,
    numeric: true,
    sortable: true,
    cell: (x) => (x.toolsRefreshedAt ? `${x.approvedCount} of ${x.toolCount}` : <span className={s.muted}>Not read yet</span>),
  },
  { id: "ceiling", header: "Data up to", accessor: (x) => level(x.maxClassification), sortable: true },
  { id: "status", header: "Status", accessor: (x) => (x.enabled ? "Enabled" : "Disabled"), sortable: true, cell: (x) => <EnabledBadge enabled={x.enabled} /> },
  healthColumn((x) => health(x.id)),
  { ...timeColumn<MCPServer>("refreshed", "Tools read", (x) => x.toolsRefreshedAt), defaultHidden: true },
];

export function MCPServersPage() {
  const isAdmin = useIsPlatformAdmin();
  const servers = useMCPServers();
  const health = useHealthChecks();
  const levels = useClassifications();
  const record = useRecordParam();
  const form = useFormParam();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<MCPServer | null>(null);
  const del = useMutation({
    mutationFn: async (x: MCPServer) => unwrap(await api.DELETE("/v1/admin/mcp-servers/{serverId}", { params: { path: { serverId: x.id } } })),
    onSuccess: (_, x) => {
      setDeleting(null);
      record.close();
      toast.success(`${x.name} was deleted`);
      void qc.invalidateQueries({ queryKey: serversKey });
    },
  });
  const list = servers.data ?? [];
  const open = list.find((x) => x.id === record.id);
  const editing: MCPServer | "new" | null = form.id === "new" ? "new" : (list.find((x) => x.id === form.id) ?? null);
  const level = (key: string) => levels.data?.find((l) => l.key === key)?.name ?? key;
  const add = isAdmin && (
    <Button onClick={() => form.open("new")}>
      <Plus aria-hidden /> Add MCP server
    </Button>
  );
  return (
    <>
      <ListPage<MCPServer>
        id="admin-mcp-servers"
        title="MCP servers"
        description={
          isAdmin
            ? "Remote tools agents can call while they answer. Add a server, read its tools, and approve the ones agents may use."
            : "Remote tools agents can call while they answer. Platform admins add the servers and approve the tools agents may use."
        }
        notices={
          !isAdmin && (
            <Alert tone="info" title="Read-only">
              You can view the servers and their tools. Only platform admins can change them.
            </Alert>
          )
        }
        primaryAction={add}
        caption="MCP servers"
        columns={columns(health.get, level)}
        data={list}
        facets={[healthFacet((x: MCPServer) => health.get(x.id))]}
        getRowId={(x) => x.id}
        rowLabel={(x) => x.name}
        search={{ label: "Search MCP servers", placeholder: "Name or URL" }}
        loading={servers.isLoading}
        error={servers.error}
        onRetry={() => void servers.refetch()}
        onRowClick={(x) => record.open(x.id)}
        rowActions={(x) => [
          { label: "Edit", icon: <Pencil aria-hidden />, hidden: !isAdmin, onSelect: () => form.open(x.id) },
          { label: "Delete…", icon: <Trash2 aria-hidden />, danger: true, hidden: !isAdmin, onSelect: () => setDeleting(x) },
        ]}
        empty={{
          icon: <Blocks />,
          title: "No MCP servers yet.",
          description: "Agents only call tools you register here and approve.",
        }}
      />
      <ServerRecordPage
        server={open}
        health={open && health.get(open.id)}
        open={Boolean(record.id)}
        loading={servers.isLoading}
        onClose={record.close}
        isAdmin={isAdmin}
        levelName={level}
        onEdit={(x) => form.open(x.id)}
        onDelete={setDeleting}
      />
      {isAdmin && editing && <ServerForm server={editing === "new" ? null : editing} onClose={form.close} />}
      <DeleteServerDialog target={deleting} onClose={() => setDeleting(null)} mutation={del} />
    </>
  );
}
