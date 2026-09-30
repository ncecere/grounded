/* Add or edit an MCP server on a form page (?form=new or ?form=<id>). The header value is stored encrypted and never shown again. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ifMatch, unwrap } from "@/api/client";
import { FormPage, FormSection } from "@/components/templates/form-page";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { amountError, useCostSettings } from "@/lib/costs";
import { useFormState } from "@/lib/use-form-state";
import { useClassifications } from "../hooks";
import m from "../models/models.module.css";
import { type MCPServer, serversKey } from "./common";

export function ServerForm({ server, onClose }: { server: MCPServer | null; onClose: () => void }) {
  const qc = useQueryClient();
  const levels = useClassifications();
  const currency = useCostSettings().data?.currency;
  const [form, set] = useFormState({
    name: server?.name ?? "",
    description: server?.description ?? "",
    url: server?.url ?? "",
    authHeaderName: server?.authHeaderName ?? "Authorization",
    authValue: "",
    removeAuth: false,
    maxClassification: server?.maxClassification ?? "open",
    timeoutSeconds: server?.timeoutSeconds ?? 30,
    enabled: server?.enabled ?? true,
    pricePerCall: server?.pricePerCall ?? "",
  });
  const priceError = form.pricePerCall ? amountError(form.pricePerCall, "price", false) : undefined;
  const price = form.pricePerCall.trim();
  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: form.name,
        description: form.description,
        url: form.url,
        maxClassification: form.maxClassification,
        timeoutSeconds: form.timeoutSeconds,
        enabled: form.enabled,
        // Sent only when changed: a new price from today, or "" (an emptied field) to remove it.
        pricePerCall: price !== (server?.pricePerCall ?? "") ? price : undefined,
      };
      if (!server) {
        const auth = form.authValue ? { authHeaderName: form.authHeaderName, authValue: form.authValue } : {};
        return unwrap(await api.POST("/v1/admin/mcp-servers", { body: { ...common, ...auth } }));
      }
      const auth = form.removeAuth
        ? { authHeaderName: "" }
        : { authHeaderName: form.authHeaderName !== (server.authHeaderName ?? "") || form.authValue ? form.authHeaderName : undefined, authValue: form.authValue || undefined };
      return unwrap(
        await api.PATCH("/v1/admin/mcp-servers/{serverId}", { params: { path: { serverId: server.id }, header: ifMatch(server.revision) }, body: { ...common, ...auth } }),
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: serversKey });
      toast.success(server ? "MCP server saved" : "MCP server added. Read its tools next.");
      onClose();
    },
  });
  return (
    <FormPage
      label={server ? `Edit ${server.name}` : "Add MCP server"}
      title={server ? `Edit ${server.name}` : "Add MCP server"}
      description="A remote MCP server over Streamable HTTP. Credentials are stored encrypted and never shown again."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      submitLabel={server ? "Save MCP server" : "Add MCP server"}
      submitDisabled={Boolean(priceError)}
      busy={save.isPending}
    >
      <FormSection title="Endpoint">
        <Field label="Name">
          <Input required maxLength={100} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="URL" description="https only, at a public address, for example https://status.example.edu/mcp" className={m.wide}>
          <Input type="url" required value={form.url} onChange={(e) => set("url", e.target.value)} />
        </Field>
        <Field label="Header" description="Sent with every request, for example Authorization or X-API-Key." disabled={form.removeAuth}>
          <Input disabled={form.removeAuth} value={form.authHeaderName} onChange={(e) => set("authHeaderName", e.target.value)} />
        </Field>
        <Field
          label={server?.hasAuth ? "Replace header value" : "Header value"}
          description={server?.hasAuth ? `Current value ends in ${server.authValueHint || "…"}. Leave blank to keep it.` : "For example Bearer and a token. Leave blank if the server needs none."}
          disabled={form.removeAuth}
        >
          <Input type="password" autoComplete="new-password" disabled={form.removeAuth} value={form.authValue} onChange={(e) => set("authValue", e.target.value)} />
        </Field>
        {server?.hasAuth && <Checkbox label="Remove the stored header" checked={form.removeAuth} onCheckedChange={(v) => set("removeAuth", v)} />}
      </FormSection>
      <FormSection title="Limits">
        <Field label="Data up to" description="The most sensitive data the server may receive. Agents whose knowledge bases hold more can't use its tools.">
          <NativeSelect value={form.maxClassification} onChange={(e) => set("maxClassification", e.target.value)}>
            {levels.data?.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Timeout (seconds)" description="How long one tool call may take (1–120).">
          <Input type="number" min={1} max={120} value={form.timeoutSeconds} onChange={(e) => set("timeoutSeconds", Number(e.target.value))} />
        </Field>
        <Field
          label={currency ? `Price per call (${currency})` : "Price per call"}
          labelHint="Optional"
          description={
            server?.pricePerCall
              ? "A new price applies from today. Empty the field to remove the price: its calls, past ones too, are then counted but cost nothing."
              : "In the platform currency, from today. Without a price, calls are counted but cost nothing."
          }
          error={priceError}
        >
          <Input inputMode="decimal" value={form.pricePerCall} onChange={(e) => set("pricePerCall", e.target.value)} />
        </Field>
      </FormSection>
      <FormSection title="Details">
        <Field label="Description" labelHint="Optional" className={m.wide}>
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Switch label="Enabled" description="Turned off, agents don't call its tools." checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
      </FormSection>
      <ErrorAlert error={save.error} />
    </FormPage>
  );
}
