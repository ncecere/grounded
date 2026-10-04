/*
 * One connection in a RecordPage (A5): its settings, a test that lists the
 * models the proxy offers with "Add as model" for the ones not in the
 * catalog yet (a SystemOne service is asked one question instead), and the
 * models on it. Editing happens in a SheetForm.
 */
import { plural } from "../../team/common";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ifMatch, unwrap } from "@/api/client";
import { RecordPage } from "@/components/templates/record-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { Field } from "@/components/ui/field/field";
import { Input, Textarea } from "@/components/ui/input/input";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Switch } from "@/components/ui/switch/switch";
import { TextLink } from "@/components/ui/text-link/text-link";
import { toast } from "@/components/ui/toast/toast";
import { useFormState } from "@/lib/use-form-state";
import { fieldError, useCurrentError } from "@/lib/field-errors";
import s from "../../shared.module.css";
import { connectionTestQuery, type Connection, EnabledBadge, type Model, ProxyErrorText, TimingsText } from "./common";
import { type HealthCheck, healthFacts, refreshHealth } from "./health";
import type { ModelPreset } from "./model-dialog";
import m from "./models.module.css";
import { FormPage, FormSection } from "@/components/templates/form-page";

type RecordProps = {
  conn?: Connection;
  /** Its latest stored health check (none: not tested yet). */
  health?: HealthCheck;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  models: Model[];
  isAdmin: boolean;
  onEdit: (c: Connection) => void;
  onDelete: (c: Connection) => void;
  onAddModel: (p: ModelPreset) => void;
};

