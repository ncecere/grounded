/* The one-line summary each closed Build section shows (W2). Pure: tested in src/test/agent-build.test.tsx. */
import { cleanOverride, overrideCount } from "@/lib/moderation";
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
};

export function sectionSummary(section: BuildSection, { c, model, kbName, systemOne }: SummaryInput): string {
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
      if (o.outputMode === "buffer") parts.push("answers checked before they're shown");
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
      return [
        c.temperature !== undefined ? `temperature ${c.temperature}` : "model's temperature",
        `${c.contextTokenBudget.toLocaleString()} source tokens`,
        c.queryRewrite ? "rewrites follow-ups" : "no rewriting",
        c.minSimilarity ? `similarity ≥ ${c.minSimilarity}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  }
}
