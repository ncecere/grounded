/* One audit entry in a RecordPage (A3): who, what, when, the target and a before/after diff (with model, connection and profile ids named). */
import { useQuery } from "@tanstack/react-query";
import type { Schemas } from "@/api/client";
import { actionLabel, actorName, nameIds } from "@/components/audit/labels";
import { AuditTarget } from "@/components/audit/target";
import { RelativeTime } from "@/components/templates/list-page";
import { RecordPage, type RecordSection } from "@/components/templates/record-page";
import { CodeBlock } from "@/components/ui/code-block/code-block";
import { DiffViewer } from "@/components/ui/diff-viewer/diff-viewer";
import s from "../../shared.module.css";
import { useConnections, useModels } from "../models/common";
import { profilesQuery } from "../overview/queries";

type Entry = Schemas["AuditEntry"];

/** Catalog ids (models, connections, embedding profiles) and their names, from the admin lists (cached). */
function useCatalogNames(enabled: boolean): Map<string, string> {
  const models = useModels();
  const connections = useConnections();
  const profiles = useQuery({ ...profilesQuery(), enabled });
  const out = new Map<string, string>();
  for (const m of models.data ?? []) out.set(m.id.toLowerCase(), m.displayName);
  for (const c of connections.data ?? []) out.set(c.id.toLowerCase(), c.name);
  for (const p of profiles.data ?? []) out.set(p.id.toLowerCase(), p.name);
  return out;
}

export function auditSections(e: Entry, names: ReadonlyMap<string, string> = new Map()): RecordSection[] {
  const out: RecordSection[] = [];
  if (e.before != null || e.after != null) {
    out.push({
      title: "Before and after",
      content: (
        <DiffViewer
          label={`Changes by ${actionLabel(e.action)}`}
          before={nameIds(e.before ?? {}, names) as object}
          after={nameIds(e.after ?? {}, names) as object}
          format="json"
          defaultMode="split"
        />
      ),
    });
  }
  if (Object.keys(e.metadata).length > 0) {
    out.push({ title: "Details", content: <CodeBlock code={JSON.stringify(e.metadata, null, 2)} language="json" /> });
  }
  return out;
}

type Props = { entry: Entry | undefined; open: boolean; loading: boolean; onClose: () => void };

export function AuditEntryPage({ entry, open, loading, onClose }: Props) {
  const names = useCatalogNames(open);
  return (
    <RecordPage
      open={open}
      onClose={onClose}
      title={entry ? actionLabel(entry.action) : "Audit entry"}
      description="One entry of the platform audit log."
      loading={loading && !entry}
      error={!loading && open && !entry ? new Error("This entry isn't in the loaded part of the log. Load more or change the filters.") : undefined}
      facts={
        entry
          ? [
              { label: "When", value: <RelativeTime value={entry.occurredAt} /> },
              { label: "Who", value: entry.actor.email && entry.actor.displayName ? `${actorName(entry.actor)} (${entry.actor.email})` : actorName(entry.actor) },
              { label: "Action", value: <code className={s.mono}>{entry.action}</code> },
              { label: "Target", value: <AuditTarget entry={entry} scope={{ kind: "platform" }} /> },
              { label: "Request ID", value: <code className={s.mono}>{entry.requestId || "—"}</code> },
            ]
          : []
      }
      sections={entry ? auditSections(entry, names) : []}
    />
  );
}
