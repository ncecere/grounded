/*
 * Admin → Teams › one team (A4, D3): a DetailPage with Overview · Members ·
 * SSO groups (the team's SSO group rules, E1) · Limits (with the Budget
 * card, E2) · Settings. Archive is a menu action and a Danger zone entry (Q12),
 * never a solid red header button.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Bot, Gauge, LayoutDashboard, Network, Settings2, UsersRound } from "lucide-react";
import { useState } from "react";
import { api, ifMatch, unwrap, type Schemas } from "@/api/client";
import { adminTeamQuery } from "@/api/queries";
import { isNotFound, NotFoundState } from "@/components/not-found";
import { DetailPage } from "@/components/templates/detail-page";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { AlertDialog } from "@/components/ui/dialog/dialog";
import { Stack } from "@/components/ui/layout/layout";
import { toast } from "@/components/ui/toast/toast";
import { adminTeamTabs } from "@/lib/tabs";
import { PageSkeleton } from "../../team/layout";
import { ClassificationBadge, useClassificationLevels } from "../../team/common";
import { useIsPlatformAdmin } from "../hooks";
import { RuleList } from "../group-mapping/rules";
import { AdminTeamBudgetCard } from "../costs/team-budget-card";
import { terms } from "@/lib/terms";
import { AdminTeamLimitsCard } from "../limits/team-card";
import { TeamStatusBadge } from "./common";
import { TeamMembersTab } from "./team-members";
import { TeamOverviewTab } from "./team-overview";
import { TeamSettingsTab } from "./team-settings";

/** PATCH the team (details or status) against the loaded revision. */
export function useTeamUpdate(team: string, revision: number | undefined, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Schemas["TeamUpdate"]) => unwrap(await api.PATCH("/v1/admin/teams/{team}", { params: { path: { team }, header: ifMatch(revision!) }, body })),
    onSuccess: (_, body) => {
      onDone?.();
      toast.success(body.status === "archived" ? "Team archived" : body.status === "active" ? "Team unarchived" : "Team saved");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin"] }),
  });
}

export function AdminTeamPage() {
  const { team } = useParams({ from: "/app/admin/teams/$team" });
  const isAdmin = useIsPlatformAdmin();
  const levels = useClassificationLevels();
  const summary = useQuery(adminTeamQuery(team));
  const [archiving, setArchiving] = useState(false);
  const t = summary.data?.team;
  const status = useTeamUpdate(team, t?.revision, () => setArchiving(false));

  if (summary.isLoading) return <PageSkeleton />;
  if (isNotFound(summary.error)) return <NotFoundState what="team" />;
  if (!t || !summary.data) return <ErrorAlert error={summary.error} title="Couldn't load this team" />;
  const archived = t.status === "archived";
  const sum = summary.data;

  return (
    <>
      <DetailPage
        title={t.name}
        meta={<TeamStatusBadge status={t.status} />}
        facts={[
          { label: "Slug", value: <code>{t.slug}</code> },
          { label: "Approved classification", value: <ClassificationBadge levels={levels.data} value={t.maxClassification} /> },
          { label: "Members", value: `${sum.memberCount} ${sum.memberCount === 1 ? "member" : "members"}` },
        ]}
        menuActions={[
          { label: "View the team's agents", icon: <Bot aria-hidden />, render: <Link to="/admin/agents" search={{ team: t.slug }} /> },
          { label: "Unarchive team", icon: <ArchiveRestore aria-hidden />, hidden: !isAdmin || !archived, onSelect: () => status.mutate({ status: "active" }) },
          { label: "Archive team…", icon: <Archive aria-hidden />, danger: true, hidden: !isAdmin || archived, onSelect: () => setArchiving(true) },
        ]}
        notices={archived && <Alert tone="warning">Archived: read-only for its members.</Alert>}
        tabIds={adminTeamTabs}
        tabsLabel="Team sections"
        tabs={[
          { value: "overview", label: "Overview", icon: <LayoutDashboard aria-hidden />, content: <TeamOverviewTab summary={sum} /> },
          { value: "members", label: "Members", icon: <UsersRound aria-hidden />, count: sum.memberCount, content: <TeamMembersTab team={team} isAdmin={isAdmin} /> },
          {
            value: "group-mapping",
            label: terms.groupMapping,
            icon: <Network aria-hidden />,
            content: (
              <RuleList
                team={{ slug: t.slug, name: t.name }}
                isAdmin={isAdmin && !archived}
                description="People in these identity-provider groups get a role in this team when they sign in. Members added by hand are never changed."
              />
            ),
          },
          {
            value: "limits",
            label: "Budget & limits",
            icon: <Gauge aria-hidden />,
            content: (
              <Stack gap={6}>
                <AdminTeamBudgetCard team={team} />
                <AdminTeamLimitsCard team={team} teamName={t.name} />
              </Stack>
            ),
          },
          {
            value: "settings",
            label: "Settings",
            icon: <Settings2 aria-hidden />,
            content: <TeamSettingsTab key={t.revision} team={t} isAdmin={isAdmin} onArchive={() => setArchiving(true)} status={status} />,
          },
        ]}
      />
      <AlertDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={`Archive ${t.name}?`}
        description="The team becomes read-only: members keep access but can't change anything. You can unarchive it later."
        confirmLabel="Archive team"
        busy={status.isPending}
        error={status.error}
        onConfirm={() => status.mutate({ status: "archived" })}
      />
    </>
  );
}
