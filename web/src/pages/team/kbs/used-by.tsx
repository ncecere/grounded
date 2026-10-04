/* Which of the team's agents use a knowledge base (W6 "Used by", the KB facts line). */
import { Link } from "@tanstack/react-router";
import type { Schemas } from "@/api/client";
import { TextLink } from "@/components/ui/text-link/text-link";
import { useAgents } from "../../agents/common";
import { plural } from "../common";
import k from "./kbs.module.css";

type Agent = Schemas["Agent"];

/** Agents whose draft or live version searches the knowledge base; `live` when the published version does. */
export function agentsUsing(agents: Agent[] | undefined, kbId: string) {
  return (agents ?? [])
    .map((a) => ({ agent: a, live: Boolean(a.published?.knowledgeBases?.some((kb) => kb.id === kbId)), draft: Boolean(a.draft?.kbs?.some((kb) => kb.kbId === kbId)) }))
    .filter((u) => u.live || u.draft);
}

export type KBUse = ReturnType<typeof agentsUsing>[number];

/** Knowledge base id → its agents, for a list. */
export function useAgentsByKB(team: string) {
  const agents = useAgents(team);
  return { loading: agents.isLoading, of: (kbId: string) => agentsUsing(agents.data, kbId) };
}

/** "2 agents" with the first agent linked; "No agents" when unused. */
export function UsedByAgents({ uses, team }: { uses: KBUse[]; team: string }) {
  if (uses.length === 0) return <span className={k.muted}>No agents</span>;
  const first = uses[0]!.agent;
  return (
    <span className={k.usedBy} title={uses.map((u) => u.agent.name).join(", ")}>
      <span>{plural(uses.length, "agent")}</span>
      <span className={k.secondary}>
        <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team, agentId: first.id }} />}>{first.name}</TextLink>
        {uses.length > 1 && ` and ${uses.length - 1} more`}
      </span>
    </span>
  );
}

/** The agents' names, linked (the first three, then "and 2 more"): a stat card's caption under the count (VI-13). */
export function UsedByAgentLinks({ uses, team }: { uses: KBUse[]; team: string }) {
  return (
    <span className={k.usedByLinks}>
      {uses.slice(0, 3).map((u, i) => (
        <span key={u.agent.id}>
          {i > 0 && ", "}
          <TextLink render={<Link to="/teams/$team/agents/$agentId" params={{ team, agentId: u.agent.id }} />}>{u.agent.name}</TextLink>
        </span>
      ))}
      {uses.length > 3 && ` and ${uses.length - 3} more`}
    </span>
  );
}
