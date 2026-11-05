/*
 * Admin → Logs › Streaming (docs/specs/audit-streaming/DESIGN.md): the destinations audit entries stream to (HTTPS with Splunk HEC or
 * NDJSON, or syslog over TLS), with their state, lag and last error, and Add, Edit, Test, turn on/off and Delete. Signed-in platform
 * admins change them, auditors read them. The platform switch is in Admin → Settings → Features.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FlaskConical, Pencil, Plus, Power, PowerOff, RadioTower, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Alert } from "@/components/ui/alert/alert";
import { StatusBadge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { CellText, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Stack } from "@/components/ui/layout/layout";
import { Loading } from "@/components/ui/spinner/spinner";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import s from "../../../shared.module.css";
import { useIsPlatformAdmin } from "../../hooks";
import { DestinationDialog } from "./dialog";
import { auditStreamQuery, errorClassText, formatLabel, lagText, type Destination } from "./queries";

function state(d: Destination): { tone: "success" | "warning" | "danger" | "neutral"; label: string } {
  if (!d.enabled) return { tone: "neutral", label: "Off" };
  if (d.failingSince) return { tone: "danger", label: "Failing" };
  return { tone: "success", label: "Streaming" };
}

const columns: DataTableColumn<Destination>[] = [
  {
    id: "name",
    header: "Destination",
    rowHeader: true,
    accessor: (d) => d.name,
    cell: (d) => <CellText primary={d.name} secondary={`${formatLabel[d.format]} · ${d.address}`} />,
  },
  {
    id: "state",
    header: "State",
    accessor: (d) => state(d).label,
    cell: (d) => (
      <CellText
        primary={<StatusBadge tone={state(d).tone}>{state(d).label}</StatusBadge>}
        secondary={d.lastErrorClass ? errorClassText[d.lastErrorClass] ?? d.lastErrorClass : undefined}
      />
    ),
  },
  { id: "lag", header: "Behind by", accessor: (d) => d.lagSeconds, numeric: true, cell: (d) => (d.enabled && d.lagSeconds > 0 ? lagText(d.lagSeconds) : "—") },
  { id: "sent", header: "Sent", accessor: (d) => d.sentTotal, numeric: true, cell: (d) => d.sentTotal.toLocaleString() },
  {
    id: "last",
    header: "Last delivery",
    accessor: (d) => (d.lastSentAt ? new Date(d.lastSentAt) : new Date(0)),
    cell: (d) => (d.lastSentAt ? <RelativeTime value={d.lastSentAt} /> : <span className={s.muted}>Never</span>),
  },
];

type Pending = { kind: "delete" | "off"; d: Destination };

export function StreamingTab() {
  const isAdmin = useIsPlatformAdmin();
  const qc = useQueryClient();
  const q = useQuery(auditStreamQuery());
  const [editing, setEditing] = useState<Destination | "new" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: auditStreamQuery().queryKey });
  const toggle = useMutation({
    mutationFn: async ({ d, enabled }: { d: Destination; enabled: boolean }) =>
      unwrap(
        await api.PUT("/v1/admin/audit-stream/destinations/{destinationId}/enabled", {
          params: { path: { destinationId: d.id }, header: ifMatch(d.revision) },
          body: { enabled },
        }),
      ),
    onSuccess: (d) => (toast.success(d.enabled ? `${d.name} is streaming` : `${d.name} is off`), setPending(null)),
    onError: (err) => toast.error("Couldn't change the destination", err instanceof Error ? err.message : undefined),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (d: Destination) =>
      unwrap(await api.DELETE("/v1/admin/audit-stream/destinations/{destinationId}", { params: { path: { destinationId: d.id }, header: ifMatch(d.revision) } })),
    onSuccess: () => (toast.success("The destination was deleted"), setPending(null)),
    onSettled: refresh,
  });
  const test = useMutation({
    mutationFn: async (d: Destination) => unwrap(await api.POST("/v1/admin/audit-stream/destinations/{destinationId}/test", { params: { path: { destinationId: d.id } } })),
    onSuccess: (r, d) =>
      r.delivered ? toast.success(`A test entry reached ${d.name}`) : toast.error(`The test entry didn't reach ${d.name}`, errorClassText[r.errorClass] ?? r.errorClass),
  });
  if (q.isLoading) return <Loading label="Loading streaming…" />;
  if (!q.data) return <ErrorAlert error={q.error} title="Couldn't load streaming" onRetry={() => void q.refetch()} />;
  const { settings, destinations } = q.data;
  const full = destinations.length >= 5;
  return (
    <Stack gap={6}>
      {!settings.enabled && (
        <Alert tone="info" title="Audit streaming is off">
          Turn it on in <TextLink render={<Link to="/admin/settings" search={{ tab: "features" } as never} />}>Admin → Settings → Features</TextLink>. Destinations that exist are kept and
          continue where they stopped when it is on.
        </Alert>
      )}
      <Card
        title="Streaming destinations"
        description="Every new audit entry, in commit order, within seconds: who, from where, did what to which object and when. Never before-and-after values, labels or any content. A stream starts with the entries written after it is first turned on; the signed daily exports keep the history."
        actions={
          isAdmin && (
            <Button size="sm" variant="secondary" disabled={!settings.enabled || full} onClick={() => setEditing("new")}>
              <Plus aria-hidden /> Add destination
            </Button>
          )
        }
        flush
      >
        <ListPage<Destination>
          id="admin-audit-stream"
          caption="Streaming destinations"
          columns={columns}
          data={destinations}
          getRowId={(d) => d.id}
          rowLabel={(d) => d.name}
          rowActions={
            isAdmin
              ? (d) => [
                  { label: "Test", icon: <FlaskConical aria-hidden />, onSelect: () => test.mutate(d) },
                  { label: "Edit", icon: <Pencil aria-hidden />, onSelect: () => setEditing(d) },
                  {
                    label: "Turn on",
                    icon: <Power aria-hidden />,
                    hidden: d.enabled,
                    disabled: !settings.enabled,
                    disabledReason: "Audit streaming is off",
                    onSelect: () => toggle.mutate({ d, enabled: true }),
                  },
                  { label: "Turn off…", icon: <PowerOff aria-hidden />, hidden: !d.enabled, onSelect: () => setPending({ kind: "off", d }) },
                  { label: "Delete…", icon: <Trash2 aria-hidden />, danger: true, onSelect: () => setPending({ kind: "delete", d }) },
                ]
              : undefined
          }
          empty={{ icon: <RadioTower />, title: "No streaming destinations yet.", description: settings.enabled && isAdmin ? "Add your SIEM's HTTPS collector or syslog server." : undefined }}
        />
      </Card>
      {editing && <DestinationDialog destination={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      <ConfirmMutationDialog
        target={pending}
        onClose={() => setPending(null)}
        mutation={pending?.kind === "delete" ? remove : toggle}
        onConfirm={(p) => (p.kind === "delete" ? remove.mutate(p.d) : toggle.mutate({ d: p.d, enabled: false }))}
        title={pending?.kind === "delete" ? `Delete ${pending.d.name}?` : `Turn ${pending?.d.name ?? "this destination"} off?`}
        description={
          pending?.kind === "delete"
            ? "Grounded stops sending to it at once and forgets where it was. Entries already sent stay in your SIEM."
            : "It stops where it is. Turned on again, it sends what was written meanwhile, while the audit log still keeps it."
        }
        confirmLabel={pending?.kind === "delete" ? "Delete" : "Turn off"}
      />
    </Stack>
  );
}
