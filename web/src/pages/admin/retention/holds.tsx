/*
 * Admin → Retention › Legal holds (DESIGN.md §8, docs/operations/retention.md;
 * a page of its own until v0.2.1, I1): holds on a user, team, agent or
 * conversation, optionally for a date range. A hold stops every retention
 * deletion of what it covers and never expires; a platform admin releases it
 * with a reason. Only platform admins and auditors see holds. A Status filter
 * (?status=active|released) replaces the old page's Active · Released · All
 * tabs; a hold opens as a record page (?record=). "Place a hold" is the
 * Retention header's primary on this tab.
 */
import { useQuery } from "@tanstack/react-query";
import { Eye, Lock, LockOpen, Scale } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { ListPage, timeColumn, useListFilters } from "@/components/templates/list-page";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import type { Facet } from "@/components/ui/filter-bar/filter-bar";
import { formatDate } from "@/lib/format";
import s from "../../shared.module.css";
import { ReleaseHoldDialog, holdsKey } from "./hold-dialogs";
import { rangeText, scopeTypeLabels } from "./labels";
import r from "./retention.module.css";

type Hold = Schemas["LegalHold"];

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
const by = (p: Hold["createdBy"]) => (p ? p.displayName || p.email : "Unknown");
const scopeName = (h: Hold) => `${h.scopeLabel || h.scopeId}${h.scopeExists ? "" : " (deleted)"}`;
/** A hold's name, told apart from other holds on the same team by the day it was placed: "Hold on QA Team, placed Sep 29, 2026". */
export const holdName = (h: Hold) => `Hold on ${scopeName(h)}, placed ${new Date(h.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}`;

const columns: DataTableColumn<Hold>[] = [
  {
    id: "scope",
    header: "Covers",
    accessor: (h) => `${scopeTypeLabels[h.scopeType]} ${h.scopeLabel}`,
    rowHeader: true,
    hideable: false,
    cell: (h) => <CellText primary={scopeName(h)} secondary={[scopeTypeLabels[h.scopeType], h.scopeContext].filter(Boolean).join(" · ")} />,
  },
  {
    id: "reason",
    header: "Reason",
    accessor: "reason",
    cell: (h) => (
      <span className={r.reason} title={h.reason}>
        {h.reason}
      </span>
    ),
  },
  { id: "dates", header: "Data from", accessor: (h) => rangeText(h.coversFrom, h.coversTo, day), cell: (h) => <span className={s.muted}>{rangeText(h.coversFrom, h.coversTo, day)}</span> },
  {
    id: "conversations",
    header: "Conversations kept",
    accessor: (h) => h.conversations,
    numeric: true,
    cell: (h) => <CellText primary={h.conversations.toLocaleString()} secondary={h.deletedConversations ? `${h.deletedConversations.toLocaleString()} deleted by users` : undefined} />,
  },
  { id: "status", header: "Status", accessor: "status", sortable: true, cell: (h) => <HoldStatus hold={h} /> },
  { ...timeColumn<Hold>("createdAt", "Placed", (h) => h.createdAt), defaultHidden: false },
];

function HoldStatus({ hold }: { hold: Hold }) {
  return hold.status === "active" ? <StatusBadge tone="warning">Active</StatusBadge> : <StatusBadge tone="neutral">Released</StatusBadge>;
}

const facets: Facet<Hold>[] = [
  {
    id: "status",
    label: "Status",
    type: "toggle",
    allLabel: "All",
    accessor: (h) => h.status,
    options: [
      { value: "active", label: "Active", icon: <Lock aria-hidden /> },
      { value: "released", label: "Released", icon: <LockOpen aria-hidden /> },
    ],
  },
];

/** The table's text when the filters match nothing: "No active legal holds.", or "No legal holds match “smith”." */
function noResults(status: string | undefined, query: string) {
  const title = query.trim() ? `No legal holds match “${query.trim()}”.` : status === "active" || status === "released" ? `No ${status} legal holds.` : "No legal holds match.";
  return <EmptyState size="compact" icon={<Scale />} title={title} />;
}

