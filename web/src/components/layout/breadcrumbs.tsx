import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Bell, Boxes, Compass, Home, MessageSquare, MessagesSquare, Shield } from "lucide-react";
import { adminTeamQuery, adminUserQuery, agentProfileQuery, sharedSourceQuery } from "../../api/queries";
import { agentQuery, kbQuery, sourceQuery, teamQuery } from "../../pages/team/common";
import { type EvalSet, evalSetQuery } from "../../pages/team/evaluations/queries";
import { terms } from "../../lib/terms";
import { useCurrentUser } from "../../session";
import { type BreadcrumbItem } from "@/components/ui/breadcrumbs/breadcrumbs";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import { isNotFound } from "../not-found";
import { type PageCrumb, useCurrentCrumbTail, useCurrentPageCrumbs } from "./crumb-tail";
import { isAdminRoute, isTeamRoute, type Location, useCameFrom } from "./location";
import { adminNav, icon } from "./nav";

/** Labels for the current route, using data the pages have already loaded, plus the page's tail (its active tab). */
export function useBreadcrumbs(loc: Location, canAdmin: boolean): BreadcrumbItem[] {
  const trail = useTrail(loc, canAdmin);
  const tail = useCurrentCrumbTail();
  const pages = useCurrentPageCrumbs();
  const router = useRouter();
  let crumbs = trail;
  // An evaluation set's tab crumb ("Runs") goes while a run or result is open over it: the back link covers it (S6).
  const tabCrumb = tail && !(pages.length > 0 && loc.routeId === "/app/teams/$team/evaluations/$setId");
  if (tabCrumb) {
    // The last crumb becomes a link back to the page's first tab.
    const last = trail[trail.length - 1];
    const linked = last && !last.render ? { ...last, render: <Link to="." search={{}} /> } : last;
    crumbs = [...trail.slice(0, -1), ...(linked ? [linked] : []), { label: tail }];
  }
  if (pages.length === 0) return crumbs;
  // Record and form pages are open on top (bottom first). The crumb under the
  // top page closes it (Back); lower ones go straight to their page.
  const top = pages.length - 1;
  const linkTo = (item: BreadcrumbItem, above: PageCrumb, underTop: boolean): BreadcrumbItem => ({
    ...item,
    render: (
      <a
        href={above.href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          if (underTop) above.close();
          else router.history.push(above.href);
        }}
      />
    ),
  });
  const under = crumbs[crumbs.length - 1];
  const out: BreadcrumbItem[] = crumbs.slice(0, -1);
  if (under) out.push(linkTo(under, pages[0]!, top === 0));
  pages.forEach((p, i) => out.push(i < top ? linkTo({ label: p.label }, pages[i + 1]!, i + 1 === top) : { label: p.label }));
  return out;
}

