/*
 * An audit log table (team or platform): When / Who / Action / Target /
 * Details, newest first, with Load more. Filters come from AuditFilterBar.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileClock } from "lucide-react";
import { api, unwrap, type Schemas } from "../../api/client";
import { formatDate } from "../../lib/format";
import s from "../../pages/shared.module.css";
import { LoadMore, QueryView } from "../query-view";
import { Disclosure } from "@/components/ui/disclosure/disclosure";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Table, Td, Tr } from "@/components/ui/table/table";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { actedVia, actionLabel, actorName } from "./labels";
import { type AuditScope, AuditTarget } from "./target";
import a from "./audit.module.css";

type AuditEntry = Schemas["AuditEntry"];

/** Server-side filters: action (exact or "group."), person, and a [from, to) window as ISO times. */
export type AuditFilters = { action?: string; actorUserId?: string; from?: string; to?: string };

export const auditKey = (scope: AuditScope) => (scope.kind === "team" ? ["team", scope.team, "audit"] : ["admin", "audit"]);

async function fetchAudit(scope: AuditScope, filters: AuditFilters, cursor: string | undefined, limit: number) {
  const query = { ...filters, cursor, limit };
  return scope.kind === "team"
    ? unwrap(await api.GET("/v1/teams/{team}/audit", { params: { path: { team: scope.team }, query } }))
    : unwrap(await api.GET("/v1/admin/audit", { params: { query } }));
}

type AuditLogProps = {
  scope: AuditScope;
  filters?: AuditFilters;
  /** Entries per page (default 50). */
  pageSize?: number;
  /** Show one page only, without Load more (e.g. recent activity on an overview). */
  single?: boolean;
  /** Accessible name of the table. */
  caption?: string;
  /** Shown when there are no entries (default: "No audit entries yet."). */
  emptyTitle?: string;
};

/** Render it in a flush card. */
export function AuditLog({ scope, filters = {}, pageSize = 50, single, caption = "Audit log", emptyTitle }: AuditLogProps) {
  const q = useInfiniteQuery({
    queryKey: [...auditKey(scope), filters, pageSize],
    queryFn: ({ pageParam }) => fetchAudit(scope, filters, pageParam, pageSize),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (single ? undefined : (last.nextCursor ?? undefined)),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.values(filters).some(Boolean);
  const empty = (
    <EmptyState size="compact" icon={<FileClock />} title={emptyTitle ?? (filtered ? "No entries match these filters." : "No audit entries yet.")} />
  );
  return (
    <QueryView query={q} loadingLabel="Loading audit log…" empty={items.length === 0 && empty}>
      <Table caption={caption} columns={["When", "Who", "Action", "Target", "Details"]}>
        {items.map((e) => (
          <AuditRow key={e.id} entry={e} scope={scope} />
        ))}
      </Table>
      <LoadMore query={q} />
    </QueryView>
  );
}

function Who({ entry }: { entry: AuditEntry }) {
  const { actor } = entry;
  // A group mapping rule's change names the rule in the actor ("System (group mapping: …)").
  const name = actorName(actor, entry);
  const secondary = actedVia(entry) ?? (actor.kind === "user" && actor.displayName ? actor.email : undefined);
  return (
    <>
      <span className={actor.kind === "system" ? s.muted : s.primary}>{name}</span>
      {secondary && <span className={s.secondary}>{secondary}</span>}
    </>
  );
}

function AuditRow({ entry, scope }: { entry: AuditEntry; scope: AuditScope }) {
  const hasDetail = entry.before != null || entry.after != null || Object.keys(entry.metadata).length > 0;
  return (
    <Tr>
      <Td muted nowrap>
        {formatDate(entry.occurredAt)}
      </Td>
      <Td>
        <Who entry={entry} />
      </Td>
      <Td>
        <span className={a.action}>{actionLabel(entry.action, entry)}</span>
        <span className={`${s.secondary} ${s.mono}`}>{entry.action}</span>
      </Td>
      <Td className={a.target}>
        <AuditTarget entry={entry} scope={scope} />
      </Td>
      <Td>
        {hasDetail ? (
          <Disclosure
            className={a.details}
            title={
              <>
                Details<VisuallyHidden> of {actionLabel(entry.action, entry)}</VisuallyHidden>
              </>
            }
          >
            <pre className={s.pre}>{JSON.stringify({ before: entry.before, after: entry.after, metadata: entry.metadata }, null, 2)}</pre>
          </Disclosure>
        ) : (
          <span className={s.muted}>—</span>
        )}
      </Td>
    </Tr>
  );
}
