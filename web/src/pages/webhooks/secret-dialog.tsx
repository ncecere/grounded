/* A webhook's secret, shown once (after it is made and after it is rotated), with how a receiver checks a delivery's signature. */
import type { RefObject } from "react";
import { Alert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { CopyField } from "@/components/ui/copy-field/copy-field";
import { Dialog } from "@/components/ui/dialog/dialog";
import { Stack } from "@/components/ui/layout/layout";
import type { WebhookCreated } from "./api";

const signatureFormat = 'Grounded-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>';

type Props = {
  created: WebhookCreated;
  /** The secret is a new one for a webhook that already existed. */
  rotated?: boolean;
  onClose: () => void;
  /** Where focus goes on close (the button that made the webhook, which has no menu to return to). */
  finalFocus?: RefObject<HTMLElement | null>;
};

export function SecretDialog({ created, rotated, onClose, finalFocus }: Props) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={rotated ? "New webhook secret" : "Webhook created"}
      description={created.webhook.url}
      size="lg"
      finalFocus={finalFocus}
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <Stack gap={5}>
        <Alert tone="warning" title="Copy this secret now.">
          It won't be shown again. Store it where the receiver can read it, such as a secrets manager.{" "}
          {rotated ? "The old secret stopped working the moment this one was made: update the receiver now. " : ""}If you lose it, rotate the secret to get a new one.
        </Alert>
        <CopyField label="Signing secret" name="signing secret" value={created.secret} />
        <Stack gap={2}>
          <p>
            Every delivery carries a <code>Grounded-Signature</code> header. To check it, compute the HMAC-SHA256 of <code>&lt;t&gt;.&lt;body&gt;</code> with this secret, where <code>t</code> is the
            timestamp in the header and <code>body</code> is the raw request body, and compare it with <code>v1</code>. Refuse a delivery whose <code>t</code> is more than five minutes old.
          </p>
          <CopyField label="Header format" name="header format" value={signatureFormat} multiline />
        </Stack>
      </Stack>
    </Dialog>
  );
}
