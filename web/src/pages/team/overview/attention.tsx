/*
 * "Needs attention" on the team overview (W5): failed documents, pending
 * domain requests, limits at 80 % or more, and agents a platform admin turned
 * off. Each row links to where it's fixed. Nothing renders when all is well.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, FileWarning, Gauge, Globe } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { teamLimitsQuery } from "../../../lib/limits";
import { Badge } from "@/components/ui/badge/badge";
import { Card } from "@/components/ui/card/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { useAgents } from "../../agents/common";
import { plural, useSources, useTeam } from "../common";
import { useDomainRequests } from "../domains";
import o from "./overview.module.css";

export type AttentionRow = { id: string; icon: ReactNode; title: string; description: string; tone: "warning" | "danger"; link: ReactElement };

/** Share of a limit used, or undefined when it isn't measured. */
export function usedRatio(it: { used: number | null; max: number | null }) {
  return it.used !== null && it.max !== null && it.max > 0 ? it.used / it.max : undefined;
}

export function useAttention(): AttentionRow[] {
  const { slug: team, role } = useTeam();
  const sources = useSources(team);
  const requests = useDomainRequests(team);
  const agents = useAgents(team);
  // Members have no usage view (DESIGN §3.5).
  const limits = useQuery({ ...teamLimitsQuery(team), enabled: role !== "member" });
  const rows: AttentionRow[] = [];

  for (const src of sources.data ?? []) {
    if (src.documents.failed === 0) continue;
    rows.push({
      id: `source-${src.id}`,
      icon: <FileWarning />,
      title: `${plural(src.documents.failed, "document")} failed in ${src.name}`,
      description: "They aren't searchable. Open the documents to see why, then fix or remove them.",
      tone: "danger",
      link: <Link to="/teams/$team/sources/$sourceId" params={{ team, sourceId: src.id }} search={{ tab: "documents" }} />,
    });
  }
  const pending = (requests.data ?? []).filter((r) => r.status === "pending");
  if (pending.length > 0) {
    rows.push({
      id: "domain-requests",
      icon: <Globe />,
      title: `${plural(pending.length, "domain request")} waiting for review`,
      description: pending.map((r) => r.pattern).join(", "),
      tone: "warning",
      link: <Link to="/teams/$team/settings" params={{ team }} search={{ tab: "crawl-domains" }} />,
    });
  }
  const near = (limits.data?.items ?? []).filter((it) => (usedRatio(it) ?? 0) >= 0.8).sort((a, b) => (usedRatio(b) ?? 0) - (usedRatio(a) ?? 0));
  for (const it of near) {
    const pct = Math.round((usedRatio(it) ?? 0) * 100);
    rows.push({
      id: `limit-${it.key}`,
      icon: <Gauge />,
      title: `${it.label}: ${pct} % used`,
      description: pct >= 100 ? "The limit is reached. Ask a platform admin for more." : "Close to the limit.",
      tone: pct >= 100 ? "danger" : "warning",
      link: <Link to="/teams/$team/settings" params={{ team }} search={{ tab: "usage" }} />,
    });
  }
  for (const a of agents.data ?? []) {
    if (a.status !== "disabled_by_platform") continue;
    rows.push({
      id: `agent-${a.id}`,
      icon: <Bot />,
      title: `${a.name} was turned off by a platform admin`,
      description: a.disabledReason || "Nobody can chat with it until a platform admin turns it back on.",
      tone: "danger",
      link: <Link to="/teams/$team/agents/$agentId" params={{ team, agentId: a.id }} />,
    });
  }
  return rows;
}

export function NeedsAttention() {
  const rows = useAttention();
  if (rows.length === 0) return null;
  return (
    <Card title="Needs attention" actions={<Badge tone="warning">{rows.length}</Badge>}>
      <ItemGroup aria-label="Needs attention">
        {rows.map((r) => (
          <Item key={r.id} size="sm" variant="outline" render={r.link} className={o.attention} data-tone={r.tone}>
            <ItemMedia variant="icon">{r.icon}</ItemMedia>
            <ItemContent>
              <ItemTitle>{r.title}</ItemTitle>
              <ItemDescription>{r.description}</ItemDescription>
            </ItemContent>
          </Item>
        ))}
      </ItemGroup>
    </Card>
  );
}
