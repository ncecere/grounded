/*
 * Admin → Models (A5): the catalog as a ListPage (kind, connection and health
 * facets, search, Used by, stored health) with each model in a RecordPage
 * (?record=<id>): details, test and edit. Adding and editing open a form page
 * (?form=new or ?form=<id>).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, Eye, FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage } from "@/components/templates/list-page";
import { useFormParam } from "@/components/templates/form-page";
import { useRecordParam } from "@/components/templates/record-page";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { toast } from "@/components/ui/toast/toast";
import { providerName } from "@/lib/moderation";
import { useSearchParams } from "@/lib/url-search";
import s from "../../shared.module.css";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { useIsPlatformAdmin } from "../hooks";
import { EnabledBadge, kindLabels, type Model, type ModelKind, type ModelUsage, modelUsedBy, useCatalogUsage, useConnections, useModels } from "./common";
import { type HealthCheck, healthColumn, healthFacet, useHealthChecks } from "./health";
import { ModelDialog } from "./model-dialog";
import { ModelRecordPage, useModelTest } from "./model-record";
import { RerankingNotice } from "./reranking";

function useDeleteModel(onDeleted: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (model: Model) => unwrap(await api.DELETE("/v1/admin/models/{modelId}", { params: { path: { modelId: model.id } } })),
    onSuccess: (_, model) => {
      onDeleted();
      toast.success(`${model.displayName} was deleted`);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
}

/** Pages that open a model's record with ?from=, and where its back link returns (Costs → Overview or Prices). */
const openedFrom: Record<string, { label: string; href: string }> = {
  costs: { label: "Costs", href: "/admin/costs" },
  "costs-prices": { label: "Costs", href: "/admin/costs?tab=prices" },
};

/** The record's back link and close: to the page that linked here (?from=), or the list. */
function useRecordBack(close: () => void) {
  const [params] = useSearchParams();
  const router = useRouter();
  const navigate = useNavigate();
  const back = openedFrom[params.get("from") ?? ""];
  if (!back) return { back: undefined, close };
  // Back to where the link was (its range or tab), or to the page itself when opened directly.
  return { back, close: () => (router.history.canGoBack() ? router.history.back() : void navigate({ href: back.href })) };
}

function kindDetail(x: Model) {
  if (x.kind === "moderation") return providerName(x.moderationProvider, x.moderationFamily);
  if (x.kind === "embedding" && x.dimensions != null) return `${x.dimensions} dimensions`;
  if (x.kind === "chat" && x.contextWindow != null) return `${x.contextWindow.toLocaleString()} tokens`;
  return undefined;
}

type Lookups = { connName: (id: string) => string; usage: Map<string, ModelUsage>; health: (id: string) => HealthCheck | undefined };

function columns(levels: ReturnType<typeof useClassificationLevels>["data"], { connName, usage, health }: Lookups): DataTableColumn<Model>[] {
  return [
    {
      id: "model",
      header: "Model",
      accessor: (x) => `${x.displayName} ${x.key} ${x.upstreamModel}`,
      sortFn: (a, b) => a.displayName.localeCompare(b.displayName),
      sortable: true,
      rowHeader: true,
      hideable: false,
      cell: (x) => <CellText primary={x.displayName} secondary={<span className={s.mono}>{x.key}</span>} />,
    },
    {
      id: "kind",
      header: "Kind",
      accessor: (x) => kindLabels[x.kind],
      sortable: true,
      cell: (x) => <CellText primary={<Badge tone="info">{kindLabels[x.kind]}</Badge>} secondary={kindDetail(x)} />,
    },
    { id: "connection", header: "Connection", accessor: (x) => connName(x.connectionId), sortable: true, muted: true },
    { id: "classification", header: "Max classification", accessor: "maxClassification", cell: (x) => <ClassificationBadge levels={levels} value={x.maxClassification} /> },
    {
      id: "usedBy",
      header: "Used by",
      accessor: (x) => modelUsedBy(usage.get(x.id)).join(", "),
      muted: true,
      cell: (x) => modelUsedBy(usage.get(x.id))[0] ?? <span className={s.muted}>—</span>,
    },
    { id: "status", header: "Status", accessor: (x) => (x.enabled ? "Enabled" : "Disabled"), sortable: true, cell: (x) => <EnabledBadge enabled={x.enabled} /> },
    healthColumn((x) => health(x.id)),
    { id: "upstream", header: "Upstream model", accessor: "upstreamModel", muted: true, defaultHidden: true },
  ];
}

