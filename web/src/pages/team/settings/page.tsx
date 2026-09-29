/*
 * Team settings (D1): Members · Usage & limits · API keys · Crawl domains ·
 * Audit log · General, as pill tabs (?tab=). The first five host the pages
 * that used to be team tabs or sidebar entries; General holds the team's
 * details and the Danger zone (leave the team).
 */
import { FileClock, Gauge, Globe, KeyRound, Settings, Users } from "lucide-react";
import { PageTabs, useUrlTab } from "../../../components/page-tabs";
import { teamSettingsTabs } from "../../../lib/tabs";
import { terms } from "../../../lib/terms";
import { useCurrentUser } from "../../../session";
import { Alert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import s from "../../shared.module.css";
import { useTeam } from "../common";
import { DomainRequestsPage } from "../domains";
import { ApiKeysPage } from "../keys/page";
import { ArchivedNotice } from "../layout";
import { UsageTab } from "../usage";
import { TeamAuditLog } from "./audit";
import { GeneralTab } from "./general";
import { MembersTab } from "./members";

export function TeamSettingsPage() {
  const { slug, team, role, isManager } = useTeam();
  const me = useCurrentUser();
  const [tab, setTab] = useUrlTab(teamSettingsTabs);
  const staff = me.capabilities.platformAdmin || me.capabilities.platformAuditor;
  // DESIGN §3.5: members see no usage or audit; editors read them.
  const canAudit = isManager || role === "editor" || (!role && staff);
  const canSeeUsage = isManager || role === "editor";

  return (
    <Stack gap={6} className={s.page}>
      <PageHeader title={terms.teamSettings} description={role === "member" ? `The members, API keys and crawl domains of ${team.name}.` : `Members, usage, keys, crawl domains and the audit log of ${team.name}.`} />
      <ArchivedNotice />
      {!role && (
        <Alert tone="info" title="You're viewing this team as platform staff">
          You can see its members and audit log. Its sources, knowledge bases and keys are private to members.
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
            label: "Usage & limits",
            icon: <Gauge aria-hidden />,
            hidden: !canSeeUsage,
            content: <UsageTab team={slug} showSpend={isManager} />,
          },
          { value: "api-keys", label: "API keys", icon: <KeyRound aria-hidden />, hidden: !role, content: <ApiKeysPage embedded /> },
          { value: "crawl-domains", label: terms.crawlDomains, icon: <Globe aria-hidden />, hidden: !role, content: <DomainRequestsPage embedded /> },
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
