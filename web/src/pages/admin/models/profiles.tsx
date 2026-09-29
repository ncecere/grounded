/*
 * Admin → Embedding profiles › Profiles (A5): a list with one-line Vectors
 * and Passages cells, Used by, and a row menu (Make default, Retire, Fusion
 * defaults, Delete last). Each profile opens in a RecordPage with its fixed
 * settings, output dimensions and default fusion weights. The page and its
 * header ("Add profile") are in profiles-page.tsx.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Eye, Layers, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import type { ActionItem } from "@/components/templates/action-menu";
import { ListPage } from "@/components/templates/list-page";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { toast } from "@/components/ui/toast/toast";
import { useLevelName } from "../../team/common";
import { describeWeights } from "../../team/kbs/fusion-form";
import s from "../../shared.module.css";
import { type Profile, type ProfileUsage, profileUsedBy, useCatalogUsage } from "./common";
import { ProfileFusionDialog } from "./profile-dialog";
import m from "./models.module.css";

type ProfileUpdate = { p: Profile; body: Schemas["EmbeddingProfileUpdate"] };

function useProfileMutations(onDeleted: () => void) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: async ({ p, body }: ProfileUpdate) =>
      unwrap(await api.PATCH("/v1/admin/embedding-profiles/{profileId}", { params: { path: { profileId: p.id }, header: ifMatch(p.revision) }, body })),
    onSuccess: (_, { p, body }) => toast.success(body.isDefault ? `${p.name} is now the default` : body.status === "retired" ? `${p.name} was retired` : `${p.name} was reactivated`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "profiles"] }),
  });
  const del = useMutation({
    mutationFn: async (p: Profile) => unwrap(await api.DELETE("/v1/admin/embedding-profiles/{profileId}", { params: { path: { profileId: p.id } } })),
    onSuccess: (_, p) => {
      onDeleted();
      toast.success(`${p.name} was deleted`);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  return { update, del };
}

const vectors = (p: Profile) => `${p.dimensions} · ${p.storageType}`;
const passages = (p: Profile) => `${p.chunkSize} tok / ${p.chunkOverlap} overlap`;

function ProfileStatus({ p }: { p: Profile }) {
  if (p.isDefault) return <Badge tone="info">Default</Badge>;
  return p.status === "active" ? <StatusBadge tone="success">Active</StatusBadge> : <StatusBadge tone="neutral">Retired</StatusBadge>;
}

/** The profiles list; `add` is the "Add profile" button for the empty state (platform admins). */
export function ProfilesTab({ isAdmin, add }: { isAdmin: boolean; add?: ReactNode }) {
  const levelName = useLevelName();
  const profiles = useQuery({ queryKey: ["admin", "profiles"], queryFn: async () => unwrap(await api.GET("/v1/admin/embedding-profiles")) });
  const usage = useCatalogUsage();
  const record = useRecordParam();
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [fusion, setFusion] = useState<Profile | null>(null);
  const { update, del } = useProfileMutations(() => {
    setDeleting(null);
    record.close();
  });
  const list = profiles.data ?? [];
  const usageById = new Map((usage.data?.profiles ?? []).map((u) => [u.profileId, u]));
  const inUse = (p: Profile) => profileUsedBy(usageById.get(p.id)).length > 0;
  const open = list.find((p) => p.id === record.id);

  const actions = (p: Profile): ActionItem[] => [
    { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(p.id) },
    { label: "Make default", icon: <Star aria-hidden />, hidden: !isAdmin || p.isDefault || p.status !== "active", onSelect: () => update.mutate({ p, body: { isDefault: true } }) },
    { label: "Fusion defaults", icon: <SlidersHorizontal aria-hidden />, hidden: !isAdmin, onSelect: () => setFusion(p) },
    {
      label: p.status === "active" ? "Retire" : "Reactivate",
      icon: p.status === "active" ? <Archive aria-hidden /> : <ArchiveRestore aria-hidden />,
      hidden: !isAdmin || p.isDefault,
      onSelect: () => update.mutate({ p, body: { status: p.status === "active" ? "retired" : "active" } }),
    },
    {
      label: "Delete…",
      icon: <Trash2 aria-hidden />,
      danger: true,
      hidden: !isAdmin,
      disabled: inUse(p),
      disabledReason: inUse(p) ? "In use: retire it instead" : undefined,
      onSelect: () => setDeleting(p),
    },
  ];
  const columns: DataTableColumn<Profile>[] = [
    {
      id: "name",
      header: "Profile",
      accessor: (p) => `${p.name} ${p.key}`,
      sortFn: (a, b) => a.name.localeCompare(b.name),
      sortable: true,
      rowHeader: true,
      hideable: false,
      cell: (p) => <CellText primary={p.name} secondary={<span className={s.mono}>{p.key}</span>} />,
    },
    {
      id: "model",
      header: "Model",
      accessor: (p) => p.model.displayName,
      sortable: true,
      cell: (p) => <CellText primary={p.model.displayName} secondary={`up to ${levelName(p.model.maxClassification)}`} />,
    },
    { id: "vectors", header: "Vectors", accessor: vectors, cell: (p) => <span className={s.mono}>{vectors(p)}</span> },
    { id: "passages", header: "Passages", accessor: passages, muted: true },
    {
      id: "usedBy",
      header: "Used by",
      accessor: (p) => profileUsedBy(usageById.get(p.id)).join(", "),
      muted: true,
      cell: (p) => profileUsedBy(usageById.get(p.id)).join(" · ") || <span className={s.muted}>—</span>,
    },
    { id: "fusion", header: "Fusion default", accessor: (p) => (p.defaultFusionWeights ? describeWeights(p.defaultFusionWeights) : "Platform default"), muted: true, defaultHidden: true },
    { id: "status", header: "Status", accessor: (p) => (p.isDefault ? "Default" : p.status), sortable: true, cell: (p) => <ProfileStatus p={p} /> },
  ];
  return (
    <>
      <ErrorAlert error={update.error} />
      <ListPage<Profile>
        id="admin-profiles"
        caption="Embedding profiles"
        columns={columns}
        data={list}
        getRowId={(p) => p.id}
        rowLabel={(p) => p.name}
        loading={profiles.isLoading}
        error={profiles.error}
        onRetry={() => void profiles.refetch()}
        onRowClick={(p) => record.open(p.id)}
        rowActions={actions}
        empty={{ icon: <Layers />, title: "No embedding profiles yet.", description: "Add an embedding model first, then create a profile.", action: add || undefined }}
      />
      <ProfileRecordPage
        profile={open}
        open={Boolean(record.id)}
        loading={profiles.isLoading}
        onClose={record.close}
        usage={open && usageById.get(open.id)}
        isAdmin={isAdmin}
        onFusion={setFusion}
      />
      {fusion && <ProfileFusionDialog profile={fusion} onClose={() => setFusion(null)} />}
      <ConfirmMutationDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={del}
        onConfirm={(p) => del.mutate(p)}
        title={`Delete ${deleting?.name}?`}
        description="Profiles in use can't be deleted; retire them instead."
        confirmLabel="Delete"
      />
    </>
  );
}

