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

/**
 * Whether the extra request fields set chat_template_kwargs.enable_thinking, and what that does next to "How to turn
 * thinking off" (AD-10): the extra fields go with every request, while the setting only applies to agents set to Off.
 */
export function thinkingConflict(form: Pick<ModelForm, "kind" | "thinkingOff" | "extraBody">): string | undefined {
  if (form.kind !== "chat") return undefined;
  const kw = parseExtraBody(form.extraBody).value?.chat_template_kwargs;
  const v = kw && typeof kw === "object" ? (kw as Record<string, unknown>).enable_thinking : undefined;
  if (typeof v !== "boolean") return undefined;
  if (!v && form.thinkingOff) return "The extra request fields turn thinking off for every request, so Low, Medium and High reasoning effort can't turn it on. Remove enable_thinking from them to let agents choose.";
  if (!v) return "The extra request fields turn thinking off for every request. To let agents and audiences choose, set How to turn thinking off instead and remove enable_thinking here.";
  if (form.thinkingOff === "enable_thinking_false") return "The extra request fields turn thinking on for every request; agents and audiences set to Off still turn it off (that setting wins for them).";
  return "The extra request fields turn thinking on for every request, and How to turn thinking off isn't set, so reasoning effort Off does nothing.";
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
    supportsReasoningEffort: compat.supportsReasoningEffort,
    /** Chat models: how to turn thinking off for reasoning effort Off; "" = not supported. */
    thinkingOff: (compat.thinkingOff ?? "") as "" | NonNullable<Compat["thinkingOff"]>,
    supportsDimensionsParam: compat.supportsDimensionsParam ?? false,
    /** Rerank models: "" = the default (documents). */
    rerankDocumentsField: (compat.rerankDocumentsField ?? "") as "" | NonNullable<Compat["rerankDocumentsField"]>,
    supportsRerankTopN: compat.supportsRerankTopN,
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
  set("supportsReasoningEffort", form.supportsReasoningEffort);
  set("thinkingOff", form.kind === "chat" && form.thinkingOff ? form.thinkingOff : undefined);
  set("supportsDimensionsParam", form.kind === "embedding" && form.supportsDimensionsParam ? true : undefined);
  set("rerankDocumentsField", form.kind === "rerank" && form.rerankDocumentsField ? form.rerankDocumentsField : undefined);
  set("supportsRerankTopN", form.kind === "rerank" ? form.supportsRerankTopN : undefined);
  set("extraBody", form.kind === "chat" || form.kind === "moderation" || form.kind === "vision" ? parseExtraBody(form.extraBody).value : undefined);
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
