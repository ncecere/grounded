/* A knowledge base's hybrid fusion weights in the settings form (pure, unit-tested). */
import type { Schemas } from "@/api/client";

type KB = Schemas["KnowledgeBase"];
type KBUpdate = Schemas["KnowledgeBaseUpdate"];

/** "Use the default" (the embedding profile's, else the platform's), or this knowledge base's own vector and keyword weights (0–1, as typed). */
export type FusionForm = { useDefault: boolean; vector: string; keyword: string };

export function fusionFormOf(kb: KB): FusionForm {
  // effectiveFusionWeights is always sent; the fallback only keeps the form usable without it.
  const w = kb.fusionWeights ?? kb.effectiveFusionWeights ?? { vector: 1, keyword: 1 };
  return { useDefault: !kb.fusionWeights, vector: String(w.vector), keyword: String(w.keyword) };
}

const weight = (t: string) => {
  const n = Number(t.trim());
  return t.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
};

/** Field errors, or {} when the weights are valid (always valid with the default). */
export function fusionErrors(f: FusionForm): { vector?: string; keyword?: string; form?: string } {
  if (f.useDefault) return {};
  const v = weight(f.vector);
  const k = weight(f.keyword);
  const out: { vector?: string; keyword?: string; form?: string } = {};
  if (v === undefined) out.vector = "Enter a number from 0 to 1.";
  if (k === undefined) out.keyword = "Enter a number from 0 to 1.";
  if (v === 0 && k === 0) out.form = "At least one weight must be above 0.";
  return out;
}

/** The fusion part of the PATCH body: an override, a return to the default, or nothing when unchanged. */
export function fusionPatch(f: FusionForm, kb: KB): Pick<KBUpdate, "fusionWeights" | "useDefaultFusionWeights"> {
  if (f.useDefault) return kb.fusionWeights ? { useDefaultFusionWeights: true } : {};
  const next = { vector: weight(f.vector) ?? 0, keyword: weight(f.keyword) ?? 0 };
  const cur = kb.fusionWeights;
  if (cur && cur.vector === next.vector && cur.keyword === next.keyword) return {};
  return { fusionWeights: next };
}

/** Where a knowledge base's weights in effect come from, for the settings form. */
export function weightsSourceLabel(source: KB["fusionWeightsSource"]): string {
  switch (source) {
    case "knowledge_base":
      return "this knowledge base's own weights";
    case "profile":
      return "from the embedding profile";
    default:
      return "the platform default";
  }
}

/** "Vector 0.7 · keyword 0.3". */
export const describeWeights = (w: { vector: number; keyword: number }) => `Vector ${w.vector} · keyword ${w.keyword}`;
