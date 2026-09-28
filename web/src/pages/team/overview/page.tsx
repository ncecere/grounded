/*
 * The team overview as a dashboard (W5, Q10): getting started for a new team,
 * the counts (each a link), what needs attention and the recent changes.
 * Members get what they can use instead (W13). Members, usage, keys, crawl
 * domains and the audit log are in Team settings (D1); old ?tab= links
 * redirect there (router.tsx).
 */
import { TextLink } from "@/components/ui/text-link/text-link";
import { Link } from "@tanstack/react-router";
import { Bot, Plus, Settings } from "lucide-react";
import { roleLabels } from "../../../components/roles";
import { requestIntent } from "../../../lib/intents";
import { terms } from "../../../lib/terms";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import s from "../../shared.module.css";
import { useLevelName, useSources, useTeam } from "../common";
import { ArchivedNotice } from "../layout";
import { NeedsAttention } from "./attention";
import { GettingStarted } from "./getting-started";
import { MemberOverview } from "./member";
import { RecentChanges } from "./recent";
import { QuickCounts } from "./stats";

export function TeamOverviewPage() {
  const { slug, team, role, archived } = useTeam();
  const levelName = useLevelName();

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={team.name}
        description={team.description || undefined}
        meta={
          <>
            {role && <Badge tone="info">Your role: {roleLabels[role]}</Badge>}
            <Badge variant="outline">Approved up to {levelName(team.maxClassification)}</Badge>
            {archived && <Badge tone="warning">Archived (read-only)</Badge>}
          </>
        }
        actions={
          <>
            <Button variant="secondary" render={<Link to="/teams/$team/settings" params={{ team: slug }} />}>
              <Settings aria-hidden /> {terms.teamSettings}
            </Button>
            <PrimaryAction />
          </>
        }
      />
      <ArchivedNotice />
      {!role && (
        <Alert tone="info" title="You're viewing this team as platform staff">
          You can see its members in Team settings. Its sources, knowledge bases and keys are private to members.{" "}
          <TextLink render={<Link to="/admin/teams/$team" params={{ team: slug }} />}>Manage the team in Admin</TextLink>
          .
        </Alert>
      )}
      {role === "member" ? <MemberOverview /> : role ? <Dashboard /> : null}
    </Stack>
  );
}

/** "New data source" while the team has none, then "New agent" (editors and above). */
function PrimaryAction() {
  const { slug: team, canEdit } = useTeam();
  const sources = useSources(team);
  if (!canEdit || sources.data === undefined) return null;
  return sources.data.length === 0 ? (
    <Button render={<Link to="/teams/$team/sources" params={{ team }} />} onClick={() => requestIntent("new-source")}>
      <Plus aria-hidden /> New data source
    </Button>
  ) : (
    <Button render={<Link to="/teams/$team/agents" params={{ team }} />} onClick={() => requestIntent("new-agent")}>
      <Bot aria-hidden /> New agent
    </Button>
  );
}

function Dashboard() {
  return (
    <>
      <GettingStarted />
      <QuickCounts />
      <NeedsAttention />
      <RecentChanges />
    </>
  );
}
