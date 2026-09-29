/*
 * Home: agents first (the most common task), then where you left off (the
 * latest conversations, linking to Conversations), then your teams as
 * compact rows with quick links. Someone without a team gets copy that fits
 * (P-08), and "Request a new team" only when the instance has a request
 * address.
 */
import { Link } from "@tanstack/react-router";
import { ArrowRight, Users } from "lucide-react";
import { roleLabels } from "../components/roles";
import { terms } from "../lib/terms";
import { useJoinTeamHelp } from "../components/layout/join-team";
import { type Me, useCurrentUser } from "../session";
import { Avatar } from "@/components/ui/avatar/avatar";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item/item";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { AgentList, RecentConversations } from "./chat/directory";
import { useLevelName } from "./team/common";
import s from "./shared.module.css";
import styles from "./user.module.css";

export function HomePage() {
  const me = useCurrentUser();
  const firstName = me.user.displayName.split(" ")[0] || me.user.displayName;
  const hasTeam = me.teams.length > 0;

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description={
          hasTeam
            ? "Chat with agents shared with you, or build knowledge bases and agents with your teams."
            : "Chat with the agents shared with everyone who signs in. To build your own, join a team."
        }
      />
      <Card
        title="Agents"
        description={hasTeam ? "Agents from your teams and those shared with you." : "Agents shared with everyone who signs in."}
        actions={
          <Button variant="ghost" size="sm" render={<Link to="/agents" />}>
            {terms.discoverAgents} <ArrowRight aria-hidden />
          </Button>
        }
      >
        <AgentList limit={6} />
      </Card>
      <Card
        title="Continue where you left off"
        description="Your latest conversations. Only you can see them."
        actions={
          <Button size="sm" variant="ghost" render={<Link to="/conversations" />}>
            All conversations <ArrowRight aria-hidden />
          </Button>
        }
        flush
      >
        <RecentConversations limit={3} />
      </Card>
      <YourTeams me={me} />
    </Stack>
  );
}

function YourTeams({ me }: { me: Me }) {
  const help = useJoinTeamHelp();
  const levelName = useLevelName();
  if (me.teams.length === 0) {
    return (
      <Card title="Your teams">
        <EmptyState
          size="compact"
          icon={<Users />}
          title="You aren't on a team yet."
          description={`Teams build data sources, knowledge bases and agents. ${help.text}`}
          action={
            help.link ? (
              <Button variant="secondary" render={<a href={help.link.href} target="_blank" rel="noreferrer" />}>
                {help.link.label}
              </Button>
            ) : undefined
          }
        />
      </Card>
    );
  }
  return (
    <Card title="Your teams" description={me.teams.length === 1 ? "1 team" : `${me.teams.length} teams`}>
      <ItemGroup aria-label="Your teams">
        {me.teams.map((t) => {
          const builds = t.role !== "member";
          return (
            <Item key={t.id} variant="outline" size="sm" className={styles.teamRow}>
              <ItemMedia>
                <Avatar name={t.name} shape="square" size="md" decorative />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  <Link to="/teams/$team" params={{ team: t.slug }} className={styles.teamLink}>
                    {t.name}
                  </Link>
                </ItemTitle>
                <ItemDescription className={styles.teamBadges}>
                  <Badge tone="info" size="sm">
                    {roleLabels[t.role]}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    Up to {levelName(t.maxClassification)}
                  </Badge>
                  {t.status === "archived" && (
                    <Badge tone="warning" size="sm">
                      Archived
                    </Badge>
                  )}
                </ItemDescription>
              </ItemContent>
              <ItemActions className={styles.quickLinks}>
                {builds && (
                  <Button size="sm" variant="ghost" render={<Link to="/teams/$team/sources" params={{ team: t.slug }} aria-label={`${t.name}: data sources`} />}>
                    Data sources
                  </Button>
                )}
                <Button size="sm" variant="ghost" render={<Link to="/teams/$team/kbs" params={{ team: t.slug }} aria-label={`${t.name}: knowledge bases`} />}>
                  Knowledge bases
                </Button>
                {builds && (
                  <Button size="sm" variant="ghost" render={<Link to="/teams/$team/agents" params={{ team: t.slug }} aria-label={`${t.name}: agents`} />}>
                    Agents
                  </Button>
                )}
              </ItemActions>
            </Item>
          );
        })}
      </ItemGroup>
    </Card>
  );
}
