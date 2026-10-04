/*
 * The team overview as a dashboard (W5, Q10): getting started for a new team,
 * the counts (each a link), quality and spend (evaluation scores; this
 * month's spend for owners and admins, I3), what needs attention and the
 * recent changes. One primary action: the checklist's current step while it
 * shows, otherwise the header's "New data source" or "New agent".
 * Members get what they can use instead (W13). Members, usage, keys, crawl
 * domains and the audit log are in Team settings (D1); old ?tab= links
 * redirect there (router.tsx).
 */
import { TextLink } from "@/components/ui/text-link/text-link";
import { Link } from "@tanstack/react-router";
import { Bot, Plus, Settings } from "lucide-react";
import { RoleBadge } from "../../../components/role-badge";
import { requestIntent } from "../../../lib/intents";
import { terms } from "../../../lib/terms";
import { PageActions } from "../../../components/templates/page-actions";
import { Alert } from "@/components/ui/alert/alert";
import { Badge } from "@/components/ui/badge/badge";
import { Button } from "@/components/ui/button/button";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import s from "../../shared.module.css";
import { useLevelName, useSources, useTeam } from "../common";
import { ArchivedNotice } from "../layout";
import { NeedsAttention } from "./attention";
import { GettingStarted, useChecklistDismissed, useChecklistShowing } from "./getting-started";
import { MemberOverview } from "./member";
import { QualityAndSpend } from "./quality";
import { RecentChanges } from "./recent";
import { QuickCounts } from "./stats";

export function TeamOverviewPage() {
  const { slug, team, role, archived } = useTeam();
  const levelName = useLevelName();
  const checklist = useChecklistDismissed(slug);

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader
        title={team.name}
        description={team.description || undefined}
        meta={
          <>
            {role && <RoleBadge role={role} prefix="Your role: " tone="info" />}
            {/* The data level the team may hold matters to those who add sources and agents, not to members (US-14). */}
            {role !== "member" && <Badge variant="outline">Approved up to {levelName(team.maxClassification)}</Badge>}
            {archived && <Badge tone="warning">Archived (read-only)</Badge>}
          </>
        }
        actions={
          <PageActions
            secondary={[{ label: terms.teamSettings, icon: <Settings aria-hidden />, render: <Link to="/teams/$team/settings" params={{ team: slug }} /> }]}
            primary={<PrimaryAction checklistDismissed={checklist.dismissed} />}
          />
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
      {role === "member" ? <MemberOverview /> : role ? <Dashboard checklist={checklist} /> : null}
    </Stack>
  );
}

/** "New data source" while the team has none, then "New agent" (editors and above); none while the checklist shows. */
function PrimaryAction({ checklistDismissed }: { checklistDismissed: boolean }) {
  const { canEdit } = useTeam();
  return canEdit ? <EditorPrimaryAction checklistDismissed={checklistDismissed} /> : null;
}

function EditorPrimaryAction({ checklistDismissed }: { checklistDismissed: boolean }) {
  const { slug: team } = useTeam();
  const sources = useSources(team);
  const showing = useChecklistShowing(checklistDismissed);
  if (sources.data === undefined || showing !== false) return null;
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

function Dashboard({ checklist }: { checklist: ReturnType<typeof useChecklistDismissed> }) {
  return (
    <>
      <GettingStarted dismissed={checklist.dismissed} onDismiss={checklist.dismiss} />
      <QuickCounts />
      <QualityAndSpend />
      <NeedsAttention />
      <RecentChanges />
    </>
  );
}