type RecordProps = { profile?: Profile; open: boolean; loading: boolean; onClose: () => void; usage?: ProfileUsage; isAdmin: boolean; onFusion: (p: Profile) => void };

function ProfileRecordPage({ profile: p, open, loading, onClose, usage, isAdmin, onFusion }: RecordProps) {
  const levelName = useLevelName();
  const usedBy = profileUsedBy(usage);
  return (
    <RecordPage
      open={open}
      onClose={onClose}
      title={p?.name ?? "Embedding profile"}
      description="How documents are split into passages and embedded."
      loading={loading && !p}
      error={!loading && open && !p ? new Error("This profile no longer exists.") : undefined}
      facts={
        p
          ? [
              { label: "Status", value: <ProfileStatus p={p} /> },
              { label: "Key", value: <code className={s.mono}>{p.key}</code> },
              { label: "Model", value: `${p.model.displayName} (up to ${levelName(p.model.maxClassification)})` },
              { label: "Stored dimensions", value: p.outputDimensions != null ? `${p.outputDimensions} (shortened from the model's vectors)` : `${p.dimensions} (the model's own)` },
              { label: "Storage type", value: p.storageType },
              { label: "Passages", value: `${p.chunkSize} tokens, ${p.chunkOverlap} overlap (chunker v${p.chunkerVersion})` },
              { label: "Document prefix", value: p.documentPrefix ? <code className={s.mono}>{p.documentPrefix}</code> : "None" },
              { label: "Query prefix", value: p.queryPrefix ? <code className={s.mono}>{p.queryPrefix}</code> : "None" },
              { label: "Default fusion weights", value: p.defaultFusionWeights ? describeWeights(p.defaultFusionWeights) : "The platform default" },
              { label: "Description", value: p.description || undefined },
            ].filter((f) => f.value !== undefined)
          : []
      }
      sections={
        p
          ? [
              {
                title: "Used by",
                content: usedBy.length ? (
                  <ul className={m.usedBy}>
                    {usedBy.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.muted}>No source or knowledge base uses this profile.</p>
                ),
              },
            ]
          : []
      }
      actions={
        p &&
        isAdmin && (
          <Button variant="secondary" onClick={() => onFusion(p)}>
            <SlidersHorizontal aria-hidden /> Fusion defaults
          </Button>
        )
      }
    />
  );
}