/** Every hold, active ones first, filtered by status in the list ("Place a hold" is the Retention header's primary). */
export function LegalHoldsTab({ isAdmin }: { isAdmin: boolean }) {
  const record = useRecordParam();
  const filters = useListFilters(facets);
  const status = (filters.values.status as string[] | undefined)?.[0];
  const holds = useQuery({ queryKey: [...holdsKey, "all"], queryFn: async () => unwrap(await api.GET("/v1/admin/legal-holds", { params: { query: { status: "all" } } })) });
  const [releasing, setReleasing] = useState<Hold | null>(null);
  return (
    <Stack gap={4}>
      <p className={s.settingDescription}>
        A legal hold stops every retention deletion of what it covers, including conversations their users delete, until a platform admin releases it. Holds
        never expire. Only platform admins and auditors see them.
      </p>
      <ListPage<Hold>
        id="admin-legal-holds"
        caption="Legal holds"
        columns={columns}
        data={holds.data ?? []}
        getRowId={(h) => h.id}
        rowLabel={holdName}
        facets={facets}
        search={{ label: "Search holds", placeholder: "Name or reason" }}
        loading={holds.isLoading}
        error={holds.error}
        onRetry={() => void holds.refetch()}
        onRowClick={(h) => record.open(h.id)}
        rowActions={(h) => [
          { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(h.id) },
          { label: "Release hold", danger: true, hidden: !isAdmin || h.status !== "active", onSelect: () => setReleasing(h) },
        ]}
        // No action here: the header's "Place a hold" is the view's one primary.
        empty={{ icon: <Scale />, title: "No legal holds.", description: "Retention deletes what's past its period as set." }}
        tableProps={{ defaultSort: { columnId: "status", direction: "ascending" }, noResults: noResults(status, filters.query) }}
      />
      <HoldSheet id={record.id} onClose={record.close} isAdmin={isAdmin} onRelease={setReleasing} />
      {releasing && <ReleaseHoldDialog hold={releasing} onClose={() => setReleasing(null)} />}
    </Stack>
  );
}

function HoldSheet({ id, onClose, isAdmin, onRelease }: { id?: string; onClose: () => void; isAdmin: boolean; onRelease: (h: Hold) => void }) {
  const hold = useQuery({
    queryKey: [...holdsKey, "one", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await api.GET("/v1/admin/legal-holds/{holdId}", { params: { path: { holdId: id! } } })),
  });
  const h = hold.data;
  const focusAfterRelease = useFocusHeadingAfterRelease(h?.status);
  return (
    <RecordPage
      open={Boolean(id)}
      onClose={onClose}
      title={h ? holdName(h) : "Legal hold"}
      description="What a legal hold covers and keeps from retention."
      loading={hold.isLoading}
      error={hold.error}
      facts={
        h && [
          { label: "Status", value: <HoldStatus hold={h} /> },
          { label: "Covers", value: `${scopeTypeLabels[h.scopeType]}: ${scopeName(h)}${h.scopeContext ? ` (${h.scopeContext})` : ""}` },
          { label: "Hold ID", value: <code className={s.mono}>{h.id}</code> },
          { label: `${scopeTypeLabels[h.scopeType]} ID`, value: <code className={s.mono}>{h.scopeId}</code> },
          { label: "Data from", value: rangeText(h.coversFrom, h.coversTo, day) },
          { label: "Placed", value: `${formatDate(h.createdAt)} by ${by(h.createdBy)}` },
          { label: "Released", value: h.releasedAt ? `${formatDate(h.releasedAt)} by ${by(h.releasedBy)}` : "" },
          { label: "Conversations covered", value: <Badge tone="info">{h.conversations.toLocaleString()}</Badge> },
        ]
      }
      sections={
        h
          ? [
              { title: "Reason", content: <p className={r.prewrap}>{h.reason}</p> },
              ...(h.releaseReason ? [{ title: "Why it was released", content: <p className={r.prewrap}>{h.releaseReason}</p> }] : []),
            ]
          : []
      }
      actions={
        h && isAdmin && h.status === "active" ? (
          <Button variant="danger" onClick={() => onRelease(h)}>
            Release hold
          </Button>
        ) : undefined
      }
    >
      <span ref={focusAfterRelease} hidden />
      {h && h.deletedConversations > 0 && (
        <Alert
          tone="warning"
          title={`${h.deletedConversations.toLocaleString()} deleted by their users, ${h.status === "active" ? "kept by this hold" : "kept until this hold was released"}`}
        >
          {h.status === "active"
            ? "Their users deleted these conversations and no longer see them. This hold keeps them stored until it's released; then retention removes them as usual."
            : "Their users deleted these conversations. With the hold released, retention removes them as usual."}
        </Alert>
      )}
    </RecordPage>
  );
}

/**
 * After "Release hold" the button is gone, so focus would fall to the page: move it to the record page's heading
 * instead. The returned ref goes on an element inside the record page.
 */
function useFocusHeadingAfterRelease(status: Hold["status"] | undefined) {
  const marker = useRef<HTMLSpanElement>(null);
  const was = useRef(status);
  useEffect(() => {
    const released = was.current === "active" && status === "released";
    was.current = status;
    if (!released) return;
    // After the dialog has closed and tried to return focus to the (now removed) button.
    const frame = requestAnimationFrame(() => marker.current?.closest("section")?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [status]);
  return marker;
}
