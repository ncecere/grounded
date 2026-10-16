/*
 * Making or changing a webhook: its address (to an approved destination), a description, the events it hears and whether it is turned on.
 * The server checks every one of them (the address against the approved destinations too), and its answer lands on the field it is about.
 * A change carries the webhook's revision; when someone else changed it first (412) the form keeps what was typed, and saving again
 * replaces their version. Turning a paused webhook on again (saving it with "Turned on") clears what paused it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Alert } from "@/components/ui/alert/alert";
import { Checkbox, CheckboxGroup } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { type Webhook, type WebhookCreated, type WebhookScope, destinationsQuery, eventsQuery, webhookCalls, webhooksKey } from "./api";
import { pausedReason, pausedText } from "./status";

/** Which field a server error code is about (the others are shown above the buttons). */
const fieldOf: Record<string, "url" | "events" | "description"> = {
  invalid_url: "url",
  invalid_port: "url",
  invalid_host: "url",
  destination_not_approved: "url",
  no_events: "events",
  invalid_event: "events",
  invalid_description: "description",
};

type Props = {
  scope: WebhookScope;
  /** The webhook to change; absent for a new one. */
  webhook?: Webhook;
  onClose: () => void;
  /** A new webhook was made: its secret is shown once. */
  onCreated: (created: WebhookCreated) => void;
};

export function WebhookDialog({ scope, webhook, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const events = useQuery(eventsQuery());
  const destinations = useQuery(destinationsQuery());
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [description, setDescription] = useState(webhook?.description ?? "");
  const [chosen, setChosen] = useState<string[]>(webhook?.events ?? []);
  const [enabled, setEnabled] = useState(webhook?.enabled ?? true);
  const [submitted, setSubmitted] = useState(false);
  const choices = (events.data ?? []).filter((e) => e.scope === scope.kind);
  const paused = webhook && pausedReason(webhook);
  const input = () => ({ url: url.trim(), description: description.trim(), events: chosen, enabled });
  const save = useMutation({
    mutationFn: async () => (webhook ? webhookCalls(scope).update(webhook, input()) : webhookCalls(scope).create(input())),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: webhooksKey(scope) });
      if ("secret" in r) onCreated(r);
      else toast.success("Webhook saved");
      onClose();
    },
    // Changed by someone else since the list was read: the list loads the current version, and this form keeps what was typed.
    onError: (e) => e instanceof ApiError && e.status === 412 && void qc.invalidateQueries({ queryKey: webhooksKey(scope) }),
  });
  const code = save.error instanceof ApiError ? save.error.code : "";
  const onField = (f: string) => (fieldOf[code] === f ? (save.error as Error).message : undefined);
  const urlError = (submitted && !url.trim() ? "Enter the address the events are sent to." : undefined) ?? onField("url");
  const eventsError = (submitted && chosen.length === 0 ? "Choose at least one event." : undefined) ?? onField("events");
  const patterns = destinations.data ?? [];
  return (
    <FormDialog
      size="lg"
      title={webhook ? "Edit webhook" : "New webhook"}
      description={`Grounded sends a signed HTTPS POST with a small JSON event to this address when ${scope.kind === "team" ? "something happens in the team" : "something happens on the platform"}.`}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (url.trim() && chosen.length > 0) save.mutate();
      }}
      submitLabel={webhook ? "Save webhook" : "Create webhook"}
      busy={save.isPending}
      formProps={{ noValidate: true }}
    >
      {paused && (
        <Alert tone="warning" title={`Paused: ${paused}`}>
          {pausedText[paused]} Save it with <strong>Turned on</strong> checked to start sending again.
        </Alert>
      )}
      <Field
        label="Address"
        error={urlError}
        description={
          patterns.length > 0 ? (
            <>
              https on port 443, to an approved destination:{" "}
              {patterns.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <code>{p.pattern}</code>
                </span>
              ))}
              .
            </>
          ) : (
            "No destinations are approved yet. A platform admin approves them under Admin → Webhooks."
          )
        }
      >
        <Input aria-required type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2048} placeholder="https://hooks.example.edu/grounded" value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Description" labelHint="Optional" description="What this webhook is for, in one line. Up to 200 characters." error={onField("description")}>
        <Input maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <CheckboxGroup legend="Events" description="The events this webhook hears. Choose at least one." error={eventsError} value={chosen} onValueChange={(v) => setChosen(v as string[])}>
        {choices.map((e) => (
          <Checkbox key={e.type} value={e.type} label={e.type} description={e.description} />
        ))}
      </CheckboxGroup>
      <Switch label="Turned on" checked={enabled} onCheckedChange={setEnabled} />
      {!fieldOf[code] && <ApiErrorAlert error={save.error} />}
    </FormDialog>
  );
}
