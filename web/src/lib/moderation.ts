/* Moderation labels and pure helpers (ADR-0019), shared by the admin Moderation page, the model dialog, the agent editor and analytics. */
import type { Schemas } from "../api/client";

export type ModerationCategory = Schemas["ModerationCategory"];
export type ModerationAction = Schemas["ModerationAction"];
export type ModerationRule = Schemas["ModerationRule"];
export type CategoryRules = Schemas["ModerationCategoryRules"];
export type ModerationProvider = Schemas["ModerationProvider"];
export type GuardrailFamily = Schemas["GuardrailFamily"];
export type ModerationResult = Schemas["ModerationResult"];

export const moderationCategories: { value: ModerationCategory; label: string; hint: string }[] = [
  { value: "violence", label: "Violence", hint: "Threats, glorification or instructions for physical harm" },
  { value: "self_harm", label: "Self-harm", hint: "Suicide, self-injury or eating disorders" },
  { value: "sexual", label: "Sexual content", hint: "Explicit content (sex education is allowed)" },
  { value: "sexual_minors", label: "Sexual content involving minors", hint: "Any sexual content about people under 18" },
  { value: "harassment_hate", label: "Harassment and hate", hint: "Bullying, threats, attacks on protected groups" },
  { value: "illicit", label: "Illicit activity", hint: "Instructions for crimes such as fraud or hacking" },
  { value: "personal_data", label: "Personal data", hint: "ID numbers, account numbers, passwords, health records" },
  { value: "prompt_injection", label: "Prompt injection", hint: "Attempts to override the assistant's instructions" },
];

export const categoryLabel = (c: string) => moderationCategories.find((x) => x.value === c)?.label ?? (c || "Provider error");

export const actionLabels: Record<ModerationAction, string> = { off: "Off", flag: "Flag", block: "Block", support: "Support" };

/** Categories that may use the support action (the support message replaces the text). */
export const supportCategories: ModerationCategory[] = ["self_harm"];

/** Severity threshold choices (0 none – 3 severe); only SystemOne models rate severity. */
export const severityOptions = [
  { value: "", label: "Off" },
  { value: "1", label: "Mild or worse" },
  { value: "2", label: "Serious or worse" },
  { value: "3", label: "Severe only" },
];

export const providerLabels: Record<ModerationProvider, string> = {
  moderations_endpoint: "Moderations endpoint",
  guardrail_chat: "Guardrail model",
  chat_classifier: "Chat model as classifier",
  system_one: "SystemOne model",
};

export const providerHints: Record<ModerationProvider, string> = {
  moderations_endpoint: "An OpenAI-compatible /moderations endpoint. Returns probabilities.",
  guardrail_chat: "Llama Guard, Granite Guardian or ShieldGemma served as a chat model. Calibrated when the server returns log-probabilities.",
  chat_classifier: "Any chat model, asked for JSON scores with a versioned prompt. Always works; slower and not calibrated.",
  system_one: "A SystemOne model (added with the kind SystemOne). Returns probabilities and a severity score.",
};

export const familyLabels: Record<GuardrailFamily, string> = {
  llama_guard: "Llama Guard",
  granite_guardian: "Granite Guardian",
  shieldgemma: "ShieldGemma",
};

/** A policy provider: a moderation model or a SystemOne model (ADR-0020). */
export const isModerationProvider = (m: { kind: string }) => m.kind === "moderation" || m.kind === "systemone";

/** The provider name of a model: SystemOne models are the system_one provider. */
export const modelProviderName = (m: { kind: string; moderationProvider?: ModerationProvider | null; moderationFamily?: GuardrailFamily | null }) =>
  m.kind === "systemone" ? providerLabels.system_one : providerName(m.moderationProvider, m.moderationFamily);

/** The provider hint of a model. */
export const modelProviderHint = (m: { kind: string; moderationProvider?: ModerationProvider | null }) =>
  providerHints[m.kind === "systemone" ? "system_one" : (m.moderationProvider ?? "moderations_endpoint")];

/** "Chat model as classifier", or "Guardrail model (Llama Guard)". */
export function providerName(p?: ModerationProvider | null, f?: GuardrailFamily | null) {
  if (!p) return providerLabels.moderations_endpoint;
  return f && p === "guardrail_chat" ? `${providerLabels[p]} (${familyLabels[f]})` : providerLabels[p];
}

export const audienceTabs = [
  { value: "team", label: "Team" },
  { value: "all_authenticated", label: "Signed-in users" },
  { value: "public", label: "Public" },
] as const satisfies readonly { value: Schemas["Audience"]; label: string }[];

export const percent = (p: number) => `${Math.round(p * 100)}%`;

/** Parses a threshold typed as a percentage (0–100) into 0–1; undefined when invalid. */
export function parseThreshold(v: string): number | undefined {
  const n = Number(v.trim().replace(/%$/, ""));
  if (v.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) return undefined;
  return Math.round(n) / 100;
}

const off: ModerationRule = { action: "off", threshold: 0.5 };

/** Rules for every category (missing ones are off). */
export function fullRules(categories?: Record<string, CategoryRules>): Record<ModerationCategory, CategoryRules> {
  const out = {} as Record<ModerationCategory, CategoryRules>;
  for (const { value } of moderationCategories) out[value] = categories?.[value] ?? { input: off, output: off };
  return out;
}

/** An agent override without rules that change nothing, as the API stores it. */
export function cleanOverride(o: Schemas["AgentModeration"] | undefined): Schemas["AgentModeration"] {
  const categories: Record<string, CategoryRules> = {};
  for (const [c, r] of Object.entries(o?.categories ?? {})) {
    if (r.input.action !== "off" || r.output.action !== "off") categories[c] = r;
  }
  return { categories, outputMode: o?.outputMode === "buffer" ? "buffer" : "" };
}

/** How many categories an override tightens. */
export const overrideCount = (o: Schemas["AgentModeration"] | undefined) => Object.keys(cleanOverride(o).categories ?? {}).length;

/** Whether a policy moderates anything at a stage. */
export const moderates = (categories: Record<string, CategoryRules>, stage: "input" | "output") =>
  Object.values(categories).some((r) => r[stage].action !== "off");

/** The highest supported score of a result. */
export function topScore(r: ModerationResult) {
  return r.scores.filter((s) => s.supported).reduce<{ category: string; probability: number } | null>(
    (best, s) => (!best || s.probability > best.probability ? { category: s.category, probability: s.probability } : best),
    null,
  );
}
