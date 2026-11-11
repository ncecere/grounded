/* A connector source's syncs (docs/source-types.md): Sync now, the running sync, and the history. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, FilePlus2, History, RefreshCw, SkipForward, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, errorMessage, limitError } from "../../api/client";
import { formatDate } from "../../lib/format";
import { type MaintenanceStatus, maintenanceReason, useMaintenance } from "../../lib/maintenance";
import { RelativeTime } from "@/components/templates/list-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Loading } from "@/components/ui/spinner/spinner";
import { StatCard } from "@/components/ui/stat-card/stat-card";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { toast } from "@/components/ui/toast/toast";
import type { Tone } from "@/lib/bitop-utils";
import s from "../shared.module.css";
import { formatDuration } from "./crawls";
import { type DataSource, type SourceOwner, type SourceSync, useSourceOwner } from "./owner";
import w from "./crawls.module.css";

type Status = SourceSync["status"];

export const syncStatusLabels: Record<Status, string> = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
const tones: Record<Status, Tone> = { queued: "neutral", running: "info", completed: "success", failed: "danger", cancelled: "warning" };
const triggers: Record<SourceSync["trigger"], string> = { create: "Source created", manual: "Manual", schedule: "Scheduled" };

export const isActiveSync = (x?: SourceSync | null): x is SourceSync => !!x && (x.status === "queued" || x.status === "running");

/** Why a sync ended before the end of its listing, in words. */
export function stoppedText(reason: string): string | undefined {
  if (!reason) return undefined;
  if (reason === "limit:documents") return "Stopped: your team reached its documents limit. Nothing was removed.";
  if (reason === "limit:storage_bytes") return "Stopped: your team reached its storage limit. Nothing was removed.";
  if (reason.startsWith("limit:")) return "Stopped: your team reached a limit. Nothing was removed.";
  const known: Record<string, string> = {
    cancelled: "Cancelled. What it had added was kept.",
    paused: "Not run: the source was paused.",
    type_off: "Not run: a platform admin turned this source type off.",
    maintenance: "Not run: the platform was in maintenance.",
  };
  return known[reason] ?? `Stopped: ${reason}.`;
}

function SyncStatusBadge({ sync }: { sync: SourceSync }) {
  return (
    <StatusBadge tone={tones[sync.status]} pulse={sync.status === "running"}>
      {syncStatusLabels[sync.status]}
    </StatusBadge>
  );
}

function setActiveSync(qc: ReturnType<typeof useQueryClient>, owner: SourceOwner, sourceId: string, sync: SourceSync | null) {
  qc.setQueryData<DataSource>(owner.keys.source(sourceId), (old) => old && { ...old, activeSync: isActiveSync(sync) ? sync : null });
}

function invalidateSource(qc: ReturnType<typeof useQueryClient>, owner: SourceOwner, sourceId: string) {
  // The source key prefixes its documents and syncs.
  qc.invalidateQueries({ queryKey: owner.keys.source(sourceId) });
  qc.invalidateQueries({ queryKey: owner.keys.list });
}

/** Why Sync now is unavailable, or undefined when it's available. */
export function connectorSyncBlocked(source: DataSource, maintenance?: MaintenanceStatus | null) {
  if (source.status === "paused") return "Activate this source to sync it.";
  if (source.connector && !source.connector.available) return "This server doesn't have this source's connector, so it can't sync. Its documents stay searchable.";
  if (isActiveSync(source.activeSync)) return "A sync is running. You can sync again when it finishes.";
  if (maintenance) return maintenanceReason(maintenance, "Syncing");
  return undefined;
}

