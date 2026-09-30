/*
 * One connection in a RecordPage (A5): its settings, a test that lists the
 * models the proxy offers with "Add as model" for the ones not in the
 * catalog yet (a SystemOne service is asked one question instead), and the
 * models on it. Editing happens in a SheetForm.
 */
import { plural } from "../../team/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ifMatch, unwrap } from "@/api/client";
import { RecordPage } from "@/components/templates/record-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { useFormState } from "@/lib/use-form-state";
import s from "../../shared.module.css";
import { connectionTestQuery, type Connection, EnabledBadge, type Model, ProxyErrorText, TimingsText } from "./common";
import type { ModelPreset } from "./model-dialog";
import m from "./models.module.css";
import { FormPage, FormSection } from "@/components/templates/form-page";

type RecordProps = {
  conn?: Connection;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  models: Model[];
  isAdmin: boolean;
  onEdit: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onAddModel: (p: ModelPreset) => void;
};

export function ConnectionRecordPage({ conn, open, loading, onClose, models, isAdmin, onEdit, onDelete, onAddModel }: RecordProps) {
  const qc = useQueryClient();
  const test = useQuery({ ...connectionTestQuery(conn?.id ?? ""), enabled: false, gcTime: 0 });
  const onThis = models.filter((x) => x.connectionId === conn?.id);
  const known = new Set(onThis.map((x) => x.upstreamModel));
  return (
    <RecordPage
      open={open}
      onClose={() => {
        qc.removeQueries({ queryKey: connectionTestQuery(conn?.id ?? "").queryKey });
        onClose();
      }}
      title={conn?.name ?? "Connection"}
      description="An OpenAI-compatible proxy that serves models."
      loading={loading && !conn}
      error={!loading && open && !conn ? new Error("This connection no longer exists.") : undefined}
      facts={
        conn
          ? [
              { label: "Base URL", value: <code className={s.mono}>{conn.baseUrl}</code> },
              { label: "API key", value: conn.hasApiKey ? <code className={s.mono}>••••{conn.apiKeyHint}</code> : "None" },
              { label: "Timeout", value: `${conn.timeoutSeconds} s` },
              { label: "Concurrent requests", value: `Up to ${conn.maxConcurrentRequests} per process` },
              { label: "Status", value: <EnabledBadge enabled={conn.enabled} /> },
              { label: "Description", value: conn.description || undefined },
            ].filter((f) => f.value !== undefined)
          : []
      }
      sections={
        conn
          ? [
              {
                title: "Test",
                hidden: !isAdmin,
                content: (
                  <div className={m.sheetForm}>
                    {isAdmin && (
                      <div>
                        <Button size="sm" variant="secondary" loading={test.isFetching} onClick={() => void test.refetch()}>
                          <FlaskConical aria-hidden /> Test connection
                        </Button>
                      </div>
                    )}
                    {test.error ? (
                      <ErrorAlert error={test.error} />
                    ) : test.data?.ok && test.data.probe === "systemone" ? (
                      <Alert tone="success" title={`Connected in ${test.data.latencyMs} ms`}>
                        The SystemOne service answered a test question (model <code className={s.mono}>{test.data.systemOneModel}</code>). It doesn't
                        list its models.
                        <TimingsText timings={test.data.timings} />
                      </Alert>
                    ) : test.data?.ok ? (
                      <>
                        <Alert tone="success" title={`Connected in ${test.data.latencyMs} ms`}>
                          The proxy offers {plural(test.data.models.length, "model")}. Nothing is added until you add it.
                          <TimingsText timings={test.data.timings} />
                        </Alert>
                        <ul aria-label="Models offered by the proxy" className={m.offered}>
                          {test.data.models.map((id) => (
                            <li key={id}>
                              <span>{id}</span>
                              {known.has(id) ? (
                                <span className={s.muted}>In the catalog</span>
                              ) : (
                                isAdmin && (
                                  <Button size="sm" variant="ghost" aria-label={`Add ${id} as a model`} onClick={() => onAddModel({ connectionId: conn.id, upstreamModel: id })}>
                                    <Plus aria-hidden /> Add as model
                                  </Button>
                                )
                              )}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : test.data ? (
                      <Alert tone="danger" title="The connection test failed.">
                        <ProxyErrorText error={test.data.error} />
                        {test.data.probe === "models" && test.data.error?.kind === "not_found" && (
                          <> A SystemOne service doesn't serve GET /models: add its SystemOne model to this connection, then test again.</>
                        )}
                        <TimingsText timings={test.data.timings} />
                      </Alert>
                    ) : null}
                  </div>
                ),
              },
              {
                title: `Models on this connection (${onThis.length})`,
                content: onThis.length ? (
                  <ul className={m.usedBy}>
                    {onThis.map((x) => (
                      <li key={x.id}>
                        <TextLink render={<Link to="/admin/models" search={{ record: x.id } as never} />}>{x.displayName}</TextLink> <span className={s.muted}>({x.upstreamModel})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={s.muted}>No models yet.</p>
                ),
              },
            ]
          : []
      }
      actions={
        conn &&
        isAdmin && (
          <>
            <Button variant="danger" disabled={onThis.length > 0} title={onThis.length ? "Remove this connection's models first." : undefined} onClick={() => onDelete(conn)}>
              <Trash2 aria-hidden /> Delete
            </Button>
            <Button onClick={() => onEdit(conn)}>
              <Pencil aria-hidden /> Edit
            </Button>
          </>
        )
      }
    />
  );
}

/** Add or edit a connection on a form page. */
export function ConnectionForm({ conn, onClose }: { conn: Connection | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, set] = useFormState({
    name: conn?.name ?? "",
    description: conn?.description ?? "",
    baseUrl: conn?.baseUrl ?? "",
    apiKey: "",
    removeKey: false,
    timeoutSeconds: conn?.timeoutSeconds ?? 60,
    maxConcurrentRequests: conn?.maxConcurrentRequests ?? 8,
    enabled: conn?.enabled ?? true,
  });
  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: form.name,
        description: form.description,
        baseUrl: form.baseUrl,
        timeoutSeconds: form.timeoutSeconds,
        maxConcurrentRequests: form.maxConcurrentRequests,
        enabled: form.enabled,
      };
      if (!conn) return unwrap(await api.POST("/v1/admin/connections", { body: { ...common, apiKey: form.apiKey || undefined } }));
      const apiKey = form.removeKey ? "" : form.apiKey || undefined;
      return unwrap(await api.PATCH("/v1/admin/connections/{connectionId}", { params: { path: { connectionId: conn.id }, header: ifMatch(conn.revision) }, body: { ...common, apiKey } }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "connections"] });
      toast.success(conn ? "Connection saved" : "Connection added");
      onClose();
    },
  });
  return (
    <FormPage
      label={conn ? `Edit ${conn.name}` : "Add connection"}
      title={conn ? `Edit ${conn.name}` : "Add connection"}
      description="API keys are stored encrypted and are never shown again."
      onClose={onClose}
      onSubmit={() => save.mutate()}
      submitLabel={conn ? "Save connection" : "Add connection"}
      busy={save.isPending}
    >
      <FormSection title="Endpoint">
        <Field label="Name">
          <Input required maxLength={100} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Base URL" description="Include the API version, for example https://ai-gateway.example.edu/v1" className={m.wide}>
          <Input type="url" required value={form.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} />
        </Field>
        <Field
          label={conn?.hasApiKey ? "Replace API key" : "API key"}
          description={conn?.hasApiKey ? `Current key ends in ${conn.apiKeyHint || "…"}. Leave blank to keep it.` : "Leave blank if the proxy needs no key."}
          disabled={form.removeKey}
          className={m.wide}
        >
          <Input type="password" autoComplete="new-password" disabled={form.removeKey} value={form.apiKey} onChange={(e) => set("apiKey", e.target.value)} />
        </Field>
        {conn?.hasApiKey && <Checkbox label="Remove the stored key" checked={form.removeKey} onCheckedChange={(v) => set("removeKey", v)} />}
      </FormSection>
      <FormSection title="Limits">
        <Field label="Timeout (seconds)">
          <Input type="number" min={1} max={600} value={form.timeoutSeconds} onChange={(e) => set("timeoutSeconds", Number(e.target.value))} />
        </Field>
        <Field label="Maximum concurrent requests" description="Per Grounded process (1–256). SystemOne models use it: a GPU serves them largely one after another.">
          <Input type="number" min={1} max={256} value={form.maxConcurrentRequests} onChange={(e) => set("maxConcurrentRequests", Number(e.target.value))} />
        </Field>
      </FormSection>
      <FormSection title="Details">
        <Field label="Description" labelHint="Optional" className={m.wide}>
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Switch label="Enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
      </FormSection>
      <ErrorAlert error={save.error} />
    </FormPage>
  );
}
