/*
 * An agent configuration in words, one row per setting with the names the
 * Build tab uses, for a version's page (ConfigSummary) and for Compare
 * versions, which lists the rows that differ: plain names and values, no
 * field paths or IDs (knowledge bases and the model by name). SystemOne
 * checks and Safety (the moderation override) are settings like the rest.
 * Pure: tested in src/test/agent-versions.test.tsx.
 */
import { audienceLabel } from "@/lib/terms";
import { actionLabels, categoryLabel, cleanOverride, overrideModeText } from "@/lib/moderation";
import { describeFilter } from "../team/filters";
import { type AgentConfig, citationModeLabels, retrievalModeLabels } from "./common";

export type ConfigRow = { key: string; label: string; value: string };

/** How a configuration's names are found: its model's, each knowledge base's with its results per search in words, and each tool's. */
export type ConfigNames = {
  model: (id: string | null) => string;
  kb: (k: AgentConfig["kbs"][number]) => string;
  tool: (id: string) => string;
};

/** A tool as the Build tab names it: "Check outage (Service status)". */
export const toolText = (t: { name: string; title?: string; serverName: string }) => `${t.title || t.name} (${t.serverName})`;

/** A tool whose server was deleted, or that is no longer approved and listed. */
export const unknownTool = "A tool that is no longer available";

type SystemOne = NonNullable<AgentConfig["systemOne"]>;

/** The agent's SystemOne overrides: "Platform defaults", or "Passage judging off · Citation checks on (annotate) · Scope check on". */
export function systemOneText(o: SystemOne | undefined): string {
  if (!o) return "Platform defaults";
  const mode = o.citationMode && o.citations !== "off" ? ` (${o.citationMode})` : "";
  const citations = o.citations ? `Citation checks ${o.citations}${mode}` : o.citationMode ? `Citation checks in ${o.citationMode} mode` : "";
  const parts = [
    o.judging ? `Passage judging ${o.judging}` : "",
    o.candidates ? `${o.candidates} passages judged per search` : "",
    citations,
    o.scope ? `Scope check ${o.scope}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Platform defaults";
}

/** The moderation override: "Platform policy only", or each tightened category with its actions. */
export function safetyText(m: AgentConfig["moderation"]): string {
  const o = cleanOverride(m);
  const rules = Object.entries(o.categories ?? {}).map(
    ([c, r]) => `${categoryLabel(c)} (questions: ${actionLabels[r.input.action].toLowerCase()}, answers: ${actionLabels[r.output.action].toLowerCase()})`,
  );
  const mode = overrideModeText(o.outputMode);
  const parts = [...rules, mode && mode[0]!.toUpperCase() + mode.slice(1), m?.severityBlock ? `Block at severity ${m.severityBlock}` : ""];
  return parts.filter(Boolean).join("; ") || "Platform policy only";
}

/** Every setting but the instructions, in the Build tab's order. */
export function configRows(c: AgentConfig, names: ConfigNames): ConfigRow[] {
  const rows: ConfigRow[] = [
    { key: "model", label: "Model", value: names.model(c.chatModelId) },
    { key: "kbs", label: "Knowledge bases", value: c.kbs.map(names.kb).join(", ") || "None" },
    { key: "retrieval", label: "When to search", value: retrievalModeLabels[c.retrievalMode] + (c.retrievalMode === "tool" ? `, up to ${c.maxTurns} searches` : "") },
    { key: "grounded", label: "Answer only from sources", value: c.strictlyGrounded ? `Yes. Refusal: “${c.refusalMessage}”` : "No" },
    { key: "citations", label: "Citations", value: citationModeLabels[c.citationMode] },
    { key: "filters", label: "Pinned filters", value: describeFilter(c.filters) },
    { key: "tools", label: "Tools", value: (c.tools ?? []).map(names.tool).join(", ") || "None" },
    { key: "temperature", label: "Temperature", value: c.temperature === undefined ? "Model default" : String(c.temperature) },
    { key: "maxOutput", label: "Maximum answer length", value: c.maxOutputTokens ? `${c.maxOutputTokens.toLocaleString()} tokens` : "Model limit" },
    { key: "budget", label: "Source token budget", value: c.contextTokenBudget.toLocaleString() },
    { key: "similarity", label: "Minimum similarity", value: c.minSimilarity ? String(c.minSimilarity) : "Off" },
    { key: "rewrite", label: "Rewrite follow-up questions", value: c.queryRewrite ? "Yes" : "No" },
    { key: "followUps", label: "Suggest follow-up questions", value: c.followUpSuggestions === false ? "No" : "Yes" },
    { key: "reasoning", label: "Reasoning effort", value: c.reasoningEffort ? c.reasoningEffort[0]!.toUpperCase() + c.reasoningEffort.slice(1) : "Default" },
    { key: "safety", label: "Safety", value: safetyText(c.moderation) },
    { key: "systemOne", label: "SystemOne checks", value: systemOneText(c.systemOne) },
    { key: "audience", label: "Audience", value: audienceLabel(c.audience) },
  ];
  return rows;
}

/** The settings that differ between two configurations: [label, before, after]. */
export function changedRows(before: AgentConfig, after: AgentConfig, names: ConfigNames): { label: string; before: string; after: string }[] {
  const a = configRows(before, names);
  const b = configRows(after, names);
  return a.flatMap((row, i) => (row.value === b[i]!.value ? [] : [{ label: row.label, before: row.value, after: b[i]!.value }]));
}
