/*
 * Admin → Models → Reranking › Status (docs/v0.4.2.md OW-2): on or off and why, the model with its stored health,
 * candidates, time limit, and the published agents that rerank or turn it off (linked to their admin record).
 */
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card/card";
import { DescriptionList } from "@/components/ui/description-list/description-list";
import { StatusBadge } from "@/components/ui/badge/badge";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import type { Connection, Model } from "../models/common";
import { HealthBadge, type HealthCheck } from "../models/health";
import type { RerankSettings } from "./settings";
import rr from "./reranking.module.css";

export const seconds = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;

/** Why reranking is off, or undefined when searches rerank. */
export function offReason(saved: RerankSettings, model?: Model, connection?: Connection) {
  if (!saved.modelId) return "No rerank model is chosen.";
  if (!model) return "The chosen model no longer exists.";
  if (!model.enabled) return `${model.displayName} is disabled.`;
  if (connection && !connection.enabled) return `${model.displayName}'s connection, ${connection.name}, is disabled.`;
  return undefined;
}

const agentsText = (n: number) =>
  n === 0 ? "No published agent reranks." : n === 1 ? "1 published agent reranks." : `${n.toLocaleString()} published agents rerank.`;

type Props = { saved: RerankSettings; model?: Model; connection?: Connection; check?: HealthCheck };

export function RerankStatusCard({ saved, model, connection, check }: Props) {
  const off = offReason(saved, model, connection);
  const items = [
    {
      label: "Reranking",
      value: (
        <span className={rr.inline}>
          <StatusBadge tone={off ? "neutral" : "success"}>{off ? "Off" : "On"}</StatusBadge>
          <span className={s.muted}>{off ?? "Every search reranks: agents, Try it, the retrieval API and MCP search."}</span>
        </span>
      ),
    },
    ...(model
      ? [
          {
            label: "Model",
            value: (
              <span className={rr.inline}>
                <TextLink render={<Link to="/admin/models" search={{ record: model.id } as never} />}>{model.displayName}</TextLink>
                <HealthBadge check={check} />
              </span>
            ),
          },
        ]
      : []),
    { label: "Candidates", value: `${saved.candidates.toLocaleString()} passages per search` },
    { label: "Time limit", value: seconds(saved.timeLimitMs) },
    { label: "Agents", value: agentsText(saved.agents) },
    { label: "Turned off by", value: <AgentsOff agents={saved.agentsOff} /> },
  ];
  return (
    <Card title="Status">
      <DescriptionList items={items} />
    </Card>
  );
}

function AgentsOff({ agents }: { agents: RerankSettings["agentsOff"] }) {
  if (agents.length === 0) return <span className={s.muted}>No published agent turns it off.</span>;
  return (
    <ul className={rr.agents}>
      {agents.map((a) => (
        <li key={a.agentId}>
          <TextLink render={<Link to="/admin/agents" search={{ record: a.agentId } as never} />}>{a.name}</TextLink> <span className={s.muted}>({a.teamName})</span>
        </li>
      ))}
    </ul>
  );
}
