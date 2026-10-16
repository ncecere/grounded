/* Webhook and delivery status badges, and the words for why a webhook stopped. */
import { StatusBadge } from "@/components/ui/badge/badge";
import type { Webhook, WebhookDelivery } from "./api";

type Paused = Exclude<Webhook["pausedReason"], "">;

/** Why a paused webhook stopped, for its badge's tooltip and the edit dialog. */
export const pausedText: Record<Paused, string> = {
  failing: "Five deliveries in a row gave up, so Grounded stopped sending to it.",
  gone: "The receiver answered 410 Gone, so Grounded stopped sending to it.",
};

/**
 * The reason a webhook is paused, or undefined. The server turns a webhook off when it pauses it and keeps the reason until someone turns it
 * on again, so any reason means paused (even if it was then also switched off by hand).
 */
export function pausedReason(w: Pick<Webhook, "pausedReason">): Paused | undefined {
  return w.pausedReason || undefined;
}

export function WebhookStatusBadge({ webhook }: { webhook: Webhook }) {
  const paused = pausedReason(webhook);
  if (paused) {
    return (
      <StatusBadge tone="warning" title={pausedText[paused]}>
        Paused: {paused}
      </StatusBadge>
    );
  }
  return webhook.enabled ? <StatusBadge tone="success">On</StatusBadge> : <StatusBadge tone="neutral">Off</StatusBadge>;
}

const deliveryTones = { pending: "info", delivered: "success", failed: "danger" } as const;
export const deliveryLabels: Record<WebhookDelivery["status"], string> = { pending: "Pending", delivered: "Delivered", failed: "Failed" };

export function DeliveryStatusBadge({ status }: { status: WebhookDelivery["status"] }) {
  return <StatusBadge tone={deliveryTones[status]}>{deliveryLabels[status]}</StatusBadge>;
}
