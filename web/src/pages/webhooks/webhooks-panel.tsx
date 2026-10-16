/*
 * Webhooks of one scope (a team's in Team settings, the platform's in Admin → Webhooks): the list, New webhook, and the dialogs a row opens:
 * edit, deliveries, rotate the secret (confirmed, then shown once) and delete (confirmed). `canManage` is false for people who only read
 * (platform auditors); `on` is whether the platform switch is on (a platform admin turns webhooks on in Admin → Settings → Features):
 * while it is off nothing new is made or sent, so only the log, rotating a secret and deleting stay.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { ConfirmMutationDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button/button";
import { Inline, Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { type Webhook, type WebhookCreated, type WebhookScope, deliveriesKey, useWebhooks, webhookCalls, webhooksKey } from "./api";
import { DeliveriesDialog } from "./deliveries-dialog";
import { SecretDialog } from "./secret-dialog";
import { WebhookDialog } from "./webhook-dialog";
import { WebhookList } from "./webhook-list";

type Props = { scope: WebhookScope; canManage: boolean; on: boolean };

export function WebhooksPanel({ scope, canManage, on }: Props) {
  const qc = useQueryClient();
  const list = useWebhooks(scope);
  const newButton = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Webhook | null>(null);
  const [rotating, setRotating] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [secret, setSecret] = useState<{ created: WebhookCreated; rotated: boolean } | null>(null);
  const hooks = list.data ?? [];
  // The dialog follows the list, so a change someone else made (412) arrives with its new revision.
  const editing = hooks.find((h) => h.id === editingId);
  const refresh = () => qc.invalidateQueries({ queryKey: webhooksKey(scope) });
  const rotate = useMutation({
    mutationFn: (h: Webhook) => webhookCalls(scope).rotate(h),
    onSuccess: (created) => {
      setRotating(null);
      setSecret({ created, rotated: true });
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (h: Webhook) => webhookCalls(scope).remove(h),
    onSuccess: (_, h) => {
      setDeleting(null);
      qc.removeQueries({ queryKey: deliveriesKey(scope, h.id) });
      toast.success("Webhook deleted");
    },
    onSettled: refresh,
  });
  return (
    <Stack gap={4}>
      {canManage && on && (
        <Inline justify="end">
          <Button ref={newButton} size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New webhook
          </Button>
        </Inline>
      )}
      <WebhookList
        caption={scope.kind === "team" ? "Team webhooks" : "Platform webhooks"}
        data={hooks}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        actions={{
          onDeliveries: setViewing,
          onEdit: canManage && on ? (h) => setEditingId(h.id) : undefined,
          onRotate: canManage ? setRotating : undefined,
          onDelete: canManage ? setDeleting : undefined,
        }}
      />
      {creating && (
        <WebhookDialog
          scope={scope}
          onClose={() => setCreating(false)}
          onCreated={(created) => setSecret({ created, rotated: false })}
        />
      )}
      {editing && <WebhookDialog scope={scope} webhook={editing} onClose={() => setEditingId(null)} onCreated={() => undefined} />}
      {viewing && <DeliveriesDialog scope={scope} webhook={viewing} canSend={canManage && on} onClose={() => setViewing(null)} />}
      {secret && <SecretDialog created={secret.created} rotated={secret.rotated} finalFocus={secret.rotated ? undefined : newButton} onClose={() => setSecret(null)} />}
      <ConfirmMutationDialog<Webhook>
        target={rotating}
        onClose={() => setRotating(null)}
        mutation={rotate}
        title={`Rotate the secret of ${rotating?.url ?? "this webhook"}?`}
        description="A new secret is made and shown once. The current one stops working at once, so deliveries fail their signature check until the receiver uses the new one."
        confirmLabel="Rotate secret"
        onConfirm={(h) => rotate.mutate(h)}
      />
      <ConfirmMutationDialog<Webhook>
        target={deleting}
        onClose={() => setDeleting(null)}
        mutation={remove}
        title={`Delete ${deleting?.url ?? "this webhook"}?`}
        description="Nothing more is sent to it, and its delivery log is deleted too. This can't be undone."
        confirmLabel="Delete webhook"
        onConfirm={(h) => remove.mutate(h)}
      />
    </Stack>
  );
}
