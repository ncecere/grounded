/* The one-line summary each closed Build section shows (W2). Pure: tested in src/test/agent-build.test.tsx. */
import { cleanOverride, overrideCount, overrideModeText } from "@/lib/moderation";
import { describeFilter } from "../../team/filters";
import type { AgentConfig } from "../common";
import type { BuildSection, ChatModel } from "./section";

const citationShort: Record<AgentConfig["citationMode"], string> = {
  none: "no citations",
  snippet: "title and snippet",
  snippet_link: "title, snippet and link",
};

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

type SummaryInput = {
  c: AgentConfig;
  model?: ChatModel;
  /** Knowledge base names by id. */
  kbName: (id: string) => string | undefined;
  /** The SystemOne platform defaults, when a SystemOne model exists. */
  systemOne?: { judging: boolean; citations: boolean; citationMode: string; scope: boolean };
  /** The platform's reranking, when a rerank model is set (the passages kept by default). */
  rerank?: { defaultTopN: number };
  /** A tool's name by its id (Tools' summary names them). */
  toolName?: (id: string) => string | undefined;
};

const effortText: Record<NonNullable<AgentConfig["reasoningEffort"]>, string> = {
  off: "reasoning off",
  low: "low reasoning",
  medium: "medium reasoning",
  high: "high reasoning",
};

/** The summary starts with a capital, like the other sections' (BU2-11). */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Advanced's summary: what changes answers most first (reasoning, length), then the rest (BU-15). */
function advancedSummary(c: AgentConfig, rerank?: { defaultTopN: number }) {
  const reranking = c.rerank === false ? "no reranking" : rerank ? `reranks, keeps ${c.rerankTopN ?? rerank.defaultTopN}` : null;
  return capitalise(
    [
      c.reasoningEffort ? effortText[c.reasoningEffort] : null,
      c.maxOutputTokens ? `answers up to ${c.maxOutputTokens.toLocaleString()} tokens` : null,
      c.temperature !== undefined ? `temperature ${c.temperature}` : "the model's default temperature",
      `${c.contextTokenBudget.toLocaleString()} source tokens`,
      c.minSimilarity ? `similarity ≥ ${c.minSimilarity}` : null,
      reranking,
      c.queryRewrite ? "rewrites follow-up questions into searches" : "no query rewriting",
      c.followUpSuggestions === false ? "no follow-up suggestions" : "suggests follow-up questions",
    ]
      .filter(Boolean)
      .join(" · "),
  );
}

/** Tools' summary names them (BU2-11): "check_outage", "check_outage and 2 more". */
function toolsSummary(c: AgentConfig, toolName?: (id: string) => string | undefined) {
  const ids = c.tools ?? [];
  if (ids.length === 0) return "No tools: the agent only searches its knowledge bases";
  const names = ids.map((id) => toolName?.(id)).filter((n): n is string => Boolean(n));
  if (names.length === 0) return ids.length === 1 ? "1 tool" : `${ids.length} tools`;
  const shown = names.slice(0, 2).join(", ");
  return ids.length > 2 ? `${shown} and ${ids.length - 2} more` : names.length < ids.length ? `${shown} and 1 more` : shown;
}

export function sectionSummary(section: BuildSection, { c, model, kbName, systemOne, rerank, toolName }: SummaryInput): string {
  switch (section) {
    case "instructions": {
      const text = c.instructions.trim().replace(/\s+/g, " ");
      return text ? clip(text, 90) : "Not written yet";
    }
    case "model":
      return c.chatModelId ? (model?.displayName ?? "Unavailable model") : "No model chosen";
    case "knowledge": {
      if (c.kbs.length === 0) return "No knowledge bases: the agent can't answer yet";
      const names = c.kbs.map((k) => kbName(k.kbId) ?? "Deleted knowledge base").join(", ");
      const filter = describeFilter(c.filters);
      return filter === "None" || !filter ? names : `${names} · filtered: ${filter}`;
    }
    case "tools":
      return toolsSummary(c, toolName);
    case "answering":
      return [
        c.retrievalMode === "always" ? "Search before every answer" : `The model searches (up to ${c.maxTurns})`,
        c.strictlyGrounded ? "only from sources" : "may use general knowledge",
        citationShort[c.citationMode],
      ].join(" · ");
    case "safety": {
      const o = cleanOverride(c.moderation);
      const n = overrideCount(c.moderation);
      const parts = [n === 0 ? "Platform policy only" : n === 1 ? "1 category tightened" : `${n} categories tightened`];
      if (o.outputMode) parts.push(overrideModeText(o.outputMode));
      return parts.join(" · ");
    }
    case "systemone": {
      const o = c.systemOne ?? {};
      if (!systemOne) return "";
      const on = (v: string | undefined, platform: boolean) => (v ? v === "on" : platform);
      const parts = [
        `judging ${on(o.judging, systemOne.judging) ? "on" : "off"}`,
        `citations ${on(o.citations, systemOne.citations) ? (o.citationMode ?? systemOne.citationMode) : "off"}`,
        `scope ${on(o.scope, systemOne.scope) ? "on" : "off"}`,
      ];
      return `${Object.keys(o).length ? "Custom" : "Platform defaults"}: ${parts.join(", ")}`;
    }
    case "advanced":
      return advancedSummary(c, rerank);
  }
}
