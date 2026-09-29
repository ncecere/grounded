/* One audit entry in a RecordPage (A3): who, what, when, the target and what changed, field by field in plain words (with model, connection and profile ids named). */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, unwrap, type Schemas } from "@/api/client";
import { auditChange } from "@/components/audit/changes";
import { AuditChangesTable } from "@/components/audit/changes-table";
import { actionLabel, actorName, nameIds } from "@/components/audit/labels";
import { AuditTarget } from "@/components/audit/target";
import { RecordPage, type RecordSection } from "@/components/templates/record-page";
import { CodeBlock } from "@/components/ui/code-block/code-block";
import { TextLink } from "@/components/ui/text-link/text-link";
import { Time } from "@/components/ui/time/time";
import { useCostSettings } from "@/lib/costs";
import s from "../../shared.module.css";
import { useConnections, useModels } from "../models/common";
import { profilesQuery } from "../overview/queries";

type Entry = Schemas["AuditEntry"];

/** The team a team's entry belongs to, linked to its admin page ("Deleted team" when it's gone). */
export function AuditTeam({ entry }: { entry: Pick<Entry, "teamId" | "teamName" | "teamSlug"> }) {
  if (!entry.teamName || !entry.teamSlug) return <span className={s.muted}>Deleted team</span>;
  return <TextLink render={<Link to="/admin/teams/$team" params={{ team: entry.teamSlug }} />}>{entry.teamName}</TextLink>;
}

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

/** The before and after (in words: auditChange) and the raw metadata. `currency` is the platform's, when the viewer can read it. */
export function auditSections(e: Entry, names: ReadonlyMap<string, string> = new Map(), currency?: string): RecordSection[] {
  const out: RecordSection[] = [];
  if (e.before != null || e.after != null) {
    const change = auditChange(e, currency);
    out.push({
      title: "Changes",
      content: (
        <AuditChangesTable label={`What changed: ${actionLabel(e.action)}`} before={nameIds(change.before, names) as object} after={nameIds(change.after, names) as object} />
      ),
    });
  }
  if (Object.keys(e.metadata).length > 0) {
    out.push({ title: "Metadata", content: <CodeBlock code={JSON.stringify(e.metadata, null, 2)} language="json" /> });
  }
  return out;
}

/** `id` is the open entry (?record=); `listed` is it from the loaded list, if there. Otherwise it's fetched by id. */
type Props = { id: string | undefined; listed: Entry | undefined; onClose: () => void };

export function AuditEntryPage({ id, listed, onClose }: Props) {
  const open = Boolean(id);
  const fetched = useQuery({
    queryKey: ["admin", "audit", "entry", id],
    queryFn: async () => unwrap(await api.GET("/v1/admin/audit/{entryId}", { params: { path: { entryId: Number(id) } } })),
    enabled: open && !listed && /^\d+$/.test(id ?? ""),
    retry: false,
  });
  const entry = listed ?? fetched.data;
  const missing = open && !entry && (fetched.isError || !/^\d+$/.test(id ?? ""));
  const names = useCatalogNames(open);
  const currency = useCostSettings(open && Boolean(entry?.action.startsWith("costs."))).data?.currency;
  return (
    <RecordPage
      open={open}
      onClose={onClose}
      title={entry ? actionLabel(entry.action) : "Audit entry"}
      description="One entry of the platform audit log."
      loading={!entry && !missing}
      error={missing ? new Error("This audit entry doesn't exist, or the link is wrong.") : undefined}
      facts={
        entry
          ? [
              { label: "When", value: <Time value={entry.occurredAt} format="datetime" /> },
              { label: "Who", value: entry.actor.email && entry.actor.displayName ? `${actorName(entry.actor, entry)} (${entry.actor.email})` : actorName(entry.actor, entry) },
              ...(entry.teamId ? [{ label: "Team", value: <AuditTeam entry={entry} /> }] : []),
              { label: "Action", value: <code className={s.mono}>{entry.action}</code> },
              { label: "Target", value: <AuditTarget entry={entry} scope={{ kind: "platform" }} /> },
              { label: "Request ID", value: <code className={s.mono}>{entry.requestId || "—"}</code> },
            ]
          : []
      }
      sections={entry ? auditSections(entry, names, currency) : []}
    />
  );
}
