/*
 * Team settings (D1): Members · Usage & spend · API keys · Audit log ·
 * General, as pill tabs (?tab=). The first four host the pages that used to
 * be team tabs or sidebar entries; General holds the team's details and the
 * Danger zone (leave the team). The usage tab (?tab=usage) is "Usage &
 * spend" for those who see the spend (owners and admins while cost tracking
 * is on), "Usage & limits" otherwise (I4). Crawl domains moved to the Data
 * sources page in v0.2.1; the router redirects ?tab=crawl-domains there.
 */
import { Link } from "@tanstack/react-router";
import { FileClock, Gauge, KeyRound, Settings, Users } from "lucide-react";
import { PageTabs, useUrlTab } from "../../../components/page-tabs";
import { teamSettingsTabs } from "../../../lib/tabs";
import { terms } from "../../../lib/terms";
import { useCurrentUser } from "../../../session";
import { Alert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { TextLink } from "@/components/ui/text-link/text-link";
import s from "../../shared.module.css";
import { useTeam } from "../common";
import { ApiKeysPage } from "../keys/page";
import { ArchivedNotice } from "../layout";
import { useTeamSpend } from "../spend";
import { UsageTab } from "../usage";
import { TeamAuditLog } from "./audit";
import { GeneralTab } from "./general";
import { MembersTab } from "./members";

/** The page's description: what its tabs hold for this reader ("Members, usage and spend, API keys, the audit log and general details of …"). */
export function settingsDescription(name: string, { role, spend }: { role?: string; spend: boolean }) {
  if (role === "member") return `The members, API keys and general details of ${name}.`;
  if (!role) return `The members, audit log and general details of ${name}.`;
  return `Members, ${spend ? "usage and spend" : "usage"}, API keys, the audit log and general details of ${name}.`;
}

export function TeamSettingsPage() {
  const { slug, team, role, isManager } = useTeam();
  const me = useCurrentUser();
  const [tab, setTab] = useUrlTab(teamSettingsTabs);
  const staff = me.capabilities.platformAdmin || me.capabilities.platformAuditor;
  // DESIGN §3.5: members see no usage or audit; editors read them.
  const canAudit = isManager || role === "editor" || (!role && staff);
  const canSeeUsage = isManager || role === "editor";
  // The spend shows while the team's cost mode isn't Off (the spend API answers 404 while it is).
  const spend = useTeamSpend(slug, isManager);
  const usageLabel = isManager && spend.data ? terms.usageAndSpend : terms.usageAndLimits;
  // Until the spend answers, the tab's name isn't known: no breadcrumb, so the page title never names the wrong one.
  const usageCrumb = isManager && spend.isPending ? "" : undefined;

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title={terms.teamSettings} description={settingsDescription(team.name, { role, spend: isManager && Boolean(spend.data) })} />
      <ArchivedNotice />
      {!role && (
        // Platform staff who aren't members: usage, spend and limits are on the admin team page (?tab=usage lands here).
        <Alert tone="info" title="You're viewing this team as platform staff">
          You can see its members, audit log and details. Its usage, spend and limits are on its{" "}
          <TextLink render={<Link to="/admin/teams/$team" params={{ team: slug }} />}>admin page</TextLink>; its sources, knowledge bases and keys are
          private to members.
        </Alert>
      )}
      <PageTabs
        label="Team settings sections"
        value={tab}
        onValueChange={setTab}
        crumb="always"
        tabs={[
          { value: "members", label: "Members", icon: <Users aria-hidden />, content: <MembersTab /> },
          {
            value: "usage",
            label: usageLabel,
            icon: <Gauge aria-hidden />,
            hidden: !canSeeUsage,
            crumb: usageCrumb,
            content: <UsageTab team={slug} showSpend={isManager} />,
          },
          { value: "api-keys", label: "API keys", icon: <KeyRound aria-hidden />, hidden: !role, content: <ApiKeysPage embedded /> },
          {
            value: "audit",
            label: terms.auditLog,
            icon: <FileClock aria-hidden />,
            hidden: !canAudit,
            content: <TeamAuditLog />,
          },
          { value: "general", label: "General", icon: <Settings aria-hidden />, content: <GeneralTab /> },
        ]}
      />
    </Stack>
  );
}
