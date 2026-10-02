/* Shared pieces for the team's agent pages: types, queries, labels and the status badge. */
import { useQuery } from "@tanstack/react-query";
import { api, unwrap, type Schemas } from "../../api/client";
import { StatusBadge } from "@/components/ui/badge/badge";
import { agentsKey } from "../team/common";
import a from "./agents.module.css";

export type Agent = Schemas["Agent"];
export type AgentConfig = Schemas["AgentConfig"];
type AgentConfigInput = Schemas["AgentConfigInput"];
export type AgentVersion = Schemas["AgentVersion"];
export type AgentProblem = Schemas["AgentProblem"];

export function useAgents(team: string) {
  return useQuery({
    queryKey: agentsKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents", { params: { path: { team } } })),
  });
}

/** Chat models teams may use (enabled models on enabled connections). */
export function useChatModels() {
  return useQuery({
    queryKey: ["chat-models"],
    queryFn: async () => unwrap(await api.GET("/v1/chat-models")),
    staleTime: 60_000,
  });
}

export function AgentStatusBadge({ agent }: { agent: Pick<Agent, "status" | "published"> }) {
  if (agent.status === "disabled_by_platform") return <StatusBadge tone="danger">Disabled by platform</StatusBadge>;
  if (agent.status === "disabled_by_team") return <StatusBadge tone="warning">Disabled</StatusBadge>;
  if (!agent.published) return <StatusBadge tone="neutral">Not published</StatusBadge>;
  return <StatusBadge tone="success">Live</StatusBadge>;
}

export const citationModeLabels: Record<Schemas["CitationMode"], string> = {
  none: "No citations",
  snippet: "Title and snippet",
  snippet_link: "Title, snippet and link (web pages)",
};

export const retrievalModeLabels: Record<Schemas["RetrievalMode"], string> = {
  always: "Search before every answer",
  tool: "Let the model decide when to search",
};

/** The editor section and control a problem's field points to (fields such as "kbs[0].topK", "draft.chatModelId"). */
export function problemTarget(field: string): { id: string; label: string } {
  const f = field.replace(/^draft\./, "");
  const base = f.split(/[.[]/)[0] ?? f;
  const labels: Record<string, string> = {
    instructions: "Instructions",
    chatModelId: "Chat model",
    kbs: "Knowledge bases",
    retrievalMode: "Retrieval mode",
    maxTurns: "Maximum searches",
    contextTokenBudget: "Source token budget",
    filters: "Pinned filters",
    minSimilarity: "Minimum similarity",
    strictlyGrounded: "Answer only from sources",
    refusalMessage: "Refusal message",
    citationMode: "Citations",
    queryRewrite: "Rewrite follow-up questions",
    followUpSuggestions: "Suggest follow-up questions",
    temperature: "Temperature",
    maxOutputTokens: "Maximum output tokens",
    reasoningEffort: "Reasoning effort",
    moderation: "Moderation",
    audience: "Audience",
    tools: "Tools",
    rerankTopN: "Passages kept after reranking",
    published: "Published version",
  };
  return { id: `agent-field-${base}`, label: labels[base] ?? base };
}

/** Focuses the editor control for a problem (after switching to the Configure tab). */
export function focusField(field: string) {
  const { id } = problemTarget(field);
  const el = document.getElementById(id);
  if (!el) return;
  const focusable = '[role="checkbox"], [role="radio"]:not([data-disabled]), select, textarea, button, input:not([type="hidden"]):not([aria-hidden="true"]):not([tabindex="-1"])';
  const target = el.matches(focusable) ? el : (el.querySelector<HTMLElement>(focusable) ?? el);
  el.scrollIntoView?.({ block: "center" });
  target.focus();
}

/** Defaults for a new draft (the API applies the same). */
export const defaultConfig: AgentConfigInput = {
  instructions: "",
  chatModelId: null,
  kbs: [],
  retrievalMode: "always",
  maxTurns: 4,
  contextTokenBudget: 6000,
  minSimilarity: 0,
  strictlyGrounded: true,
  refusalMessage: "I couldn't find an answer to that in the sources I have.",
  citationMode: "snippet_link",
  queryRewrite: true,
  rerank: true,
  rerankTopN: 6,
  followUpSuggestions: true,
};

/** A draft config ready to send: the server rejects unknown fields; optional values are cleared with null / "". */
export function configInput(c: AgentConfig): AgentConfigInput {
  return {
    instructions: c.instructions,
    chatModelId: c.chatModelId ?? null,
    temperature: c.temperature ?? null,
    maxOutputTokens: c.maxOutputTokens ?? null,
    reasoningEffort: c.reasoningEffort ?? "",
    kbs: c.kbs.map((k) => ({ kbId: k.kbId, topK: k.topK ?? null })), // null: the knowledge base's own (C14)
    retrievalMode: c.retrievalMode,
    maxTurns: c.maxTurns,
    contextTokenBudget: c.contextTokenBudget,
    filters: c.filters,
    minSimilarity: c.minSimilarity,
    strictlyGrounded: c.strictlyGrounded,
    refusalMessage: c.refusalMessage,
    citationMode: c.citationMode,
    queryRewrite: c.queryRewrite,
    moderation: c.moderation,
    audience: c.audience,
    // Omitted (not null) when unset: agents without SystemOne checks keep the exact config they had. Any override
    // counts (citation checks or the scope check alone too), or saving and Compare versions would drop it.
    systemOne: c.systemOne && Object.values(c.systemOne).some((v) => v !== undefined && v !== "") ? c.systemOne : undefined,
    // MCP tools (docs/mcp-client.md); absent in configurations saved before v0.3.
    tools: c.tools,
    // Reranking (docs/v0.4.0.md §3); absent in configurations saved before v0.4: on, keeping 6.
    rerank: c.rerank ?? true,
    rerankTopN: c.rerankTopN ?? 6,
    // Follow-up suggestions (docs/follow-ups.md); absent in configurations saved before v0.4.1: on.
    followUpSuggestions: c.followUpSuggestions ?? true,
  };
}

/** Slug rules (same as team slugs): lower-case letters, digits and single hyphens. */
export function slugify(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** A server problem as a sentence: problems come without a final period ("Choose a chat model"). */
export const asSentence = (text: string) => (/[.!?…]$/.test(text.trim()) ? text : `${text.trim()}.`);

/** Problems as buttons that jump to the control. */
export function ProblemList({ problems, onSelect }: { problems: { field: string; problem: string }[]; onSelect: (field: string) => void }) {
  return (
    <ul className={a.problemList}>
      {problems.map((p, i) => (
        <li key={i}>
          <button type="button" className={a.problemLink} onClick={() => onSelect(p.field)}>
            {problemTarget(p.field).label}
          </button>
          : {asSentence(p.problem)}
        </li>
      ))}
    </ul>
  );
}

