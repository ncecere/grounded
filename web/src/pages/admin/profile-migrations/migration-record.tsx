/*
 * One migration in a RecordPage (?record=<id>): facts, a meter per source
 * while it runs, the documents that failed, and its actions (Retry failed,
 * Cancel, Switch back, Delete old vectors now), each confirmed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RotateCcw, Undo2, X, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { RecordPage } from "@/components/templates/record-page";
import { Time } from "@/components/ui/time/time";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Meter } from "@/components/ui/meter/meter";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { formatDate } from "@/lib/format";
import s from "../../shared.module.css";
import { documentsText, estimateItems, graceText, type Migration, migrationQuery, migrationsKey, sourceStateLabels, sourceStateTone, statusLabels, statusTone } from "./common";
import p from "./profile-migrations.module.css";

type Action = "cancel" | "retry" | "switch-back" | "finish";
const done: Record<Action, (m: Migration) => string> = {
  cancel: (m) => `Migration of ${m.kb.name} cancelled`,
  retry: (m) => `Retrying the failed documents of ${m.kb.name}`,
  "switch-back": (m) => `${m.kb.name} is back on ${m.fromProfile.name}`,
  finish: (m) => `Old vectors of ${m.kb.name} are being deleted`,
};

const actionPaths = {
  cancel: "/v1/admin/profile-migrations/{migrationId}/cancel",
  retry: "/v1/admin/profile-migrations/{migrationId}/retry",
  "switch-back": "/v1/admin/profile-migrations/{migrationId}/switch-back",
  finish: "/v1/admin/profile-migrations/{migrationId}/finish",
} as const;

function useAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ m, action }: { m: Migration; action: Action }) =>
      unwrap(await api.POST(actionPaths[action], { params: { path: { migrationId: m.id }, header: ifMatch(m.revision) } })),
    onSuccess: (m, { action }) => {
      qc.setQueryData([...migrationsKey, m.id], m);
      void qc.invalidateQueries({ queryKey: migrationsKey });
      void qc.invalidateQueries({ queryKey: ["admin", "knowledge-bases"] });
      toast.success(done[action](m));
    },
  });
}

export function MigrationPage({ id, onClose, isAdmin }: { id?: string; onClose: () => void; isAdmin: boolean }) {
  const q = useQuery({ ...migrationQuery(id ?? ""), enabled: Boolean(id) });
  const m = q.data;
  const act = useAction();
  const [confirm, setConfirm] = useState<Action | null>(null);
  return (
    <>
      <RecordPage
        open={Boolean(id)}
        onClose={onClose}
        title={m ? `${m.kb.name}: ${m.fromProfile.name} → ${m.toProfile.name}` : "Profile migration"}
        description="Moving a knowledge base to another embedding profile."
        loading={q.isLoading}
        error={q.error}
        facts={m ? facts(m) : []}
        sections={m ? sections(m, act.error) : []}
        actions={m && isAdmin && <Actions m={m} onAction={setConfirm} busy={act.isPending} onRetry={() => act.mutate({ m, action: "retry" })} />}
      />
      {m && (
        <ConfirmMutationDialog
          target={confirm}
          onClose={() => setConfirm(null)}
          mutation={act}
          onConfirm={(action) => act.mutate({ m, action }, { onSuccess: () => setConfirm(null) })}
          tone={confirm === "switch-back" ? "primary" : "danger"}
          {...confirmText(m, confirm)}
        />
      )}
    </>
  );
}

function confirmText(m: Migration, action: Action | null) {
  switch (action) {
    case "cancel":
      return {
        title: `Cancel moving ${m.kb.name}?`,
        description: `It keeps searching ${m.fromProfile.name}. The vectors made for ${m.toProfile.name} so far are deleted (a shared source keeps them while another knowledge base needs them).`,
        confirmLabel: "Cancel migration",
      };
    case "switch-back":
      return {
        title: `Switch ${m.kb.name} back to ${m.fromProfile.name}?`,
        description: `Search and agents use ${m.fromProfile.name} again at once. The ${m.toProfile.name} vectors are deleted afterwards; moving again means a new migration.`,
        confirmLabel: "Switch back",
      };
    default:
      return {
        title: `Delete the old vectors of ${m.kb.name} now?`,
        description: `The ${m.fromProfile.name} vectors are deleted and switching back is no longer possible. A shared source keeps them while another knowledge base uses them.`,
        confirmLabel: "Delete old vectors",
      };
  }
}

function Actions({ m, onAction, onRetry, busy }: { m: Migration; onAction: (a: Action) => void; onRetry: () => void; busy: boolean }) {
  if (m.status === "running") {
    return (
      <>
        <Button variant="danger" onClick={() => onAction("cancel")}>
          <X aria-hidden /> Cancel migration
        </Button>
        {m.progress.failed > 0 && (
          <Button onClick={onRetry} loading={busy}>
            <RotateCcw aria-hidden /> Retry failed documents
          </Button>
        )}
      </>
    );
  }
  if (m.status !== "switched") return null;
  return (
    <>
      <Button variant="danger" onClick={() => onAction("finish")}>
        <Trash2 aria-hidden /> Delete old vectors now
      </Button>
      {m.canSwitchBack && (
        <Button onClick={() => onAction("switch-back")}>
          <Undo2 aria-hidden /> Switch back
        </Button>
      )}
    </>
  );
}

function facts(m: Migration) {
  const grace = graceText(m);
  return [
    { label: "Status", value: <StatusBadge tone={statusTone[m.status]}>{statusLabels[m.status]}</StatusBadge> },
    {
      label: "Knowledge base",
      value: (
        <>
          {m.kb.name} ·{" "}
          <TextLink render={<Link to="/admin/teams/$team" params={{ team: m.teamSlug }} />}>{m.teamName}</TextLink>
        </>
      ),
    },
    { label: "From", value: m.fromProfile.name },
    { label: "To", value: m.toProfile.name },
    { label: "Started", value: `${formatDate(m.startedAt)}${m.startedBy ? ` by ${m.startedBy.displayName || m.startedBy.email}` : ""}` },
    { label: "Switched", value: m.switchedAt ? <Time value={m.switchedAt} /> : undefined },
    { label: "Old vectors", value: grace ?? (m.status === "running" ? `Kept for ${m.graceDays} days after the switch` : undefined) },
    { label: "Finished", value: m.finishedAt ? <Time value={m.finishedAt} /> : undefined },
  ].filter((f) => f.value !== undefined);
}

function sections(m: Migration, error: unknown) {
  const out = [];
  if (error) out.push({ title: "Error", content: <ErrorAlert error={error} /> });
  if (m.status === "running") {
    out.push({
      title: "Progress",
      content: (
        <div className={p.meters}>
          <Meter
            label="All sources"
            value={m.progress.done}
            max={Math.max(m.progress.documents, 1)}
            valueText={documentsText(m.progress.done, m.progress.documents)}
            warningAt={2}
            criticalAt={2}
            showStatus={false}
            description={`${m.progress.sourcesComplete} of ${m.progress.sources} sources complete${m.progress.waiting ? ` · ${m.progress.waiting} waiting to retry` : ""}`}
          />
          {(m.sources ?? []).map((src) => (
            <Meter
              key={src.id}
              size="sm"
              label={
                <>
                  {src.name} <StatusBadge tone={sourceStateTone[src.state]}>{sourceStateLabels[src.state]}</StatusBadge>
                </>
              }
              value={src.done}
              max={Math.max(src.documents, 1)}
              valueText={documentsText(src.done, src.documents)}
              warningAt={2}
              criticalAt={2}
              showStatus={false}
              description={src.error || (src.failed ? `${src.failed} failed` : undefined)}
            />
          ))}
        </div>
      ),
    });
  }
  if (m.failures?.length) {
    out.push({
      title: "Failed documents",
      content: (
        <>
          <Alert tone="danger" title={`${m.progress.failed} documents couldn't be embedded`}>
            The knowledge base switches once they're done. Fix the cause (for example the model's input limit), then retry them.
          </Alert>
          <ul className={p.failures}>
            {m.failures.map((f) => (
              <li key={f.documentId} className={p.failure}>
                <span className={s.primary}>{f.title}</span>
                <span className={s.muted}>
                  {f.sourceName} · {f.code} · {f.attempts} {f.attempts === 1 ? "attempt" : "attempts"}
                </span>
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </>
      ),
    });
  }
  out.push({
    title: "Estimate at start",
    content: (
      <ul className={p.list}>
        {estimateItems(m.estimate).map((e) => (
          <li key={e.label}>
            {e.label}: {e.value}
          </li>
        ))}
      </ul>
    ),
  });
  return out;
}
