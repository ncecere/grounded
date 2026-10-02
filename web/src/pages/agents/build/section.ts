/* What every Build section gets, which section a field belongs to, and how fields report text that isn't valid yet (F-26). */
import { createContext, useContext, useEffect } from "react";
import type { useChatModels, AgentConfig } from "../common";
import type { AgentDraft } from "../draft";

export type ChatModel = NonNullable<ReturnType<typeof useChatModels>["data"]>[number];

export type SectionProps = {
  /** The draft's configuration. */
  c: AgentConfig;
  set: AgentDraft["setConfig"];
  /** The problem reported for a field, if any. */
  errorFor: (field: string) => string | undefined;
  /** The saved draft's warning for a field (draft.<field>), if any. */
  warningFor?: (field: string) => string | undefined;
  /** The chosen chat model, once models have loaded. */
  model: ChatModel | undefined;
  levelName: (key: string) => string;
};

/** The Build sections, in order. */
export const buildSections = ["instructions", "model", "knowledge", "tools", "answering", "safety", "systemone", "advanced"] as const;
export type BuildSection = (typeof buildSections)[number];

const sectionOfField: Record<string, BuildSection> = {
  instructions: "instructions",
  chatModelId: "model",
  kbs: "knowledge",
  filters: "knowledge",
  tools: "tools",
  retrievalMode: "answering",
  strictlyGrounded: "answering",
  refusalMessage: "answering",
  citationMode: "answering",
  moderation: "safety",
  systemOne: "systemone",
  temperature: "advanced",
  maxOutputTokens: "advanced",
  reasoningEffort: "advanced",
  contextTokenBudget: "advanced",
  maxTurns: "advanced",
  minSimilarity: "advanced",
  queryRewrite: "advanced",
  followUpSuggestions: "advanced",
  rerank: "advanced",
  rerankTopN: "advanced",
};

/** The editor tab and Build section a problem's field lives in ("draft.kbs[0].topK", "agent-field-temperature"…). */
export function fieldPlace(field: string): { tab: "build" | "appearance" | "share" | "settings"; section?: BuildSection } {
  const base = field.replace(/^agent-field-/, "").replace(/^draft\./, "").split(/[.[]/)[0] ?? "";
  if (base === "audience") return { tab: "share" };
  if (["name", "slug", "description"].includes(base)) return { tab: "settings" };
  if (["accentColor", "welcomeMessage", "starterQuestions"].includes(base)) return { tab: "appearance" };
  return { tab: "build", section: sectionOfField[base] ?? "advanced" };
}

/** Reports a field whose text isn't a valid value yet: (field id, invalid). */
export const FieldValidity = createContext<(id: string, invalid: boolean) => void>(() => {});

/** Tells the draft while a field holds text that can't be saved (so the header never says "Draft saved"). */
export function useReportInvalid(id: string | undefined, invalid: boolean) {
  const report = useContext(FieldValidity);
  useEffect(() => {
    if (!id) return;
    report(id, invalid);
    return () => report(id, false);
  }, [id, invalid, report]);
}
