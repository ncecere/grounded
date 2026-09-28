/*
 * The team overview for a plain member (W13, DESIGN §3.5): members use the
 * team's agents and query its knowledge bases; they don't build, and see no
 * usage or audit. So their overview lists what they can use.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, Library, MessageSquare, Search } from "lucide-react";
import type { ReactNode } from "react";
import { agentDirectoryQuery } from "../../../api/queries";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { SkeletonText } from "@/components/ui/skeleton/skeleton";
import { AgentAvatar } from "../../chat/welcome";
import { useKBs, useTeam } from "../common";
import o from "./overview.module.css";

function Loadable({ q, label, empty, children }: { q: { isLoading: boolean; error: unknown }; label: string; empty: ReactNode; children: ReactNode }) {
  if (q.isLoading)
    return (
      <div role="status" aria-label={`Loading ${label}…`}>
        <SkeletonText lines={2} />
      </div>
    );
  if (q.error) return <ErrorAlert error={q.error} title={`Couldn't load ${label}`} />;
  return <>{empty || children}</>;
}

export function MemberOverview() {
  const { slug: team, team: t } = useTeam();
  const agents = useQuery(agentDirectoryQuery({ team }));
  const kbs = useKBs(team);
  const agentList = (agents.data ?? []).filter((a) => a.teamSlug === team);
  const kbList = kbs.data ?? [];
  return (
    <div className={o.memberGrid}>
      <Card title="Agents you can chat with" description={`Published by ${t.name}. Your conversations are private to you.`}>
        <Loadable
          q={agents}
          label="agents"
          empty={agentList.length === 0 && <EmptyState size="compact" icon={<Bot />} title="No agents yet." description="Agents appear here once the team publishes them." />}
        >
          <ItemGroup aria-label="Agents you can chat with">
            {agentList.map((a) => (
              <Item key={a.id} size="sm" variant="outline" render={<Link to="/a/$team/$agent" params={{ team, agent: a.slug }} />}>
                <ItemMedia>
                  <AgentAvatar agent={a} size="sm" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{a.name}</ItemTitle>
                  {a.description && <ItemDescription className={o.clamp}>{a.description}</ItemDescription>}
                </ItemContent>
                <ItemActions>
                  <MessageSquare aria-hidden className={o.rowIcon} />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </Loadable>
      </Card>
      <Card title="Knowledge bases you can query" description="Search them directly, or through the API with a personal key.">
        <Loadable
          q={kbs}
          label="knowledge bases"
          empty={kbList.length === 0 && <EmptyState size="compact" icon={<Library />} title="No knowledge bases yet." />}
        >
          <ItemGroup aria-label="Knowledge bases you can query">
            {kbList.map((kb) => (
              <Item key={kb.id} size="sm" variant="outline" render={<Link to="/teams/$team/kbs/$kbId" params={{ team, kbId: kb.id }} />}>
                <ItemMedia variant="icon">
                  <Library />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{kb.name}</ItemTitle>
                  {kb.description && <ItemDescription className={o.clamp}>{kb.description}</ItemDescription>}
                </ItemContent>
                <ItemActions>
                  <Search aria-hidden className={o.rowIcon} />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </Loadable>
      </Card>
    </div>
  );
}
