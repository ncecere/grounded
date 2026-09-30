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
import { ChatCompatFields, EmbeddingCompatFields } from "./compat-fields";
import { initialModelForm, modelSpec, parseExtraBody, type ModelForm } from "./model-form";
import m from "./models.module.css";
import { FormPage, FormSection } from "@/components/templates/form-page";

/** Prefills a new model, e.g. from a connection test's "Add as model". */
export type ModelPreset = { connectionId: string; upstreamModel: string };

type SetField = <K extends keyof ModelForm>(k: K, v: ModelForm[K]) => void;

function useSaveModel(model: Model | null, form: ModelForm, onClose: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const spec = modelSpec(form);
      if (!model) return unwrap(await api.POST("/v1/admin/models", { body: { ...spec, connectionId: form.connectionId, key: form.key, kind: form.kind } }));
      return unwrap(await api.PATCH("/v1/admin/models/{modelId}", { params: { path: { modelId: model.id }, header: ifMatch(model.revision) }, body: spec }));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast.success(model ? "Model saved" : "Model added");
      onClose();
    },
  });
}

/** Add or edit a model on a form page, the form in sections by kind (A5). */
export function ModelDialog({ model, connections, preset, onClose }: { model: Model | null; connections: Connection[]; preset?: ModelPreset; onClose: () => void }) {
  const listId = useId();
  const [form, set] = useFormState(() => ({
    ...initialModelForm(model, connections),
    ...(preset && !model ? { ...preset, displayName: preset.upstreamModel, key: slugKey(preset.upstreamModel) } : {}),
  }));
  // Upstream model IDs advertised by the chosen connection, for suggestions.
  const available = useQuery({ ...connectionTestQuery(form.connectionId), enabled: !model && form.connectionId !== "", staleTime: 60_000 });
  const save = useSaveModel(model, form, onClose);
  const [submitted, setSubmitted] = useState(false);
  const usesChatCompat = form.kind === "chat" || form.kind === "vision" || (form.kind === "moderation" && form.moderationProvider === "chat_classifier");
  const extraBodyError = usesChatCompat ? parseExtraBody(form.extraBody).error : undefined;

  return (
    <FormPage
      label={model ? `Edit ${model.displayName}` : "Add model"}
      title={model ? `Edit ${model.displayName}` : "Add model"}
      description={model ? "The connection, kind and key are fixed." : "Offer a model from a connection to teams."}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (!extraBodyError) save.mutate();
      }}
      submitLabel={model ? "Save model" : "Add model"}
      busy={save.isPending}
    >
      <FormSection title="Source">
        <SourceFields model={model} connections={connections} form={form} set={set} listId={listId} suggested={!!available.data?.models.length} />
      </FormSection>
      <FormSection title="Identity">
        <Field label="Display name">
          <Input required maxLength={100} value={form.displayName} onChange={(e) => set("displayName", e.target.value)} />
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
        {form.kind === "rerank" && <p className={`${s.settingDescription} ${m.wide}`}>Rerank models have no extra settings.</p>}
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

type IdentityProps = { model: Model | null; connections: Connection[]; form: ModelForm; set: SetField; listId: string; suggested: boolean };

/** Connection, kind, upstream ID and key (connection, kind and key are fixed after creation). */
function SourceFields({ model, connections, form, set, listId, suggested }: IdentityProps) {
  return (
    <>
      <Field label="Connection" disabled={!!model}>
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
      <Field label="Key" description="Stable platform name. Can't be changed later." disabled={!!model}>
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
