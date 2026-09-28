/* Form state for the model dialog and its conversion to the API body (pure, unit-tested). */
import type { Schemas } from "@/api/client";
import type { Connection, Model, ModelKind } from "./common";

export type ModelForm = ReturnType<typeof initialModelForm>;
type Compat = Schemas["ModelCompat"];

/** Number inputs are kept as strings; empty means "not set". */
const optionalNumber = (v: string) => (v === "" ? undefined : Number(v));

/** An example extraBody, shown as the field's placeholder. */
export const extraBodyExample = '{"chat_template_kwargs": {"enable_thinking": false}}';

/** Fields Grounded sets itself; extraBody can't set them (mirrors gateway.ReservedChatField). */
const reservedFields = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "functions",
  "function_call",
  "n",
  "user",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "reasoning_effort",
]);
const maxExtraBodyBytes = 4096;

/** Parses the extraBody field: undefined when empty, else a JSON object or an error message. */
export function parseExtraBody(text: string): { value?: Record<string, unknown>; error?: string } {
  if (text.trim() === "") return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: `Enter a JSON object, for example ${extraBodyExample}.` };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { error: `Enter a JSON object, for example ${extraBodyExample}.` };
  const reserved = Object.keys(value).filter((k) => reservedFields.has(k) || k.trim() === "");
  if (reserved.length > 0) return { error: `Remove ${reserved.sort().join(", ")}: Grounded sets these fields itself.` };
  if (new TextEncoder().encode(JSON.stringify(value)).length > maxExtraBodyBytes) return { error: "Keep it under 4096 bytes." };
  return { value: value as Record<string, unknown> };
}

export function initialModelForm(model: Model | null, connections: Connection[]) {
  const compat: Compat = model?.compat ?? {};
  return {
    connectionId: model?.connectionId ?? connections[0]?.id ?? "",
    key: model?.key ?? "",
    kind: model?.kind ?? ("chat" as ModelKind),
    upstreamModel: model?.upstreamModel ?? "",
    displayName: model?.displayName ?? "",
    description: model?.description ?? "",
    maxClassification: model?.maxClassification ?? "open",
    enabled: model?.enabled ?? true,
    contextWindow: model?.contextWindow?.toString() ?? "",
    maxOutputTokens: model?.maxOutputTokens?.toString() ?? "",
    supportsTools: model?.supportsTools ?? false,
    supportsVision: model?.supportsVision ?? false,
    dimensions: model?.dimensions?.toString() ?? "",
    maxInputTokens: model?.maxInputTokens?.toString() ?? "",
    maxTokensField: compat.maxTokensField ?? "",
    supportsDeveloperRole: compat.supportsDeveloperRole,
    supportsToolChoice: compat.supportsToolChoice,
    supportsDimensionsParam: compat.supportsDimensionsParam ?? false,
    extraBody: compat.extraBody ? JSON.stringify(compat.extraBody, null, 2) : "",
    /** Flags the form doesn't edit (e.g. thinkingField), kept on save: a PATCH replaces all compat flags. */
    otherCompat: compat,
    moderationProvider: model?.moderationProvider ?? ("chat_classifier" as Schemas["ModerationProvider"]),
    moderationFamily: model?.moderationFamily ?? ("llama_guard" as Schemas["GuardrailFamily"]),
    /** Seconds per check attempt; "" uses the platform default. */
    moderationTimeoutSeconds: model?.moderationTimeoutSeconds?.toString() ?? "",
  };
}

/** The compat flags to send: the ones the form edits, over the ones it keeps. */
function compatOf(form: ModelForm): Compat {
  const compat: Compat = { ...form.otherCompat };
  const set = <K extends keyof Compat>(k: K, v: Compat[K] | undefined) => {
    if (v === undefined) delete compat[k];
    else compat[k] = v;
  };
  set("maxTokensField", (form.maxTokensField || undefined) as Compat["maxTokensField"]);
  set("supportsDeveloperRole", form.supportsDeveloperRole);
  set("supportsToolChoice", form.supportsToolChoice);
  set("supportsDimensionsParam", form.kind === "embedding" && form.supportsDimensionsParam ? true : undefined);
  set("extraBody", form.kind === "chat" || form.kind === "moderation" ? parseExtraBody(form.extraBody).value : undefined);
  return compat;
}

/** The fields a model update (PATCH) sends; creation adds connectionId, key and kind. */
export function modelSpec(form: ModelForm) {
  return {
    upstreamModel: form.upstreamModel,
    displayName: form.displayName,
    description: form.description,
    maxClassification: form.maxClassification,
    enabled: form.enabled,
    contextWindow: optionalNumber(form.contextWindow),
    maxOutputTokens: optionalNumber(form.maxOutputTokens),
    supportsTools: form.supportsTools,
    supportsVision: form.supportsVision,
    dimensions: optionalNumber(form.dimensions),
    maxInputTokens: optionalNumber(form.maxInputTokens),
    compat: compatOf(form),
    // Moderation models only; the family only for guardrail models.
    moderationProvider: form.kind === "moderation" ? form.moderationProvider : undefined,
    moderationFamily: form.kind === "moderation" && form.moderationProvider === "guardrail_chat" ? form.moderationFamily : undefined,
    // 0 clears it (the platform default).
    moderationTimeoutSeconds: form.kind === "moderation" ? (optionalNumber(form.moderationTimeoutSeconds) ?? 0) : undefined,
  };
}
