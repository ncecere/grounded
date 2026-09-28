/*
 * The chat header's agent info (W11): the team name links to Discover agents
 * (where the same facts are listed), and hovering or focusing it previews the
 * agent: its team, who can use it and what it's for. A preview only; nothing
 * here is needed to chat.
 */
import { Link } from "@tanstack/react-router";
import type { Schemas } from "../../api/client";
import { audienceLabel, terms } from "../../lib/terms";
import { Badge } from "@/components/ui/badge/badge";
import { HoverCard } from "@/components/ui/hover-card/hover-card";
import { TextLink } from "@/components/ui/text-link/text-link";
import { AgentAvatar } from "./welcome";
import c from "./agent-info.module.css";

type Card = Schemas["AgentCard"];

export function AgentInfo({ card }: { card: Card }) {
  return (
    <HoverCard
      trigger={
        <TextLink render={<Link to="/agents" />} className={c.teamLink} aria-label={`${card.teamName}: see agents in ${terms.discoverAgents}`}>
          {card.teamName}
        </TextLink>
      }
      side="bottom"
      align="start"
      className={c.infoCard}
    >
      <div className={c.infoHead}>
        <AgentAvatar agent={card} size="md" />
        <div className={c.infoText}>
          <span className={c.infoName}>{card.name}</span>
          <span className={c.infoTeam}>{card.teamName}</span>
        </div>
      </div>
      <div className={c.infoBadges}>
        <Badge variant="outline" size="sm">
          {audienceLabel(card.audience)}
        </Badge>
        {card.status !== "active" && (
          <Badge tone="warning" size="sm">
            Turned off
          </Badge>
        )}
      </div>
      {card.description && <p className={c.infoDescription}>{card.description}</p>}
    </HoverCard>
  );
}
