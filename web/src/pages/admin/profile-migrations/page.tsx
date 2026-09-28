/*
 * Admin → Profile migrations (docs/phase5-deploy.md §5 P2): every move of a
 * knowledge base to another embedding profile, as a ListPage with a meter
 * for running ones; each opens in a RecordPage (?record=<id>). Platform
 * admins start one here (?start=<kbId> opens the dialog for that knowledge
 * base, from its page); auditors read.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Eye, Plus, Shuffle } from "lucide-react";
import { useState } from "react";
import { type ActionItem } from "@/components/templates/action-menu";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { useRecordParam } from "@/components/templates/record-page";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { Meter } from "@/components/ui/meter/meter";
import { useSearchParams } from "@/lib/url-search";
import { useIsPlatformAdmin } from "../hooks";
import { documentsText, graceText, type Migration, type MigrationStatus, migrationsQuery, statusLabels, statusTone } from "./common";
import { MigrationPage } from "./migration-record";
import p from "./profile-migrations.module.css";
import { StartMigrationDialog } from "./start-dialog";

function progressCell(m: Migration) {
  if (m.status === "running") {
    return (
      <Meter
        className={p.progress}
        size="sm"
        hideLabel
        label={`Progress of ${m.kb.name}`}
        value={m.progress.done}
        max={Math.max(m.progress.documents, 1)}
        valueText={documentsText(m.progress.done, m.progress.documents)}
        warningAt={2}
        criticalAt={2}
        showStatus={false}
        description={m.progress.failed ? `${m.progress.failed} failed` : undefined}
      />
    );
  }
  return <span className={p.nowrap}>{graceText(m) ?? "—"}</span>;
}

const columns: DataTableColumn<Migration>[] = [
  {
    id: "kb",
    header: "Knowledge base",
    accessor: (m) => `${m.kb.name} ${m.teamName}`,
    sortable: true,
    rowHeader: true,
    hideable: false,
    cell: (m) => <CellText primary={m.kb.name} secondary={m.teamName} />,
  },
  {
    id: "profiles",
    header: "Profiles",
    accessor: (m) => `${m.fromProfile.name} ${m.toProfile.name}`,
    cell: (m) => (
      <span className={p.route}>
        {m.fromProfile.name} <ArrowRight aria-label="to" /> {m.toProfile.name}
      </span>
    ),
  },
  { id: "status", header: "Status", accessor: (m) => statusLabels[m.status], sortable: true, cell: (m) => <StatusBadge tone={statusTone[m.status]}>{statusLabels[m.status]}</StatusBadge> },
  { id: "progress", header: "Progress", accessor: (m) => (m.progress.documents ? m.progress.done / m.progress.documents : 0), cell: progressCell },
  timeColumn<Migration>("startedAt", "Started", (m) => m.startedAt),
  { ...timeColumn<Migration>("switchedAt", "Switched", (m) => m.switchedAt), defaultHidden: true },
];

const facets: Facet<Migration>[] = [
  {
    id: "status",
    label: "Status",
    type: "toggle",
    allLabel: "All",
    accessor: (m) => m.status,
    options: (Object.keys(statusLabels) as MigrationStatus[]).map((v) => ({ value: v, label: statusLabels[v] })),
  },
];

export function ProfileMigrationsPage() {
  const isAdmin = useIsPlatformAdmin();
  const migrations = useQuery(migrationsQuery());
  const record = useRecordParam();
  const [params, setParams] = useSearchParams();
  const startFor = params.get("start") ?? undefined;
  const [starting, setStarting] = useState(false);
  const closeStart = () => {
    setStarting(false);
    if (!startFor) return;
    setParams(
      (q) => {
        const out = new URLSearchParams(q);
        out.delete("start");
        return out;
      },
      { replace: true },
    );
  };
  const actions = (m: Migration): ActionItem[] => [{ label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(m.id) }];
  const start = isAdmin && (
    <Button onClick={() => setStarting(true)}>
      <Plus aria-hidden /> Migrate a knowledge base
    </Button>
  );
  return (
    <>
      <ListPage<Migration>
        id="admin-profile-migrations"
        title="Profile migrations"
        description="Move a knowledge base to another embedding profile without downtime: its sources are re-embedded in the background, then it switches in one step. The old vectors are kept for a grace period, so it can switch back."
        primaryAction={start}
        caption="Profile migrations"
        columns={columns}
        data={migrations.data ?? []}
        getRowId={(m) => m.id}
        rowLabel={(m) => `${m.kb.name}: ${m.fromProfile.name} to ${m.toProfile.name}`}
        facets={facets}
        loading={migrations.isLoading}
        error={migrations.error}
        onRetry={() => void migrations.refetch()}
        onRowClick={(m) => record.open(m.id)}
        rowActions={actions}
        empty={{
          icon: <Shuffle />,
          title: "No profile migrations yet.",
          description: "Create the new embedding profile first, then migrate each knowledge base to it.",
          action: start || undefined,
        }}
      />
      <MigrationPage id={record.id} onClose={record.close} isAdmin={isAdmin} />
      {isAdmin && (starting || startFor) && (
        <StartMigrationDialog
          initialKB={startFor}
          onClose={closeStart}
          onStarted={(m) => {
            closeStart();
            record.open(m.id);
          }}
        />
      )}
    </>
  );
}
