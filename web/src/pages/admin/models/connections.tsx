/*
 * Admin → Connections (A5): OpenAI-compatible proxies as a ListPage with a
 * row menu, the Models count linking to the filtered Models page, stored
 * health (E11) with a Health filter, and each connection in a RecordPage
 * (details, test with "Add as model", edit).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Eye, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage } from "@/components/templates/list-page";
import { useFormParam } from "@/components/templates/form-page";
import { useRecordParam } from "@/components/templates/record-page";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { type Connection, EnabledBadge, useConnections, useModels } from "./common";
import { ConnectionForm, ConnectionRecordPage } from "./connection-record";
import { type HealthCheck, healthColumn, healthFacet, useHealthChecks } from "./health";
import { ModelDialog, type ModelPreset } from "./model-dialog";

const columns = (health: (id: string) => HealthCheck | undefined): DataTableColumn<Connection>[] => [
  {
    id: "name",
    header: "Connection",
    accessor: (c) => `${c.name} ${c.baseUrl}`,
    sortFn: (a, b) => a.name.localeCompare(b.name),
    sortable: true,
    rowHeader: true,
    hideable: false,
    cell: (c) => <CellText primary={c.name} secondary={<span className={s.mono}>{c.baseUrl}</span>} />,
  },
  {
    id: "key",
    header: "API key",
    accessor: (c) => (c.hasApiKey ? c.apiKeyHint : ""),
    cell: (c) => (c.hasApiKey ? <code className={s.mono}>••••{c.apiKeyHint}</code> : <span className={s.muted}>None</span>),
  },
  {
    id: "models",
    header: "Models",
    accessor: "modelCount",
    numeric: true,
    sortable: true,
    cell: (c) => (c.modelCount ? <TextLink render={<Link to="/admin/models" search={{ connection: c.id } as never} />} aria-label={`${c.modelCount} ${c.modelCount === 1 ? "model" : "models"} on ${c.name}`}>{c.modelCount}</TextLink> : "0"),
  },
  { id: "timeout", header: "Timeout", accessor: "timeoutSeconds", numeric: true, muted: true, defaultHidden: true, cell: (c) => `${c.timeoutSeconds} s` },
  { id: "status", header: "Status", accessor: (c) => (c.enabled ? "Enabled" : "Disabled"), sortable: true, cell: (c) => <EnabledBadge enabled={c.enabled} /> },
  healthColumn((c) => health(c.id)),
];

/** The model to add, from ?form=model:<connection id>:<upstream model> (the upstream name may contain colons). */
function presetOf(value: string | undefined): ModelPreset | null {
  const m = value && /^model:([^:]+):(.+)$/.exec(value);
  return m ? { connectionId: m[1]!, upstreamModel: m[2]! } : null;
}

export function ConnectionsPage() {
  const isAdmin = useIsPlatformAdmin();
  const conns = useConnections();
  const models = useModels();
  const health = useHealthChecks();
  const record = useRecordParam();
  const qc = useQueryClient();
  // ?form=new, ?form=<connection id>, or ?form=model:<connection id>:<upstream model> (add a model it offers).
  const form = useFormParam();
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const del = useMutation({
    mutationFn: async (c: Connection) => unwrap(await api.DELETE("/v1/admin/connections/{connectionId}", { params: { path: { connectionId: c.id } } })),
    onSuccess: (_, c) => {
      setDeleting(null);
      record.close();
      toast.success(`${c.name} was deleted`);
      void qc.invalidateQueries({ queryKey: ["admin", "connections"] });
    },
  });
  const list = conns.data ?? [];
  const open = list.find((c) => c.id === record.id);
  const editing: Connection | "new" | null = form.id === "new" ? "new" : (list.find((c) => c.id === form.id) ?? null);
  const setEditing = (c: Connection | "new") => form.open(c === "new" ? "new" : c.id);
  const adding = presetOf(form.id);
  const setAdding = (p: ModelPreset) => form.open(`model:${p.connectionId}:${p.upstreamModel}`);
  const add = isAdmin && (
    <Button onClick={() => setEditing("new")}>
      <Plus aria-hidden /> Add connection
    </Button>
  );
  return (
    <>
      <ListPage<Connection>
        id="admin-connections"
        title="Connections"
        description="OpenAI-compatible proxies (such as LiteLLM, open-model-gateway or vLLM). Connect one, then add the models you want to offer."
        primaryAction={add}
        caption="Connections"
        columns={columns(health.get)}
        data={list}
        facets={[healthFacet((c: Connection) => health.get(c.id))]}
        getRowId={(c) => c.id}
        rowLabel={(c) => c.name}
        search={{ label: "Search connections", placeholder: "Name or URL" }}
        loading={conns.isLoading}
        error={conns.error}
        onRetry={() => void conns.refetch()}
        onRowClick={(c) => record.open(c.id)}
        rowActions={(c) => [
          { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(c.id) },
          { label: "Edit", icon: <Pencil aria-hidden />, hidden: !isAdmin, onSelect: () => setEditing(c) },
          {
            label: "Delete…",
            icon: <Trash2 aria-hidden />,
            danger: true,
            hidden: !isAdmin,
            disabled: c.modelCount > 0,
            disabledReason: c.modelCount > 0 ? "Remove its models first" : undefined,
            onSelect: () => setDeleting(c),
          },
        ]}
        empty={{ icon: <Plug />, title: "No connections yet.", description: "Add your model proxy to get started.", action: add || undefined }}
      />
      <ConnectionRecordPage
        conn={open}
        health={open && health.get(open.id)}
        open={Boolean(record.id)}
        loading={conns.isLoading}
        onClose={record.close}
        models={models.data ?? []}
        isAdmin={isAdmin}
        onEdit={setEditing}
        onDelete={setDeleting}
        onAddModel={setAdding}
      />
      {isAdmin && editing && <ConnectionForm conn={editing === "new" ? null : editing} onClose={form.close} />}
      {isAdmin && adding && <ModelDialog model={null} connections={list} preset={adding} onClose={form.close} />}
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={del}
        onConfirm={(c) => del.mutate(c)}
        title={`Delete ${deleting?.name}?`}
        description="Only connections without models can be deleted."
        confirmLabel="Delete"
      />
    </>
  );
}
