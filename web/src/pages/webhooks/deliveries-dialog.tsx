/*
 * A webhook's delivery log: the last 50 deliveries (kept 14 days) with their status, attempts and what the receiver answered, never its
 * body. "Send test event" queues a webhook.test delivery whatever the webhook subscribes to; "Redeliver" sends a delivery's event again
 * (the same event ID) as a new delivery. People who may only read (auditors) see the log without the buttons.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Send, Webhook as WebhookIcon } from "lucide-react";
import { RelativeTime } from "@/components/templates/list-page";
import { ApiErrorAlert } from "@/components/errors";
import { Button } from "@/components/ui/button/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table/data-table";
import { Dialog, DialogClose } from "@/components/ui/dialog/dialog";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Inline, Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { type Webhook, type WebhookDelivery, type WebhookScope, deliveriesKey, useDeliveries, webhookCalls } from "./api";
import { DeliveryStatusBadge } from "./status";
import w from "./webhooks.module.css";

type Props = {
  scope: WebhookScope;
  webhook: Webhook;
  /** May send test events and redeliver (managers, while webhooks are on). */
  canSend: boolean;
  onClose: () => void;
};

export function DeliveriesDialog({ scope, webhook, canSend, onClose }: Props) {
  const qc = useQueryClient();
  const deliveries = useDeliveries(scope, webhook.id);
  const refresh = () => qc.invalidateQueries({ queryKey: deliveriesKey(scope, webhook.id) });
  const test = useMutation({
    mutationFn: () => webhookCalls(scope).test(webhook),
    onSuccess: () => toast.success("Test event queued"),
    onSettled: refresh,
  });
  const redeliver = useMutation({
    mutationFn: (d: WebhookDelivery) => webhookCalls(scope).redeliver(webhook, d),
    onSuccess: () => toast.success("Event queued again"),
    onSettled: refresh,
  });
  const columns: DataTableColumn<WebhookDelivery>[] = [
    { id: "event", header: "Event", accessor: "eventType", rowHeader: true, hideable: false, cell: (d) => <code className={w.mono}>{d.eventType}</code> },
    { id: "status", header: "Status", accessor: "status", cell: (d) => <DeliveryStatusBadge status={d.status} /> },
    { id: "attempts", header: "Attempts", accessor: "attempts", numeric: true },
    { id: "answer", header: "Receiver answered", accessor: (d) => d.lastStatus ?? null, cell: (d) => d.lastStatus ?? "—" },
    { id: "error", header: "Error", accessor: "lastError", muted: true, cell: (d) => d.lastError || "—" },
    { id: "time", header: "Sent", accessor: "createdAt", muted: true, cell: (d) => <RelativeTime value={d.createdAt} /> },
  ];
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title="Deliveries"
      description={`${webhook.url}: the last 50, kept for 14 days.`}
      footer={<DialogClose>Close</DialogClose>}
    >
      <Stack gap={4}>
        <Inline gap={2}>
          {canSend && (
            <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => {
                redeliver.reset();
                test.mutate();
              }}>
              <Send aria-hidden /> Send test event
            </Button>
          )}
          <Button variant="ghost" size="sm" loading={deliveries.isFetching} onClick={() => void refresh()}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
        </Inline>
        <ApiErrorAlert error={test.error ?? redeliver.error} />
        <DataTable<WebhookDelivery>
          caption={`Deliveries of ${webhook.url}`}
          columns={columns}
          data={deliveries.data ?? []}
          getRowId={(d) => d.id}
          rowLabel={(d) => `${d.eventType} delivery`}
          loading={deliveries.isLoading}
          error={deliveries.error}
          onRetry={() => void deliveries.refetch()}
          rowActions={
            canSend
              ? (d) => (
                  <Button variant="secondary" size="sm" loading={redeliver.isPending && redeliver.variables?.id === d.id} onClick={() => {
                      test.reset();
                      redeliver.mutate(d);
                    }} aria-label={`Redeliver ${d.eventType}`}>
                    Redeliver
                  </Button>
                )
              : undefined
          }
          empty={<EmptyState size="compact" icon={<WebhookIcon />} title="Nothing has been sent yet." description={canSend ? "Use Send test event to see a delivery here." : "Deliveries appear here as events happen."} />}
        />
      </Stack>
    </Dialog>
  );
}