export function ModelsPage() {
  const isAdmin = useIsPlatformAdmin();
  const models = useModels();
  const conns = useConnections();
  const levels = useClassificationLevels();
  const usage = useCatalogUsage();
  const health = useHealthChecks();
  const record = useRecordParam();
  const recordBack = useRecordBack(record.close);
  const test = useModelTest();
  const form = useFormParam();
  const [deleting, setDeleting] = useState<Model | null>(null);
  const del = useDeleteModel(() => {
    setDeleting(null);
    // P-10: a deleted model's test result goes with it.
    test.reset();
    record.close();
  });
  const list = models.data ?? [];
  const connName = (id: string) => conns.data?.find((c) => c.id === id)?.name ?? "—";
  const usageById = new Map((usage.data?.models ?? []).map((u) => [u.modelId, u]));
  const open = list.find((x) => x.id === record.id);
  const editing: Model | "new" | null = form.id === "new" ? "new" : (list.find((x) => x.id === form.id) ?? null);
  const setEditing = (m: Model | "new") => form.open(m === "new" ? "new" : m.id);
  const noConnections = (conns.data ?? []).length === 0;
  const facets: Facet<Model>[] = [
    {
      id: "kind",
      label: "Kind",
      type: "toggle",
      allLabel: "All",
      accessor: (x) => x.kind,
      options: (Object.keys(kindLabels) as ModelKind[]).map((v) => ({ value: v, label: kindLabels[v] })),
    },
    {
      id: "connection",
      label: "Connection",
      type: "select",
      placeholder: "Any connection",
      accessor: (x) => x.connectionId,
      options: (conns.data ?? []).map((c) => ({ value: c.id, label: c.name })),
    },
    healthFacet((x: Model) => health.get(x.id)),
  ];
  const add = isAdmin && (
    <Button onClick={() => setEditing("new")} disabled={noConnections}>
      <Plus aria-hidden /> Add model
    </Button>
  );

  return (
    <>
      <ListPage<Model>
        id="admin-models"
        title="Models"
        description="Models offered to teams, each tagged with the most sensitive data it may process."
        primaryAction={add}
        notices={<RerankingNotice models={list} isAdmin={isAdmin} />}
        caption="Models"
        columns={columns(levels.data, { connName, usage: usageById, health: health.get })}
        data={list}
        getRowId={(x) => x.id}
        rowLabel={(x) => x.displayName}
        facets={facets}
        search={{ label: "Search models", placeholder: "Name, key or upstream ID" }}
        loading={models.isLoading}
        error={models.error}
        onRetry={() => void models.refetch()}
        onRowClick={(x) => record.open(x.id)}
        rowActions={(x) => [
          { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(x.id) },
          {
            label: "Test",
            icon: <FlaskConical aria-hidden />,
            hidden: !isAdmin,
            onSelect: () => {
              record.open(x.id);
              test.mutate(x);
            },
          },
          { label: "Edit", icon: <Pencil aria-hidden />, hidden: !isAdmin, onSelect: () => setEditing(x) },
          { label: "Delete…", icon: <Trash2 aria-hidden />, danger: true, hidden: !isAdmin, onSelect: () => setDeleting(x) },
        ]}
        empty={{ icon: <Cpu />, title: noConnections ? "Add a connection first." : "No models yet.", action: add || undefined }}
      />
      <ModelRecordPage
        model={open}
        health={open && health.get(open.id)}
        open={Boolean(record.id)}
        loading={models.isLoading}
        onClose={recordBack.close}
        back={recordBack.back}
        connectionName={open ? connName(open.connectionId) : ""}
        usage={open && usageById.get(open.id)}
        isAdmin={isAdmin}
        test={test}
        onEdit={setEditing}
        onDelete={setDeleting}
      />
      {isAdmin && editing && <ModelDialog model={editing === "new" ? null : editing} connections={conns.data ?? []} onClose={form.close} />}
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={del}
        onConfirm={(x) => del.mutate(x)}
        title={`Delete ${deleting?.displayName}?`}
        description="Models in use can't be deleted; disable them instead."
        confirmLabel="Delete"
      />
    </>
  );
}
