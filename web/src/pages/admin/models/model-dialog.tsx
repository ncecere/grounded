import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, ifMatch, unwrap } from "@/api/client";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Checkbox } from "@/components/ui/checkbox/checkbox";
import { NumberInput } from "@/components/ui/number-input/number-input";
import { Field } from "@/components/ui/field/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input/input";
import { Switch } from "@/components/ui/switch/switch";
import { toast } from "@/components/ui/toast/toast";
import { familyLabels, providerHints, providerLabels, type GuardrailFamily, type ModerationProvider } from "@/lib/moderation";
import { useFormState } from "@/lib/use-form-state";
import s from "../../shared.module.css";
import { useClassifications } from "../hooks";
import { connectionTestQuery, kindLabels, type Connection, type Model, type ModelKind } from "./common";
import { ChatCompatFields, EmbeddingCompatFields, RerankCompatFields } from "./compat-fields";
import { initialModelForm, modelSpec, parseExtraBody, type ModelForm } from "./model-form";
import m from "./models.module.css";
import { FormPage, FormSection } from "@/components/templates/form-page";

/** Prefills a new model, e.g. from a connection test's "Add as model". */
export type ModelPreset = { connectionId: string; upstreamModel: string };

type SetField = <K extends keyof ModelForm>(k: K, v: ModelForm[K]) => void;

function useSaveModel(model: Model | null, form: ModelForm, onClose: (added?: Model) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const spec = modelSpec(form);
      if (!model) return unwrap(await api.POST("/v1/admin/models", { body: { ...spec, connectionId: form.connectionId, key: form.key, kind: form.kind } }));
      return unwrap(await api.PATCH("/v1/admin/models/{modelId}", { params: { path: { modelId: model.id }, header: ifMatch(model.revision) }, body: spec }));
    },
    onSuccess: (saved) => {
      // Not the connection test behind the suggestions: re-run now, it would store a health check for the new model
      // that the pages read before it lands ("Not tested" on Reranking, "Healthy" on its record; AD2-10).
      void qc.invalidateQueries({ queryKey: ["admin"], predicate: (q) => q.queryKey[1] !== "connection-test" });
      toast.success(model ? "Model saved" : "Model added");
      onClose(model ? undefined : saved);
    },
  });
}

type Props = {
  model: Model | null;
  connections: Connection[];
  preset?: ModelPreset;
  kind?: ModelKind;
  /** The connection to start on (the Reranking guide's, after adding one there). */
  connectionId?: string;
  /** Called with the new model after Add, and with nothing on Cancel or after Save. */
  onClose: (added?: Model) => void;
};

/**
 * The connection the form uses: the one chosen, else the one asked for, else the first. Derived, not stored once: a
 * form opened by its address (a reload, a bookmark, a link in a new tab) renders before the connections load, and the
 * select shows the first while the form held none (AD2-03).
 */
export function chosenConnection(chosen: string, connections: Pick<Connection, "id">[], wanted?: string) {
  if (connections.some((c) => c.id === chosen)) return chosen;
  if (wanted && connections.some((c) => c.id === wanted)) return wanted;
  return connections[0]?.id ?? "";
}

