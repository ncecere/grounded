/* Form state for creating an embedding profile and editing its fusion defaults (pure, unit-tested). */
import type { Schemas } from "@/api/client";
import { type FusionForm, fusionErrors } from "../../team/kbs/fusion-form";

export const initialProfileForm = {
  key: "",
  name: "",
  description: "",
  modelId: "",
  storageType: "halfvec" as "halfvec" | "vector",
  documentPrefix: "",
  queryPrefix: "",
  chunkSize: 512,
  chunkOverlap: 64,
  isDefault: false,
  /** Empty = the model's dimensions. */
  outputDimensions: "",
  /** The profile's default fusion weights; useDefault = the platform default. */
  fusion: { useDefault: true, vector: "1", keyword: "0.1" } as FusionForm,
};
export type ProfileForm = typeof initialProfileForm;

const storageLimit = { halfvec: 4000, vector: 2000 };

/** The prefixes a model family was trained with (G7). */
export type PrefixHint = { family: string; documentPrefix: string; queryPrefix: string };

const prefixHints: { match: RegExp; hint: PrefixHint }[] = [
  { match: /nomic-embed/i, hint: { family: "nomic-embed", documentPrefix: "search_document: ", queryPrefix: "search_query: " } },
  // Qwen3-Embedding instructs queries only; documents go in as they are.
  {
    match: /qwen3?[-_ ]?embed/i,
    hint: { family: "Qwen3-Embedding", documentPrefix: "", queryPrefix: "Instruct: Given a question, retrieve passages that answer it\nQuery: " },
  },
];

/** The recommended prefixes for a model, from its upstream name, key or display name; undefined when none are known. */
export function recommendedPrefixes(model: { upstreamModel?: string; key?: string; displayName?: string } | undefined): PrefixHint | undefined {
  if (!model) return undefined;
  const names = [model.upstreamModel, model.key, model.displayName].filter(Boolean).join(" ");
  return prefixHints.find((p) => p.match.test(names))?.hint;
}

/**
 * The prefixes after choosing a model: a field left empty, or still holding
 * the previous model's recommendation, takes the new one; typed ones stay.
 */
export function prefillPrefixes<F extends Pick<ProfileForm, "documentPrefix" | "queryPrefix">>(form: F, prev: PrefixHint | undefined, next: PrefixHint | undefined): F {
  const untouched = (v: string, p: string | undefined) => v === "" || v === p;
  return {
    ...form,
    documentPrefix: untouched(form.documentPrefix, prev?.documentPrefix) ? (next?.documentPrefix ?? "") : form.documentPrefix,
    queryPrefix: untouched(form.queryPrefix, prev?.queryPrefix) ? (next?.queryPrefix ?? "") : form.queryPrefix,
  };
}

/** The recommended prefixes the form leaves empty (a warning), or []. */
export function missingPrefixes(form: Pick<ProfileForm, "documentPrefix" | "queryPrefix">, hint: PrefixHint | undefined): ("document" | "query")[] {
  if (!hint) return [];
  const out: ("document" | "query")[] = [];
  if (hint.documentPrefix && !form.documentPrefix) out.push("document");
  if (hint.queryPrefix && !form.queryPrefix) out.push("query");
  return out;
}

/** Field errors, or {} when the form can be sent. modelDims is the chosen model's dimensions. */
export function profileErrors(form: ProfileForm, modelDims: number | undefined): { outputDimensions?: string; vector?: string; keyword?: string; fusion?: string } {
  const out: ReturnType<typeof profileErrors> = {};
  const limit = storageLimit[form.storageType];
  const text = form.outputDimensions.trim();
  if (text !== "") {
    const n = Number(text);
    if (!Number.isInteger(n) || n < 1 || (modelDims !== undefined && n > modelDims)) out.outputDimensions = `Enter a whole number from 1 to ${modelDims ?? "the model's dimensions"}.`;
    else if (n > limit) out.outputDimensions = `${form.storageType} supports at most ${limit} dimensions.`;
  }
  const f = fusionErrors(form.fusion);
  if (f.vector) out.vector = f.vector;
  if (f.keyword) out.keyword = f.keyword;
  if (f.form) out.fusion = f.form;
  return out;
}

/** The profile's default weights to send: undefined for the platform default. */
export function fusionWeightsOf(f: FusionForm): Schemas["FusionWeights"] | undefined {
  return f.useDefault ? undefined : { vector: Number(f.vector), keyword: Number(f.keyword) };
}

export function profileBody(form: ProfileForm, modelId: string): Schemas["EmbeddingProfileCreate"] {
  const { outputDimensions, fusion, ...rest } = form;
  return {
    ...rest,
    modelId,
    outputDimensions: outputDimensions.trim() === "" ? undefined : Number(outputDimensions),
    defaultFusionWeights: fusionWeightsOf(fusion),
  };
}

/** The fusion form for an existing profile. */
export function profileFusionForm(p: Schemas["EmbeddingProfile"]): FusionForm {
  const w = p.defaultFusionWeights;
  return w ? { useDefault: false, vector: String(w.vector), keyword: String(w.keyword) } : { useDefault: true, vector: "1", keyword: "0.1" };
}

/** The PATCH body for a profile's fusion defaults. */
export function profileFusionPatch(f: FusionForm): Schemas["EmbeddingProfileUpdate"] {
  const w = fusionWeightsOf(f);
  return w ? { defaultFusionWeights: w } : { usePlatformFusionWeights: true };
}
