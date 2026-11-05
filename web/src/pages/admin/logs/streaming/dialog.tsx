/* A streaming destination's settings: where (HTTPS or syslog over TLS), the format, an authorization header kept secret (stored
 * encrypted, never shown again), and an optional CA certificate for a private SIEM. The kind is chosen once. */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api, ifMatch, unwrap } from "@/api/client";
import { FormDialog } from "@/components/form-dialog";
import { ApiErrorAlert } from "@/components/errors";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { RadioGroup } from "@/components/ui/radio-group/radio-group";
import { Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { destinationProblems, type Destination, type DestinationInput } from "./queries";

type Kind = DestinationInput["kind"];
type Format = DestinationInput["format"];

const formOf = (d: Destination | null): DestinationInput =>
  d
    ? { name: d.name, kind: d.kind, format: d.format, address: d.address, caPem: d.caPem }
    : { name: "", kind: "https", format: "splunk_hec", address: "", caPem: "" };

const fieldOfCode: Record<string, keyof DestinationInput> = {
  invalid_name: "name",
  invalid_address: "address",
  invalid_ca: "caPem",
  invalid_auth: "authHeader",
};

export function DestinationDialog({ destination, onClose, onSaved }: { destination: Destination | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<DestinationInput>(() => formOf(destination));
  const [header, setHeader] = useState("");
  const [removeHeader, setRemoveHeader] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: async (body: DestinationInput) =>
      destination
        ? unwrap(
            await api.PUT("/v1/admin/audit-stream/destinations/{destinationId}", {
              params: { path: { destinationId: destination.id }, header: ifMatch(destination.revision) },
              body,
            }),
          )
        : unwrap(await api.POST("/v1/admin/audit-stream/destinations", { body })),
    onSuccess: (d) => {
      toast.success(destination ? `${d.name} was saved` : `${d.name} was added. Test it, then turn it on.`);
      onSaved();
      onClose();
    },
  });
  const set = (patch: Partial<DestinationInput>) => (save.reset(), setForm((f) => ({ ...f, ...patch })));
  const local = submitted ? destinationProblems(form) : {};
  const code = save.error instanceof ApiError ? save.error.code : "";
  const server = fieldOfCode[code] ? { [fieldOfCode[code]!]: (save.error as ApiError).message } : {};
  const problems: Partial<Record<keyof DestinationInput, string>> = { ...local, ...server };
  const https = form.kind === "https";
  const submit = () => {
    setSubmitted(true);
    if (Object.keys(destinationProblems(form)).length > 0) return;
    const body: DestinationInput = { ...form, format: https ? form.format : "rfc5424" };
    if (https && header) body.authHeader = header;
    else if (https && removeHeader) body.authHeader = "";
    save.mutate(body);
  };
  return (
    <FormDialog
      title={destination ? `Edit ${destination.name}` : "Add a streaming destination"}
      description="Audit entries are sent here once it is turned on. Only platform admins see this; changes are audited."
      size="lg"
      onClose={onClose}
      onSubmit={submit}
      submitLabel={destination ? "Save" : "Add destination"}
      busy={save.isPending}
    >
      <Stack gap={4}>
        <Field label="Name" description="For example the SIEM's name." error={problems.name}>
          <Input value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        {!destination && (
          <RadioGroup<Kind>
            legend="Send over"
            variant="card"
            value={form.kind}
            onValueChange={(v) => set({ kind: v, format: v === "https" ? "splunk_hec" : "rfc5424", address: "" })}
            options={[
              { value: "https", label: "HTTPS", description: "A collector endpoint: Splunk HEC, Elastic Agent's HTTP input, Logstash, Vector, Fluent Bit." },
              { value: "syslog", label: "Syslog over TLS", description: "RFC 5424 messages over TCP with TLS (RFC 5425), usually port 6514." },
            ]}
          />
        )}
        {https && (
          <RadioGroup<Format>
            legend="Format"
            value={form.format}
            onValueChange={(v) => set({ format: v })}
            orientation="horizontal"
            options={[
              { value: "splunk_hec", label: "Splunk HEC", description: "For /services/collector/event" },
              { value: "ndjson", label: "NDJSON", description: "One JSON object per line" },
            ]}
          />
        )}
        <Field
          label={https ? "URL" : "Server"}
          description={https ? "https:// only. Private addresses are allowed; loopback and metadata addresses aren't." : "host:port, for example siem.example.edu:6514."}
          error={problems.address}
        >
          <Input value={form.address} spellCheck={false} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        {https && (
          <Field
            label="Authorization header"
            description={
              destination?.hasAuthHeader
                ? "A value is stored. Leave this empty to keep it, or enter a new one. It is never shown again."
                : "For example Splunk <token> or ApiKey <key>. Stored encrypted and never shown again."
            }
            error={problems.authHeader}
          >
            <Input type="password" autoComplete="off" value={header} onChange={(e) => (save.reset(), setHeader(e.target.value), setRemoveHeader(false))} />
          </Field>
        )}
        {https && destination?.hasAuthHeader && (
          <Checkbox label="Remove the stored authorization header" checked={removeHeader} onCheckedChange={(v) => (setRemoveHeader(Boolean(v)), setHeader(""))} />
        )}
        <Field label="CA certificate (optional)" description="PEM, for a SIEM whose certificate isn't signed by a public authority." error={problems.caPem}>
          <Textarea rows={4} value={form.caPem} spellCheck={false} onChange={(e) => set({ caPem: e.target.value })} placeholder="-----BEGIN CERTIFICATE-----" />
        </Field>
        {!fieldOfCode[code] && <ApiErrorAlert error={save.error} />}
      </Stack>
    </FormDialog>
  );
}
