import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useParams, useRouterState } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { NotFoundState, isNotFound } from "../../components/not-found";
import type { ReactNode } from "react";
import { Alert, ErrorAlert } from "@/components/ui/alert/alert";
import { Button } from "@/components/ui/button/button";
import { Card } from "@/components/ui/card/card";
import { EmptyState } from "@/components/ui/empty-state/empty-state";
import { Stack } from "@/components/ui/layout/layout";
import { PageHeader } from "@/components/ui/page-header/page-header";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton/skeleton";
import s from "../shared.module.css";
import { liveGrant, useMyBreakGlass } from "../../lib/break-glass";
import { useCurrentUser } from "../../session";
import { BreakGlassNotice } from "./break-glass-notice";
import { BudgetBanner } from "./budget-banner";
import { TeamContext, teamCtx, teamQuery, useTeam } from "./common";
import t from "./team.module.css";

/** The team area: loads the team and provides it to the current team page. */
export function TeamLayout() {
  const { team } = useParams({ from: "/app/teams/$team" });
  const view = useQuery(teamQuery(team));
  const me = useCurrentUser();
  // Platform staff who aren't members may open the overview and team settings.
  const path = useRouterState({ select: (st) => st.location.pathname });
  const staffPage = /^\/teams\/[^/]+(\/settings)?\/?$/.test(path);
  // A platform admin under break-glass with the documents scope may also
  // read the data sources (read-only; every read is audited, ADR-0024).
  const grant = liveGrant(useMyBreakGlass(me.capabilities.platformAdmin), view.data?.team.slug ?? team, "documents");
  const breakGlassPage = Boolean(grant) && /^\/teams\/[^/]+\/sources(\/|$)/.test(path);

  if (view.isLoading) return <PageSkeleton />;
  if (isNotFound(view.error) || (!view.error && !view.data)) return <NotFoundState what="team" />;
  if (view.error) return <ErrorAlert error={view.error} title="Couldn't load this team" />;
  if (!view.data) return null;
  const ctx = teamCtx(view.data.team, view.data.role);
  // Platform staff can see a team's settings and members but not its content,
  // which is private to members. Say so instead of showing a load error.
  if (!view.data.role && !staffPage && !breakGlassPage) {
    return (
      <Stack gap={6} className={s.page}>
        <PageHeader title={view.data.team.name} />
        <Card>
          <EmptyState
            icon={<Lock />}
            title="Only team members can see this."
            description={`${view.data.team.name}'s sources, knowledge bases and keys are private to its members. As platform staff you can ${me.capabilities.platformAdmin ? "manage" : "see"} the team's settings and members.`}
            action={
              <Button render={<Link to="/admin/teams/$team" params={{ team }} />} variant="secondary">
                Open in Admin
              </Button>
            }
          />
        </Card>
      </Stack>
    );
  }

  return (
    <TeamContext.Provider value={ctx}>
      {view.data.role === "owner" && <BreakGlassNotice team={view.data.team.slug} />}
      {view.data.role && <BudgetBanner team={view.data.team.slug} manager={ctx.isManager} />}
      <Outlet />
    </TeamContext.Provider>
  );
}

/** A placeholder page while a team page loads. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading…" className={t.skeleton}>
      <Skeleton width="16rem" height="1.75rem" />
      <SkeletonText lines={2} />
      <div className={s.stats}>
        <Skeleton height="6rem" />
        <Skeleton height="6rem" />
        <Skeleton height="6rem" />
      </div>
      <Skeleton height="14rem" />
    </div>
  );
}

/** The "archived" notice shown on every team page of an archived team. */
export function ArchivedNotice({ children }: { children?: ReactNode }) {
  const { archived } = useTeam();
  if (!archived) return null;
  return (
    <Alert tone="warning" title="This team is archived">
      {children ?? "Its sources, knowledge bases and members can be viewed but not changed."}
    </Alert>
  );
}

export { TeamOverviewPage } from "./overview/page";
