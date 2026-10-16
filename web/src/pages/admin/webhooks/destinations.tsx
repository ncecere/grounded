/*
 * Admin → Webhooks › Approved destinations (v0.6.0, F3): the host patterns a webhook's address must match, when it is saved and again before
 * every delivery. Platform admins add and remove them (audited); auditors read. Removing one stops what is sent to it at once.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { ListPage, RelativeTime } from "@/components/templates/list-page";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import type { DataTableColumn } from "@/components/ui/data-table/data-table";
import { Field, Form } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { type WebhookDestination, destinationsKey, destinationsQuery } from "../../webhooks/api";
import w from "../../webhooks/webhooks.module.css";
import d from "./destinations.module.css";

const columns: DataTableColumn<WebhookDestination>[] = [
  { id: "pattern", header: "Host pattern", accessor: "pattern", sortable: true, rowHeader: true, hideable: false, cell: (r) => <code className={w.mono}>{r.pattern}</code> },
  { id: "note", header: "Note", accessor: "note", muted: true, cell: (r) => r.note || "—" },
  { id: "added", header: "Approved", accessor: "createdAt", sortable: true, muted: true, cell: (r) => <RelativeTime value={r.createdAt} /> },
];

/** The add form: a pattern and an optional note; the server's answer lands on the field it is about. */
function AddDestination() {
  const qc = useQueryClient();
  const [pattern, setPattern] = useState("");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const add = useMutation({
    mutationFn: async () => unwrap(await api.POST("/v1/admin/webhook-destinations", { body: { pattern: pattern.trim(), note: note.trim() || undefined } })),
    onSuccess: (r) => {
      setPattern("");
      setNote("");
      setSubmitted(false);
      toast.success(`${r.pattern} is approved`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: destinationsKey }),
  });
  const code = add.error instanceof ApiError ? add.error.code : "";
  const patternCodes = ["invalid_pattern", "blocked_address", "destination_exists"];
  const message = (add.error as Error | null)?.message;
  const patternError = (submitted && !pattern.trim() ? "Enter a host such as hooks.example.edu or *.example.edu." : undefined) ?? (patternCodes.includes(code) ? message : undefined);
  return (
    <Form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (pattern.trim()) add.mutate();
      }}
    >
      <Stack gap={4}>
        <div className={d.addRow}>
          <Field label="Host pattern" description="A host name, or *.example.edu for that host and its subdomains." error={patternError}>
            <Input aria-required autoComplete="off" spellCheck={false} maxLength={253} placeholder="hooks.example.edu" value={pattern} onChange={(e) => (setPattern(e.target.value), add.reset())} />
          </Field>
          <Field label="Note" labelHint="Optional" description="Who asked for it, or why." error={code === "invalid_note" ? message : undefined}>
            <Input maxLength={200} value={note} onChange={(e) => (setNote(e.target.value), add.reset())} />
          </Field>
        </div>
        {!patternCodes.includes(code) && code !== "invalid_note" && <ApiErrorAlert error={add.error} />}
        <div>
          <Button type="submit" loading={add.isPending}>
            Approve destination
          </Button>
        </div>
      </Stack>
    </Form>
  );
}

/** The approved destinations: how patterns work, the add form (platform admins) and the table. */
export function DestinationsCard({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const list = useQuery(destinationsQuery());
  const [removing, setRemoving] = useState<WebhookDestination | null>(null);
  const remove = useMutation({
    mutationFn: async (r: WebhookDestination) => unwrap(await api.DELETE("/v1/admin/webhook-destinations/{destinationId}", { params: { path: { destinationId: r.id } } })),
    onSuccess: (_, r) => {
      setRemoving(null);
      toast.success(`${r.pattern} is no longer approved`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: destinationsKey }),
  });
  return (
    <Card
      title="Approved destinations"
      description="A webhook can only send to a host one of these patterns covers: checked when the webhook is saved and again before every delivery."
    >
      <Stack gap={5}>
        <ul className={d.rules}>
          <li>
            <code>hooks.example.edu</code> covers that host only; <code>*.example.edu</code> covers <code>example.edu</code> and its subdomains. <code>*</code> alone is refused.
          </li>
          <li>Webhooks are sent over https to port 443 only.</li>
          <li>Private, loopback, link-local and cloud metadata addresses are never reachable, whatever is approved here.</li>
        </ul>
        {isAdmin && <AddDestination />}
        <ListPage<WebhookDestination>
          id="webhook-destinations"
          caption="Approved destinations"
          columns={columns}
          data={list.data ?? []}
          getRowId={(r) => r.id}
          rowLabel={(r) => r.pattern}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          rowActions={(r) => [{ label: "Remove…", icon: <Trash2 aria-hidden />, danger: true, hidden: !isAdmin, onSelect: () => setRemoving(r) }]}
          empty={{ icon: <ShieldCheck />, title: "No destinations are approved.", description: "Until one is, no webhook can be made." }}
        />
      </Stack>
      <ConfirmMutationDialog<WebhookDestination>
        target={removing}
        onClose={() => setRemoving(null)}
        mutation={remove}
        title={`Remove ${removing?.pattern ?? "this destination"}?`}
        description="Webhooks to hosts it covers stop at once: their deliveries fail as no longer approved and are not retried. The webhooks stay, and you can approve the destination again."
        confirmLabel="Remove destination"
        onConfirm={(r) => remove.mutate(r)}
      />
    </Card>
  );
}