/** Sync now, and Sync everything (a full listing, which also finds what the provider no longer has). */
export function ConnectorSyncButton({ source, reasonId }: { source: DataSource; reasonId?: string }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const maintenance = useMaintenance(owner.canEdit);
  const start = useMutation({
    mutationFn: (full: boolean) => owner.api.connector!.sync(source.id, full),
    onSuccess: (sync) => {
      setActiveSync(qc, owner, source.id, sync);
      toast.success("Sync started", "Its progress is shown on this page.");
    },
    onError: (err) => {
      const l = limitError(err);
      if (err instanceof ApiError && err.code === "sync_in_progress") {
        const sync = err.details?.sync as SourceSync | undefined;
        if (sync) setActiveSync(qc, owner, source.id, sync);
        toast.info("A sync is already running", "Its progress is shown on this page.");
      } else if (l) toast.error(l.title, l.message);
      else toast.error("Couldn't start a sync", errorMessage(err));
    },
    onSettled: () => invalidateSource(qc, owner, source.id),
  });
  if (!owner.canEdit || !owner.api.connector) return null;
  const reason = connectorSyncBlocked(source, maintenance);
  return (
    <>
      <Button variant="secondary" loading={start.isPending && start.variables === true} disabled={!!reason || start.isPending} aria-describedby={reason ? reasonId : undefined} onClick={() => start.mutate(true)}>
        Sync everything
      </Button>
      <Button loading={start.isPending && start.variables === false} disabled={!!reason || start.isPending} aria-describedby={reason ? reasonId : undefined} onClick={() => start.mutate(false)}>
        <RefreshCw aria-hidden /> Sync now
      </Button>
    </>
  );
}

/** The queued or running sync: live counts and Cancel. */
export function ActiveSyncPanel({ source, sync }: { source: DataSource; sync: SourceSync }) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancel = useMutation({
    mutationFn: () => owner.api.connector!.cancelSync(source.id, sync.id),
    onSuccess: (done) => {
      setConfirming(false);
      setActiveSync(qc, owner, source.id, done);
      toast.info("Sync cancelled", "What it had added is kept.");
    },
    onSettled: () => invalidateSource(qc, owner, source.id),
  });
  const n = (v: number) => v.toLocaleString();
  const queued = sync.status === "queued";
  return (
    <Card
      title={queued ? "Sync queued" : "Sync in progress"}
      description={`${triggers[sync.trigger]}${sync.full ? ", everything" : ", what changed"} · ${sync.startedAt ? `started ${formatDate(sync.startedAt)}` : `queued ${formatDate(sync.createdAt)}`}. Updates every 2 seconds.`}
      actions={
        owner.canEdit && (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Cancel sync
          </Button>
        )
      }
    >
      <div className={w.crawlBody}>
        <div className={w.crawlMeta}>
          <SyncStatusBadge sync={sync} />
          <span>{queued ? "Waiting for a free worker" : `${n(sync.itemsAdded + sync.itemsChanged + sync.itemsUnchanged + sync.itemsSkipped)} items checked`}</span>
        </div>
        <p role="status" className="sr-only">
          {queued ? "Sync queued." : "Sync running."}
        </p>
        <section aria-label="Sync counts" className={w.crawlStats}>
          <StatCard label="Added" value={n(sync.itemsAdded)} icon={<FilePlus2 />} />
          <StatCard label="Changed" value={n(sync.itemsChanged)} icon={<RefreshCw />} />
          <StatCard label="Unchanged" value={n(sync.itemsUnchanged)} icon={<CheckCheck />} hint="Not read again" />
          <StatCard label="Skipped" value={n(sync.itemsSkipped)} icon={<SkipForward />} hint="Not indexed" />
        </section>
      </div>
      <AlertDialog
        open={confirming}
        onOpenChange={(o) => {
          setConfirming(o);
          if (!o) cancel.reset();
        }}
        title="Cancel this sync?"
        description="It stops before its next item. What it added or changed is kept, and nothing is removed from the source."
        confirmLabel="Cancel sync"
        cancelLabel="Keep syncing"
        busy={cancel.isPending}
        error={cancel.error}
        onConfirm={() => cancel.mutate()}
      />
    </Card>
  );
}