function useTrail({ routeId, params }: Location, canAdmin: boolean): BreadcrumbItem[] {
  const slug = isTeamRoute(routeId) ? params.team : undefined;
  const team = useQuery({ ...teamQuery(slug ?? ""), enabled: !!slug });
  const sourceId = routeId === "/app/teams/$team/sources/$sourceId" ? params.sourceId : undefined;
  const source = useQuery({ ...sourceQuery(slug ?? "", sourceId ?? ""), enabled: !!slug && !!sourceId });
  const kbId = routeId === "/app/teams/$team/kbs/$kbId" ? params.kbId : undefined;
  const kb = useQuery({ ...kbQuery(slug ?? "", kbId ?? ""), enabled: !!slug && !!kbId });
  const agentId = routeId === "/app/teams/$team/agents/$agentId" ? params.agentId : undefined;
  const agent = useQuery({ ...agentQuery(slug ?? "", agentId ?? ""), enabled: !!slug && !!agentId });
  const setId = routeId === "/app/teams/$team/evaluations/$setId" ? params.setId : undefined;
  const evalSet = useQuery({ ...evalSetQuery(slug ?? "", setId ?? ""), enabled: !!slug && !!setId });
  const chatRef =
    routeId === "/app/a/$team/$agent"
      ? { team: params.team ?? "", agent: params.agent ?? "" }
      : routeId === "/app/a/id/$agentId"
        ? { id: params.agentId ?? "" }
        : routeId === "/app/a/$short"
          ? { short: params.short ?? "" }
          : undefined;
  const profile = useQuery({ ...agentProfileQuery(chatRef ?? { id: "" }), enabled: !!chatRef });
  const userId = routeId === "/app/admin/users/$userId" ? params.userId : undefined;
  const user = useQuery({ ...adminUserQuery(userId ?? ""), enabled: canAdmin && !!userId });
  const adminTeamSlug = routeId === "/app/admin/teams/$team" ? params.team : undefined;
  const adminTeam = useQuery({ ...adminTeamQuery(adminTeamSlug ?? ""), enabled: canAdmin && !!adminTeamSlug });
  const sharedId = routeId === "/app/admin/shared-sources/$sourceId" ? params.sourceId : undefined;
  const shared = useQuery({ ...sharedSourceQuery(sharedId ?? ""), enabled: canAdmin && !!sharedId });
  const cameFrom = useCameFrom();
  const myTeams = useCurrentUser().teams;

  if (routeId === "/app/") return [{ label: "Home", icon: icon(Home) }];
  if (routeId === "/app/agents") return [{ label: terms.discoverAgents, icon: icon(Compass) }];
  if (routeId === "/app/conversations") return [{ label: terms.conversations, icon: icon(MessagesSquare) }];
  // The page sets the conversation's title as the tail.
  if (routeId === "/app/conversations/$conversationId") return [{ label: terms.conversations, icon: icon(MessagesSquare), render: <Link to="/conversations" /> }];
  if (routeId === "/app/notifications") return [{ label: "Notifications", icon: icon(Bell) }];
  if (routeId === "/app/settings/notifications")
    return [{ label: "Notifications", icon: icon(Bell), render: <Link to="/notifications" /> }, { label: "Settings" }];
  if (chatRef)
    return [
      chatParent(profile.data, cameFrom === "/agents", myTeams),
      { label: profile.data?.name ?? ("agent" in chatRef ? chatRef.agent : "short" in chatRef ? chatRef.short : "Agent") },
    ];

  if (slug && isNotFound(team.error)) return [{ label: "Home", icon: icon(Home), render: <Link to="/" /> }];
  if (slug) {
    const crumbs: BreadcrumbItem[] = [
      // Until the team loads, its crumb has no visible text and stays out of the document title (not "… · Team · …").
      { label: team.data?.team.name ?? <VisuallyHidden>Team</VisuallyHidden>, icon: icon(Boxes), render: <Link to="/teams/$team" params={{ team: slug }} /> },
    ];
    const sub = routeId.slice("/app/teams/$team".length);
    if (sub === "/" || sub === "") crumbs.push({ label: "Overview" });
    else if (sub === "/sources") crumbs.push({ label: "Data sources" });
    else if (sub === "/sources/$sourceId")
      crumbs.push(
        { label: "Data sources", render: <Link to="/teams/$team/sources" params={{ team: slug }} /> },
        // An unknown id: the page's not-found tail follows the list crumb.
        ...(isNotFound(source.error) ? [] : [{ label: source.data?.name ?? "Data source" }]),
      );
    else if (sub === "/kbs") crumbs.push({ label: "Knowledge bases" });
    else if (sub === "/kbs/$kbId")
      crumbs.push(
        { label: "Knowledge bases", render: <Link to="/teams/$team/kbs" params={{ team: slug }} /> },
        ...(isNotFound(kb.error) ? [] : [{ label: kb.data?.name ?? "Knowledge base" }]),
      );
    else if (sub === "/agents") crumbs.push({ label: "Agents" });
    else if (sub === "/agents/$agentId")
      crumbs.push(
        { label: "Agents", render: <Link to="/teams/$team/agents" params={{ team: slug }} /> },
        ...(isNotFound(agent.error) ? [] : [{ label: agent.data?.name ?? "Agent" }]),
      );
    else if (sub === "/evaluations/$setId") crumbs.push(...evalSetCrumbs(slug, evalSet.data));
    else if (sub === "/settings") crumbs.push({ label: terms.teamSettings });
    return crumbs;
  }

  // Not an admin: the admin pages show the no-access page under Home.
  if (isAdminRoute(routeId) && !canAdmin) return [{ label: "Home", icon: icon(Home), render: <Link to="/" /> }];
  if (isAdminRoute(routeId)) {
    const crumbs: BreadcrumbItem[] = [{ label: "Admin", icon: icon(Shield), render: <Link to="/admin" /> }];
    if (userId) {
      crumbs.push({ label: "Users", render: <Link to="/admin/users" /> }, ...(isNotFound(user.error) ? [] : [{ label: user.data?.user.displayName ?? "User" }]));
    } else if (adminTeamSlug) {
      crumbs.push({ label: "Teams", render: <Link to="/admin/teams" /> }, ...(isNotFound(adminTeam.error) ? [] : [{ label: adminTeam.data?.team.name ?? adminTeamSlug }]));
    } else if (sharedId) {
      crumbs.push(
        { label: "Shared sources", render: <Link to="/admin/shared-sources" /> },
        ...(isNotFound(shared.error) ? [] : [{ label: shared.data?.name ?? "Shared source" }]),
      );
    } else if (routeId === "/app/admin/break-glass/$sessionId/conversations") {
      crumbs.push({ label: "Break-glass", render: <Link to="/admin/break-glass" /> }, { label: "Conversations" });
    } else {
      const page = adminNav.find((n) => routeId === "/app" + n.to || routeId === "/app" + n.to + "/");
      crumbs.push({ label: page?.label ?? "Administration" });
    }
    return crumbs;
  }

  // An unknown address: NotFoundState adds "Page not found" as the tail.
  return [{ label: "Home", icon: icon(Home), render: <Link to="/" /> }];
}