export function ConnectionRecordPage({ conn, health, open, loading, onClose, models, isAdmin, onEdit, onDelete, onAddModel }: RecordProps) {
  const blockedId = useId();
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
              { label: "Requests per minute", value: conn.requestsPerMinute ? conn.requestsPerMinute.toLocaleString() : "Unlimited" },
              { label: "Concurrent requests", value: `Up to ${conn.maxConcurrentRequests} per process` },
              { label: "Status", value: <EnabledBadge enabled={conn.enabled} /> },
              ...healthFacts(health),
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
                        <Button size="sm" variant="secondary" loading={test.isFetching} onClick={() => void test.refetch().then(() => refreshHealth(qc))}>
                          <FlaskConical aria-hidden /> Test connection
                        </Button>
                      </div>
                    )}
                    {test.error ? (
                      <ErrorAlert error={test.error} />
                    ) : test.data?.ok && test.data.probe === "systemone" ? (
                      <Alert tone="success" title={`Connected in ${test.data.latencyMs.toLocaleString()} ms`}>
                        The SystemOne service answered a test question (model <code className={s.mono}>{test.data.systemOneModel}</code>). It doesn't
                        list its models.
                        <TimingsText timings={test.data.timings} />
                      </Alert>
                    ) : test.data?.ok ? (
                      <>
                        <Alert tone="success" title={`Connected in ${test.data.latencyMs.toLocaleString()} ms`}>
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
                  <>
                    <ul className={m.usedBy}>
                      {onThis.map((x) => (
                        <li key={x.id}>
                          <TextLink render={<Link to="/admin/models" search={{ record: x.id } as never} />}>{x.displayName}</TextLink> <span className={s.muted}>({x.upstreamModel})</span>
                        </li>
                      ))}
                    </ul>
                    {/* Why Delete is off, in words everyone reaches (AD-33), not only a title. */}
                    {isAdmin && (
                      <p id={blockedId} className={s.muted}>
                        Remove or move this connection's models to delete it.
                      </p>
                    )}
                  </>
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
            <Button variant="danger" disabled={onThis.length > 0} aria-describedby={onThis.length ? blockedId : undefined} onClick={() => onDelete(conn)}>
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

type ConnectionProblems = Partial<Record<"timeoutSeconds" | "maxConcurrentRequests" | "requestsPerMinute", string>>;

const wholeIn = (v: string, min: number, max: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max;

/** The limits' problems, checked before sending (the server checks the same ranges; AD2-21). */
export function connectionProblems(f: { timeoutSeconds: string; maxConcurrentRequests: string; requestsPerMinute: string }): ConnectionProblems {
  const out: ConnectionProblems = {};
  if (!wholeIn(f.timeoutSeconds, 1, 600)) out.timeoutSeconds = "Enter a whole number of seconds from 1 to 600.";
  if (!wholeIn(f.maxConcurrentRequests, 1, 256)) out.maxConcurrentRequests = "Enter a whole number from 1 to 256.";
  if (f.requestsPerMinute.trim() !== "" && !wholeIn(f.requestsPerMinute, 0, 1000000)) out.requestsPerMinute = "Enter a whole number, or leave it empty for unlimited.";
  return out;
}

/** Add or edit a connection on a form page. `onClose` gets the new connection after Add. */
export function ConnectionForm({ conn, onClose }: { conn: Connection | null; onClose: (added?: Connection) => void }) {
  const qc = useQueryClient();
  const [form, set] = useFormState({
    name: conn?.name ?? "",
    description: conn?.description ?? "",
    baseUrl: conn?.baseUrl ?? "",
    apiKey: "",
    removeKey: false,
    timeoutSeconds: String(conn?.timeoutSeconds ?? 60),
    // "" = unlimited (AD-12: the setting docs/operations/alerts.md tells admins to raise).
    requestsPerMinute: conn?.requestsPerMinute ? String(conn.requestsPerMinute) : "",
    maxConcurrentRequests: String(conn?.maxConcurrentRequests ?? 8),
    enabled: conn?.enabled ?? true,
  });
  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: form.name,
        description: form.description,
        baseUrl: form.baseUrl,
        timeoutSeconds: Number(form.timeoutSeconds),
        requestsPerMinute: Number(form.requestsPerMinute) || 0,
        maxConcurrentRequests: Number(form.maxConcurrentRequests),
        enabled: form.enabled,
      };
      if (!conn) return unwrap(await api.POST("/v1/admin/connections", { body: { ...common, apiKey: form.apiKey || undefined } }));
      const apiKey = form.removeKey ? "" : form.apiKey || undefined;
      return unwrap(await api.PATCH("/v1/admin/connections/{connectionId}", { params: { path: { connectionId: conn.id }, header: ifMatch(conn.revision) }, body: { ...common, apiKey } }));
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["admin", "connections"] });
      toast.success(conn ? "Connection saved" : "Connection added");
      onClose(conn ? undefined : saved);
    },
  });
  const [submitted, setSubmitted] = useState(false);
  const problems = connectionProblems(form);
  const shown = submitted ? problems : {};
  // The server's refusal of what was sent; gone once the form changes, so a fixed field can be sent again (AD2-04).
  const error = useCurrentError(save.error, form);
  const urlError = fieldError(error, ["invalid_base_url"]);
  return (
    <FormPage
      label={conn ? `Edit ${conn.name}` : "Add connection"}
      title={conn ? `Edit ${conn.name}` : "Add connection"}
      description="API keys are stored encrypted and are never shown again."
      onClose={() => onClose()}
      onSubmit={() => {
        setSubmitted(true);
        if (Object.keys(problems).length === 0) save.mutate();
      }}
      submitLabel={conn ? "Save connection" : "Add connection"}
      busy={save.isPending}
    >
      <FormSection title="Endpoint">
        <Field label="Name" className={m.wide}>
          <Input required maxLength={100} value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Base URL" description="Include the API version, for example https://ai-gateway.example.edu/v1" className={m.wide} error={urlError}>
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
        <Field label="Timeout (seconds)" description="1 to 600." error={shown.timeoutSeconds}>
          <NumberInput maximumFractionDigits={0} min={1} max={600} value={form.timeoutSeconds} onValueChange={(v) => set("timeoutSeconds", v)} />
        </Field>
        <Field
          label="Requests per minute"
          labelHint="Optional"
          description="Requests above it wait their turn. Empty is unlimited; set it below the gateway's own limit for Grounded's key."
          error={shown.requestsPerMinute}
        >
          <NumberInput maximumFractionDigits={0} min={0} max={1000000} placeholder="Unlimited" value={form.requestsPerMinute} onValueChange={(v) => set("requestsPerMinute", v)} />
        </Field>
        <Field
          label="Maximum concurrent requests"
          description="Requests one Grounded process sends at once, 1 to 256. Answers get a free slot first; evaluations and the gap job use at most half. For a SystemOne service: what it serves at once, divided by the Grounded pods calling it."
          error={shown.maxConcurrentRequests}
        >
          <NumberInput maximumFractionDigits={0} min={1} max={256} value={form.maxConcurrentRequests} onValueChange={(v) => set("maxConcurrentRequests", v)} />
        </Field>
      </FormSection>
      <FormSection title="Details">
        <Field label="Description" labelHint="Optional" className={m.wide}>
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Switch label="Enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
      </FormSection>
      {!urlError && <ErrorAlert error={error} />}
    </FormPage>
  );
}