/** Refreshes the source's documents and history when its active sync ends. */
export function useSyncFinished(source: DataSource | undefined) {
  const owner = useSourceOwner();
  const qc = useQueryClient();
  const last = useRef<string | null>(null);
  const activeId = isActiveSync(source?.activeSync) ? source.activeSync.id : null;
  useEffect(() => {
    if (last.current && !activeId && source) {
      qc.invalidateQueries({ queryKey: owner.keys.syncs(source.id) });
      qc.invalidateQueries({ queryKey: owner.keys.documents(source.id) });
      qc.invalidateQueries({ queryKey: owner.keys.list });
      toast.info("Sync finished", "The sync history has the details.");
    }
    last.current = activeId;
  }, [activeId, owner, qc, source]);
}

const removalLabels: Record<Exclude<SourceSync["removals"], "">, { label: string; tone: Tone }> = {
  pending: { label: "Removals waiting", tone: "warning" },
  confirmed: { label: "Removals confirmed", tone: "neutral" },
  dismissed: { label: "Removals dismissed", tone: "neutral" },
  superseded: { label: "Decided by a later sync", tone: "neutral" },
};

/** The first of a sync's skipped items, with the reason each was left out. */
function Problems({ sync }: { sync: SourceSync }) {
  if (sync.problems.length === 0) return null;
  return (
    <details className={w.problems}>
      <summary>
        {sync.itemsSkipped.toLocaleString()} skipped{sync.itemsSkipped > sync.problems.length ? ` (the first ${sync.problems.length})` : ""}
      </summary>
      <ul>
        {sync.problems.map((p, i) => (
          <li key={`${p.id}-${i}`}>
            <strong>{p.title || p.id}</strong>: {p.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SyncHistory({ source }: { source: DataSource }) {
  const owner = useSourceOwner();
  const active = isActiveSync(source.activeSync);
  const syncs = useQuery({
    queryKey: owner.keys.syncs(source.id),
    queryFn: () => owner.api.connector!.syncs(source.id),
    enabled: !!owner.api.connector,
    refetchInterval: active ? 2000 : false,
  });
  const list = syncs.data ?? [];
  if (syncs.isLoading) return <Loading label="Loading sync history…" />;
  if (syncs.error)
    return (
      <div className={s.pad}>
        <ErrorAlert error={syncs.error} />
      </div>
    );
  if (list.length === 0) return <EmptyState size="compact" icon={<History />} title="No syncs yet." />;
  return (
    <Table
      caption="Sync history"
      columns={[
        "Status",
        "Trigger",
        "Started",
        { label: "Duration", numeric: true },
        { label: "Added", numeric: true },
        { label: "Changed", numeric: true },
        { label: "Unchanged", numeric: true },
        { label: "Removed", numeric: true },
      ]}
    >
      {list.map((x) => (
        <Tr key={x.id}>
          <Td>
            <span className={w.cellStack}>
              <SyncStatusBadge sync={x} />
              {x.removals !== "" && (
                <Badge tone={removalLabels[x.removals].tone} variant="outline">
                  {removalLabels[x.removals].label}
                </Badge>
              )}
            </span>
            {x.error && <span className={s.dangerText}>{x.error}</span>}
            {stoppedText(x.stoppedReason) && <span className={s.secondary}>{stoppedText(x.stoppedReason)}</span>}
            {x.permissionsChanged > 0 && <span className={s.secondary}>Permissions changed on {x.permissionsChanged.toLocaleString()}</span>}
            <Problems sync={x} />
          </Td>
          <Td muted>
            {triggers[x.trigger]}
            {x.full ? ", everything" : ""}
          </Td>
          <Td muted nowrap>
            <RelativeTime value={x.startedAt ?? x.createdAt} />
          </Td>
          <Td numeric>{formatDuration(x.startedAt, x.finishedAt)}</Td>
          <Td numeric>{x.itemsAdded.toLocaleString()}</Td>
          <Td numeric>{x.itemsChanged.toLocaleString()}</Td>
          <Td numeric>{x.itemsUnchanged.toLocaleString()}</Td>
          <Td numeric>
            {x.itemsRemoved.toLocaleString()}
            {x.removals === "pending" && (
              <span className={s.secondary}>
                <Trash2 aria-hidden size={12} /> {x.removalsPending.toLocaleString()} waiting
              </span>
            )}
          </Td>
        </Tr>
      ))}
    </Table>
  );
}