/** Add or edit a model on a form page, the form in sections by kind (A5). */
export function ModelDialog({ model, connections, preset, kind, connectionId, onClose }: Props) {
  const listId = useId();
  const [stored, set, setForm] = useFormState(() => ({
    ...initialModelForm(model, connections),
    // Chosen beforehand, e.g. Rerank from the Reranking page's setup guide (OW-2).
    ...(kind && !model ? { kind } : {}),
    ...(preset && !model ? { ...preset, displayName: preset.upstreamModel, key: slugKey(preset.upstreamModel) } : {}),
  }));
  const form = { ...stored, connectionId: model ? stored.connectionId : chosenConnection(stored.connectionId, connections, connectionId) };
  // Upstream model IDs advertised by the chosen connection, for suggestions.
  const available = useQuery({ ...connectionTestQuery(form.connectionId), enabled: !model && form.connectionId !== "", staleTime: 60_000 });
  const save = useSaveModel(model, form, onClose);
  const [submitted, setSubmitted] = useState(false);
  const usesChatCompat = form.kind === "chat" || form.kind === "vision" || (form.kind === "moderation" && form.moderationProvider === "chat_classifier");
  const extraBodyError = usesChatCompat ? parseExtraBody(form.extraBody).error : undefined;
  const noConnection = !model && form.connectionId === "";
  // The key follows the display name until it's typed (AD2-24), as an embedding profile's and a team's slug do.
  const keyFollows = !model && (stored.key === "" || stored.key === slugKey(stored.displayName) || stored.key === slugKey(stored.upstreamModel));
  const setDisplayName = (displayName: string) => setForm((f) => ({ ...f, displayName, ...(keyFollows ? { key: slugKey(displayName) } : {}) }));

  return (
    <FormPage
      label={model ? `Edit ${model.displayName}` : "Add model"}
      title={model ? `Edit ${model.displayName}` : "Add model"}
      description={model ? "The connection, kind and key are fixed." : "Offer a model from a connection to teams."}
      onClose={() => onClose()}
      onSubmit={() => {
        setSubmitted(true);
        if (!extraBodyError && !noConnection) save.mutate();
      }}
      submitLabel={model ? "Save model" : "Add model"}
      busy={save.isPending}
    >
      <FormSection title="Source">
        <SourceFields
          model={model}
          connections={connections}
          form={form}
          set={set}
          listId={listId}
          suggested={!!available.data?.models.length}
          connectionError={submitted && noConnection ? "Choose a connection." : undefined}
        />
      </FormSection>
      <FormSection title="Identity">
        <Field label="Display name">
          <Input required maxLength={100} value={form.displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Description" labelHint="Optional" className={m.wide}>
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </FormSection>
      <FormSection title="Policy">
        <PolicyFields form={form} set={set} />
      </FormSection>
      <FormSection title={`${kindLabels[form.kind]} settings`}>
        {form.kind === "chat" && <ChatFields form={form} set={set} />}
        {form.kind === "embedding" && <EmbeddingFields form={form} set={set} />}
        {form.kind === "embedding" && <EmbeddingCompatFields form={form} set={set} />}
        {form.kind === "moderation" && <ModerationFields form={form} set={set} />}
        {form.kind === "rerank" && <RerankFields form={form} set={set} />}
        {form.kind === "vision" && <VisionFields form={form} set={set} />}
        {form.kind === "systemone" && (
          <p className={`${s.settingDescription} ${m.wide}`}>
            A SystemOne model answers typed questions (POST …/v1/systemone) for passage judging, checks and moderation. Choose it on Admin → SystemOne and Admin → Moderation. Cap the
            connection's concurrent requests to what its GPU serves.
          </p>
        )}
      </FormSection>
      <datalist id={listId}>
        {available.data?.models.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
      {usesChatCompat && <ChatCompatFields form={form} set={set} extraBodyError={submitted ? extraBodyError : undefined} />}
      <ErrorAlert error={save.error} />
    </FormPage>
  );
}

/** A model key suggested from an upstream ID ("openai/gpt-oss-120b" → "gpt-oss-120b"). */
export const slugKey = (upstream: string) =>
  (upstream.split("/").pop() ?? upstream)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 63);

function PolicyFields({ form, set }: { form: ModelForm; set: SetField }) {
  const levels = useClassifications();
  return (
    <>
      <Field label="Max classification" description="The most sensitive data it may process.">
        <NativeSelect value={form.maxClassification} onChange={(e) => set("maxClassification", e.target.value)}>
          {levels.data?.map((l) => (
            <option key={l.key} value={l.key}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Switch label="Enabled" description="Disabled models can't be chosen and stop answering." checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
    </>
  );
}

type IdentityProps = { model: Model | null; connections: Connection[]; form: ModelForm; set: SetField; listId: string; suggested: boolean; connectionError?: string };

/** Connection, kind, upstream ID and key (connection, kind and key are fixed after creation). */
function SourceFields({ model, connections, form, set, listId, suggested, connectionError }: IdentityProps) {
  return (
    <>
      <Field label="Connection" disabled={!!model} error={connectionError}>
        <NativeSelect disabled={!!model} value={form.connectionId} onChange={(e) => set("connectionId", e.target.value)}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Kind" disabled={!!model}>
        <NativeSelect disabled={!!model} value={form.kind} onChange={(e) => set("kind", e.target.value as ModelKind)}>
          {Object.entries(kindLabels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Upstream model ID" description={suggested ? "Suggestions come from the connection." : "The model ID the proxy expects."}>
        <Input required list={listId} value={form.upstreamModel} onChange={(e) => set("upstreamModel", e.target.value)} />
      </Field>
      <Field label="Key" description="Stable platform name, from the display name until you type one. Can't be changed later." disabled={!!model}>
        <Input required disabled={!!model} pattern="[a-z0-9][a-z0-9._\-]{0,62}" value={form.key} onChange={(e) => set("key", e.target.value)} />
      </Field>
    </>
  );
}

function ChatFields({ form, set }: { form: ModelForm; set: SetField }) {
  return (
    <>
      <Field label="Context window (tokens)">
        <NumberInput maximumFractionDigits={0} value={form.contextWindow} onValueChange={(v) => set("contextWindow", v)} />
      </Field>
      <Field label="Max output tokens">
        <NumberInput maximumFractionDigits={0} value={form.maxOutputTokens} onValueChange={(v) => set("maxOutputTokens", v)} />
      </Field>
      <Checkbox label="Supports tool calling" checked={form.supportsTools} onCheckedChange={(v) => set("supportsTools", v)} />
      <Checkbox label="Supports images" checked={form.supportsVision} onCheckedChange={(v) => set("supportsVision", v)} />
    </>
  );
}

/** A vision model reads page images for OCR (docs/ocr.md). */
function VisionFields({ form, set }: { form: ModelForm; set: SetField }) {
  return (
    <>
      <Field label="Max output tokens" description="The longest transcription of one page. Empty uses 4,096.">
        <NumberInput maximumFractionDigits={0} value={form.maxOutputTokens} onValueChange={(v) => set("maxOutputTokens", v)} />
      </Field>
      <p className={`${s.settingDescription} ${m.wide}`}>
        A vision model transcribes scanned pages as Markdown when Admin → Parsing uses the vision backend. Sources above its maximum classification can't use it.
      </p>
    </>
  );
}

function EmbeddingFields({ form, set }: { form: ModelForm; set: SetField }) {
  return (
    <>
      <Field label="Dimensions" description="Save, then use Test to confirm the real value.">
        <NumberInput maximumFractionDigits={0} required value={form.dimensions} onValueChange={(v) => set("dimensions", v)} />
      </Field>
      <Field label="Max input tokens">
        <NumberInput maximumFractionDigits={0} value={form.maxInputTokens} onValueChange={(v) => set("maxInputTokens", v)} />
      </Field>
    </>
  );
}

/** A rerank model's input limit and server quirks; Admin → Models → Reranking chooses the one searches use. */
function RerankFields({ form, set }: { form: ModelForm; set: SetField }) {
  return (
    <>
      <Field label="Max input tokens" labelHint="Optional" description="Longer passages are shortened to fit with the question.">
        <NumberInput maximumFractionDigits={0} value={form.maxInputTokens} onValueChange={(v) => set("maxInputTokens", v)} />
      </Field>
      <RerankCompatFields form={form} set={set} />
    </>
  );
}

/** How a moderation model is called (ADR-0019). */
function ModerationFields({ form, set }: { form: ModelForm; set: SetField }) {
  return (
    <>
      <Field label="Moderation provider" description={providerHints[form.moderationProvider]}>
        <NativeSelect value={form.moderationProvider} onChange={(e) => set("moderationProvider", e.target.value as ModerationProvider)}>
          {Object.entries(providerLabels)
            .filter(([v]) => v !== "system_one" || form.moderationProvider === "system_one")
            .map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field
        label="Check timeout (seconds)"
        description={`Per attempt; a timed-out check is retried once. Empty uses the platform default${form.moderationProvider === "chat_classifier" ? " (at least 30 seconds for chat classifiers)" : ""}.`}
      >
        <NumberInput maximumFractionDigits={0} min={1} max={120} value={form.moderationTimeoutSeconds} onValueChange={(v) => set("moderationTimeoutSeconds", v)} />
      </Field>
      {form.moderationProvider === "guardrail_chat" && (
        <Field label="Guardrail family" description="Sets the conversation format and how the answer is read.">
          <NativeSelect value={form.moderationFamily} onChange={(e) => set("moderationFamily", e.target.value as GuardrailFamily)}>
            {Object.entries(familyLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </>
  );
}
