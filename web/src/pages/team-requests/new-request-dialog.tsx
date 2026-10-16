/* "Request a team": what the team is for, the highest classification of its data, and optionally who should own it. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, unwrap } from "@/api/client";
import { ApiErrorAlert } from "@/components/errors";
import { FormDialog } from "@/components/form-dialog";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { toast } from "@/components/ui/toast/toast";
import { useClassificationLevels } from "../team/common";
import { myTeamRequestsKey } from "./common";

export function NewRequestDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const levels = useClassificationLevels();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [classification, setClassification] = useState("");
  const [owner, setOwner] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    name: !name.trim() ? "Enter a name." : undefined,
    purpose: !purpose.trim() ? "Say what the team is for: the reviewer reads this." : undefined,
    classification: !classification ? "Choose the highest classification the team's data will need." : undefined,
  };
  const valid = !errors.name && !errors.purpose && !errors.classification;
  const ask = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST("/v1/team-requests", { body: { name: name.trim(), purpose: purpose.trim(), classification, ownerEmail: owner.trim() || undefined } })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: myTeamRequestsKey });
      toast.success("Request sent", `A platform admin will review "${r.name}". You'll be told when it is decided.`);
      onClose();
    },
    // The server may have changed what is allowed since the page loaded (the switch, the limit): the page re-reads it.
    onError: () => void qc.invalidateQueries({ queryKey: myTeamRequestsKey }),
  });
  return (
    <FormDialog
      size="lg"
      title="Request a team"
      description="A platform admin reviews every request. The team's data sources, knowledge bases and agents live in it."
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (valid) ask.mutate();
      }}
      submitLabel="Send request"
      busy={ask.isPending}
      formProps={{ noValidate: true }}
    >
      <Field label="Team name" error={submitted ? errors.name : undefined}>
        <Input aria-required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="What is it for?" description="Who will use it and what it will answer questions about. Up to 1,000 characters." error={submitted ? errors.purpose : undefined}>
        <Textarea aria-required maxLength={1000} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </Field>
      <Field
        label="Highest classification of its data"
        description="The most sensitive level the team's data will reach. The reviewer may change it."
        error={submitted ? errors.classification : undefined}
      >
        <NativeSelect aria-required value={classification} onChange={(e) => setClassification(e.target.value)}>
          <option value="">Choose…</option>
          {(levels.data ?? []).map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Owner" labelHint="Optional" description="The email of the person who should own the team. Leave empty to own it yourself.">
        <Input type="email" autoComplete="off" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </Field>
      <ApiErrorAlert error={ask.error} />
    </FormDialog>
  );
}
