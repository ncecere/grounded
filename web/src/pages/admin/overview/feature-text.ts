/*
 * What the Features card says about cost tracking and SystemOne, beyond the
 * platform setting (pure, tested in src/test): teams that override the cost
 * mode, and the published agents each SystemOne check is on for. A platform
 * default alone would say "Nothing is refused" with a team on Enforce, or "no
 * SystemOne feature is on" while agents check their citations.
 */
import type { Schemas } from "@/api/client";
import type { Tone } from "@/lib/bitop-utils";
import { type CostMode, modeDescriptions, modeLabels } from "@/lib/costs";

export type FeatureState = { label: string; tone: Tone };
type Budget = { teamName: string; status: Pick<Schemas["BudgetListItem"]["status"], "mode"> };

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "QA Team", "QA Team and Library", "A, B, C and 2 more". */
export function names(list: string[], max = 3) {
  if (list.length <= 1) return list.join("");
  const shown = list.slice(0, list.length > max ? max : list.length - 1);
  const rest = list.length - shown.length;
  return `${shown.join(", ")} and ${list.length > max ? `${rest} more` : list[list.length - 1]}`;
}

const costTones: Record<CostMode, Tone> = { off: "neutral", track: "info", enforce: "success" };

/** What the platform mode means for teams without their own mode, when some teams are enforced anyway. */
const othersText: Record<Exclude<CostMode, "enforce">, string> = {
  off: "Other teams: nothing is tracked or refused.",
  track: "Other teams: spend is reported to platform admins, auditors and the team's owners and admins, and nothing is refused.",
};

/** The Cost tracking row: the platform mode, and the teams whose own mode enforces (or doesn't) against it. */
export function costFeature(mode: CostMode, budgets: Budget[] | undefined): { state: FeatureState; description: string } {
  const state = { label: modeLabels[mode], tone: costTones[mode] };
  if (mode === "enforce") {
    const loose = (budgets ?? []).filter((b) => b.status.mode !== "enforce");
    if (loose.length === 0) return { state, description: modeDescriptions.enforce };
    return {
      state: { ...state, label: `Enforce · ${plural(loose.length, "team")} not enforced` },
      description: `${modeDescriptions.enforce} Not enforced for ${names(loose.map((b) => b.teamName))} (a team setting).`,
    };
  }
  const enforced = (budgets ?? []).filter((b) => b.status.mode === "enforce");
  if (enforced.length === 0) return { state, description: modeDescriptions[mode] };
  return {
    state: { label: `${modeLabels[mode]} · ${plural(enforced.length, "team")} enforced`, tone: "warning" },
    description: `Enforced for ${names(enforced.map((b) => b.teamName))} (a team setting): at 100% of the budget, the team's chats, searches and ingestion stop. ${othersText[mode]}`,
  };
}

/** The SystemOne row: whether a model is chosen, and which checks are on for how many agents. */
export function systemOneFeature(st: Pick<Schemas["SystemOneSettings"], "modelId" | "agents">): { state: FeatureState; description: string } {
  if (!st.modelId) {
    return {
      state: { label: "Not configured", tone: "neutral" },
      description: "Add a SystemOne model to judge passages, check citations and spot out-of-scope questions.",
    };
  }
  const a = st.agents;
  if (a.any === 0) return { state: { label: "Configured", tone: "neutral" }, description: "A model is chosen, but no published agent uses a SystemOne check." };
  // "Citation checks on 2 published agents and passage judging on 1, by …" (AD-36: not "Published agents use … on 1 agent").
  const counts = ([[a.citations, "citation checks"], [a.scope, "the scope check"], [a.judging, "passage judging"]] as const).filter(([n]) => n > 0);
  const checks = counts.map(([n, label], i) => `${label} on ${i === 0 ? plural(n, "published agent") : n.toLocaleString()}`);
  const text = names(checks, 3);
  return {
    state: { label: `Configured · checks on ${plural(a.any, "agent")}`, tone: "success" },
    description: `${text.charAt(0).toUpperCase()}${text.slice(1)}, by each agent's own setting or the platform default.`,
  };
}

/** The Reranking row (OW-2): "Off" with "Set up", or "On · <model>". */
export function rerankFeature(
  st: Pick<Schemas["RerankSettings"], "modelId" | "candidates" | "agents">,
  model?: Schemas["AdminFeatureModel"],
): { state: FeatureState; description: string; action: string } {
  if (!st.modelId || !model) {
    return {
      state: { label: "Off", tone: "neutral" },
      description: "Searches keep the usual order. A rerank model puts the passages that answer the question first.",
      action: "Set up",
    };
  }
  if (!model.enabled) {
    return { state: { label: "Off", tone: "warning" }, description: `${model.displayName} or its connection is disabled, so searches aren't reranked.`, action: "Reranking" };
  }
  return {
    state: { label: `On · ${model.displayName}`, tone: "success" },
    description: `Searches rerank their best ${st.candidates} passages; ${plural(st.agents, "published agent reranks", "published agents rerank")}.`,
    action: "Reranking",
  };
}
