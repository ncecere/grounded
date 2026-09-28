/*
 * Admin → Legal holds (DESIGN.md §8, docs/operations/retention.md): holds on
 * a user, team, agent or conversation, optionally for a date range. A hold
 * stops every retention deletion of what it covers and never expires; a
 * platform admin releases it with a reason. Only platform admins and
 * auditors see holds. Tabs: Active · Released · All; a hold opens as a record page (?record=).
 */
import { useQuery } from "@tanstack/react-query";
import { Eye, Scale } from "lucide-react";
import { useState } from "react";
import { api, unwrap, type Schemas } from "@/api/client";
import { PageTabs, useUrlTab } from "@/components/page-tabs";
import { ListPage, timeColumn } from "@/components/templates/list-page";
import { RecordPage, useRecordParam } from "@/components/templates/record-page";
import { Alert } from "@/components/ui/alert/alert";
import { Badge, StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { formatDate } from "@/lib/format";
import { legalHoldTabs } from "@/lib/tabs";
import s from "../../shared.module.css";
import { useIsPlatformAdmin } from "../hooks";
import { PlaceHoldDialog, ReleaseHoldDialog, holdsKey } from "./hold-dialogs";
import { rangeText, scopeTypeLabels } from "./labels";
import r from "./retention.module.css";

type Hold = Schemas["LegalHold"];

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
const by = (p: Hold["createdBy"]) => (p ? p.displayName || p.email : "Unknown");
const scopeName = (h: Hold) => `${h.scopeLabel || h.scopeId}${h.scopeExists ? "" : " (deleted)"}`;

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
  { id: "status", header: "Status", accessor: "status", cell: (h) => <HoldStatus hold={h} /> },
  { ...timeColumn<Hold>("createdAt", "Placed", (h) => h.createdAt), defaultHidden: false },
];

function HoldStatus({ hold }: { hold: Hold }) {
  return hold.status === "active" ? <StatusBadge tone="warning">Active</StatusBadge> : <StatusBadge tone="neutral">Released</StatusBadge>;
}

export function LegalHoldsPage() {
  const isAdmin = useIsPlatformAdmin();
  const [tab, setTab] = useUrlTab(legalHoldTabs);
  const [placing, setPlacing] = useState(false);
  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title="Legal holds"
        description="A hold stops every retention deletion of what it covers, including conversations their users delete, until you release it. Holds never expire. Only platform admins and auditors see them."
        actions={isAdmin && <Button onClick={() => setPlacing(true)}>Place a hold</Button>}
      />
      <PageTabs
        label="Legal hold status"
        value={tab}
        onValueChange={setTab}
        tabs={legalHoldTabs.map((t) => ({ value: t, label: { active: "Active", released: "Released", all: "All" }[t], content: <HoldList status={t} isAdmin={isAdmin} onPlace={() => setPlacing(true)} /> }))}
      />
      {placing && <PlaceHoldDialog onClose={() => setPlacing(false)} />}
    </Stack>
  );
}

function HoldList({ status, isAdmin, onPlace }: { status: (typeof legalHoldTabs)[number]; isAdmin: boolean; onPlace: () => void }) {
  const record = useRecordParam();
  const holds = useQuery({ queryKey: [...holdsKey, status], queryFn: async () => unwrap(await api.GET("/v1/admin/legal-holds", { params: { query: { status } } })) });
  const [releasing, setReleasing] = useState<Hold | null>(null);
  return (
    <>
      <ListPage<Hold>
        id="admin-legal-holds"
        caption="Legal holds"
        columns={columns}
        data={holds.data ?? []}
        getRowId={(h) => h.id}
        rowLabel={(h) => `Hold on ${scopeName(h)}`}
        search={{ label: "Search holds", placeholder: "Name or reason" }}
        loading={holds.isLoading}
        error={holds.error}
        onRetry={() => void holds.refetch()}
        onRowClick={(h) => record.open(h.id)}
        rowActions={(h) => [
          { label: "View details", icon: <Eye aria-hidden />, onSelect: () => record.open(h.id) },
          { label: "Release hold", danger: true, hidden: !isAdmin || h.status !== "active", onSelect: () => setReleasing(h) },
        ]}
        empty={{
          icon: <Scale />,
          title: status === "released" ? "No released holds." : "No legal holds.",
          description: status === "released" ? undefined : "Retention deletes what's past its period as set.",
          action: isAdmin && status !== "released" ? <Button variant="secondary" onClick={onPlace}>Place a hold</Button> : undefined,
        }}
      />
      <HoldSheet id={record.id} onClose={record.close} isAdmin={isAdmin} onRelease={setReleasing} />
      {releasing && <ReleaseHoldDialog hold={releasing} onClose={() => setReleasing(null)} />}
    </>
  );
}

function HoldSheet({ id, onClose, isAdmin, onRelease }: { id?: string; onClose: () => void; isAdmin: boolean; onRelease: (h: Hold) => void }) {
  const hold = useQuery({
    queryKey: [...holdsKey, "one", id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await api.GET("/v1/admin/legal-holds/{holdId}", { params: { path: { holdId: id! } } })),
  });
  const h = hold.data;
  return (
    <RecordPage
      open={Boolean(id)}
      onClose={onClose}
      title={h ? `Hold on ${scopeName(h)}` : "Legal hold"}
      description="What a legal hold covers and keeps from retention."
      loading={hold.isLoading}
      error={hold.error}
      facts={
        h && [
          { label: "Status", value: <HoldStatus hold={h} /> },
          { label: "Covers", value: `${scopeTypeLabels[h.scopeType]}: ${scopeName(h)}${h.scopeContext ? ` (${h.scopeContext})` : ""}` },
          { label: "ID", value: <code className={s.mono}>{h.scopeId}</code> },
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
      {h && h.deletedConversations > 0 && (
        <Alert tone="warning" title={`${h.deletedConversations.toLocaleString()} deleted by their users, kept by this hold`}>
          {h.status === "active"
            ? "Their users deleted these conversations and no longer see them. This hold keeps them stored until it's released; then retention removes them as usual."
            : "Their users deleted these conversations. With the hold released, retention removes them as usual."}
        </Alert>
      )}
    </RecordPage>
  );
}