/**
 * The crumb before a chat's agent: Discover agents when the person came from
 * there, else the agent's team for its members, else "Chat" (docs/v0.2.0.md
 * §7: opened from Home, a link or a conversation, "Discover agents" was wrong).
 */
function chatParent(agent: { teamSlug: string; teamName: string } | undefined, fromDirectory: boolean, myTeams: { slug: string }[]): BreadcrumbItem {
  if (fromDirectory) return { label: terms.discoverAgents, icon: icon(Compass), render: <Link to="/agents" /> };
  if (agent && myTeams.some((t) => t.slug === agent.teamSlug))
    return { label: agent.teamName, icon: icon(Boxes), render: <Link to="/teams/$team" params={{ team: agent.teamSlug }} /> };
  return { label: "Chat", icon: icon(MessageSquare) };
}

/** "Data sources · Office of the Registrar · <instance>": the last two crumbs, most specific first (D8). */
export function documentTitle(crumbs: BreadcrumbItem[], instanceName: string) {
  const labels = crumbs.map((c) => (typeof c.label === "string" ? c.label : "")).filter(Boolean);
  return [...labels.slice(-2).reverse(), instanceName].join(" · ");
}

/**
 * An evaluation set, where its knowledge base's or agent's page puts it,
 * with the middle collapsed (S6): Team › … › the set, where "…" (named
 * "Student help, Evaluations" for screen readers, the full path as its
 * title) opens that page's Evaluations tab. bitop-ui's Breadcrumbs has no
 * collapsed item of its own yet.
 */
function evalSetCrumbs(slug: string, set: EvalSet | undefined): BreadcrumbItem[] {
  if (!set) return [{ label: "Evaluation set" }];
  const t = set.target;
  const agent = t.type === "agent";
  const path = `${agent ? "Agents" : "Knowledge bases"} › ${t.name} › Evaluations`;
  const render = agent ? (
    <Link to="/teams/$team/agents/$agentId" params={{ team: slug, agentId: t.id }} search={{ tab: "evaluations" }} title={path} />
  ) : (
    <Link to="/teams/$team/kbs/$kbId" params={{ team: slug, kbId: t.id }} search={{ tab: "evaluations" }} title={path} />
  );
  const label = (
    <>
      <span aria-hidden="true">…</span>
      <VisuallyHidden>{`${t.name}, Evaluations`}</VisuallyHidden>
    </>
  );
  return [{ label, render }, { label: set.name }];
}
