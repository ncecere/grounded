import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Compass, Home, KeyRound, LifeBuoy, LogOut, MessageSquare, MessagesSquare, Plug, User } from "lucide-react";
import { api, unwrap } from "../../api/client";
import { conversationsQuery } from "../../api/queries";
import { liveGrant, useMyBreakGlass } from "../../lib/break-glass";
import { terms } from "../../lib/terms";
import { InstanceLogo, useInstance, useSignOut, type Me } from "../../session";
import { ProductMark } from "./product-mark";
import { Brand, Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarItem, SidebarNav, SidebarSection, SidebarUser, useAppShell } from "@/components/ui/app-shell/app-shell";
import { Badge } from "@/components/ui/badge/badge";
import { MenuHeader, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu/menu";
import { VisuallyHidden } from "@/components/ui/visually-hidden/visually-hidden";
import styles from "./layout.module.css";
import { type ActiveTeam } from "./active-team";
import { useCapabilities } from "./location";
import { AdminHeader, ModeSwitch, type Mode } from "./mode-switch";
import { TeamSwitcher } from "./team-switcher";
import { ThemeMenuGroup } from "./theme";
import { activeAdminGroup, adminSections, icon, teamNavFor } from "./nav";
import { useAdminGroups } from "./admin-groups";

export function AppSidebar({ me, mode, active }: { me: Me; mode: Mode; active: ActiveTeam }) {
  const signOut = useSignOut();
  const instance = useInstance();
  const { canAdmin } = useCapabilities(me);
  return (
    <Sidebar label={mode === "admin" ? "Admin sidebar" : "Workspace sidebar"}>
      <SidebarHeader>
        <Brand
          name={instance.name}
          logo={instance.logoUrl ? <InstanceLogo src={instance.logoUrl} className={styles.brandLogo} /> : <ProductMark small className={styles.brandLogo} />}
          render={<Link to="/" />}
        />
        {canAdmin && <ModeSwitch mode={mode} />}
        {mode === "admin" ? <AdminHeader /> : <TeamSwitcher me={me} active={active} />}
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav aria-label="Main">{mode === "admin" ? <AdminNav /> : <WorkspaceNav me={me} active={active} />}</SidebarNav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarUser name={me.user.displayName} email={me.user.email}>
          <MenuHeader>
            <strong>{me.user.displayName}</strong>
            {me.user.email}
          </MenuHeader>
          <MenuSeparator />
          <MenuLinkItem icon={<User aria-hidden />} render={<Link to="/settings/profile" />}>
            Profile
          </MenuLinkItem>
          {me.teams.length > 0 && (
            <MenuLinkItem icon={<KeyRound aria-hidden />} render={<Link to="/settings/api-keys" />}>
              API keys
            </MenuLinkItem>
          )}
          <MenuLinkItem icon={<Bell aria-hidden />} render={<Link to="/settings/notifications" />}>
            Notification settings
          </MenuLinkItem>
          <MenuLinkItem icon={<Plug aria-hidden />} render={<Link to="/settings/connected-apps" />}>
            Connected apps
          </MenuLinkItem>
          <MenuSeparator />
          <ThemeMenuGroup />
          <MenuSeparator />
          {instance.supportUrl && (
            <MenuLinkItem href={instance.supportUrl} target="_blank" rel="noreferrer" icon={<LifeBuoy aria-hidden />}>
              Help
            </MenuLinkItem>
          )}
          <MenuItem icon={<LogOut aria-hidden />} onClick={() => signOut.mutate()}>
            Sign out
          </MenuItem>
        </SidebarUser>
      </SidebarFooter>
    </Sidebar>
  );
}

/** The user's latest conversations in the workspace sidebar. */
function RecentConversationsNav() {
  const recent = useQuery(conversationsQuery({ limit: 5 }));
  const shell = useAppShell();
  const items = (recent.data?.items ?? []).filter((c) => !c.agentDeleted);
  if (items.length === 0 || shell?.collapsed) return null;
  return (
    <SidebarSection label="Recent conversations">
      {items.map((c) => (
        <SidebarItem
          key={c.id}
          icon={icon(MessageSquare)}
          label={c.title || c.agentName}
          // Titles repeat ("How do I request a transcript?"): the agent tells them apart.
          description={c.title ? c.agentName : undefined}
          // Long titles are cut off: the whole title on hover (VI-15b).
          render={<Link to="/a/$team/$agent" params={{ team: c.teamSlug, agent: c.agentSlug }} search={{ c: c.id }} activeOptions={{ includeSearch: true }} title={c.title ? `${c.title} · ${c.agentName}` : c.agentName} />}
        />
      ))}
    </SidebarSection>
  );
}

/** Workspace: the same shape on every page (D1). */
function WorkspaceNav({ me, active }: { me: Me; active: ActiveTeam }) {
  const slug = active.slug;
  const breakGlass = useMyBreakGlass(me.capabilities.platformAdmin);
  const breakGlassDocs = Boolean(slug && liveGrant(breakGlass, slug, "documents"));
  return (
    <>
      <SidebarSection label="Workspace">
        <SidebarItem icon={icon(Home)} label={terms.home} render={<Link to="/" activeOptions={{ exact: true }} />} />
        <SidebarItem icon={icon(Compass)} label={terms.discoverAgents} render={<Link to="/agents" />} />
        <SidebarItem icon={icon(MessagesSquare)} label={terms.conversations} render={<Link to="/conversations" />} />
      </SidebarSection>
      {slug && (
        <SidebarSection label={active.name ?? "Team"}>
          {teamNavFor(me, slug, breakGlassDocs).map((item) => (
            <SidebarItem
              key={item.to}
              icon={item.icon}
              label={item.label}
              render={<Link to={item.to} params={{ team: slug }} activeOptions={{ exact: item.exact ?? false }} />}
            />
          ))}
        </SidebarSection>
      )}
      <RecentConversationsNav />
    </>
  );
}

/** Admin groups (D6). Groups collapse (useAdminGroups). */
function AdminNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const groups = useAdminGroups(activeAdminGroup(pathname));
  return adminSections.map((section, i) => (
    <SidebarSection
      key={section.label ?? i}
      label={section.label}
      collapsible={Boolean(section.label)}
      open={section.label ? groups.isOpen(section.label) : undefined}
      onOpenChange={section.label ? (o) => groups.setOpen(section.label!, o) : undefined}
    >
      {section.items
        .map((item) => (
          <SidebarItem
            key={item.to}
            icon={item.icon}
            label={item.label}
            trailing={item.to === "/admin/crawl-domains" ? <PendingRequestsBadge field="pendingDomainRequests" noun="domain request" /> : item.to === "/admin/teams" ? <PendingRequestsBadge field="pendingTeamRequests" noun="team request" /> : undefined}
            render={<Link to={item.to} activeOptions={{ exact: item.exact ?? false }} />}
          />
        ))}
    </SidebarSection>
  ));
}

/** The count of pending domain requests beside Crawl domains (docs/ui-review P-16), and of team requests beside Teams (v0.6.0). */
function PendingRequestsBadge({ field, noun }: { field: "pendingDomainRequests" | "pendingTeamRequests"; noun: string }) {
  const attention = useQuery({
    queryKey: ["admin", "attention"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/attention")),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const n = attention.data?.[field] ?? 0;
  if (n === 0) return null;
  return (
    <Badge size="sm" tone="info">
      {n}
      <VisuallyHidden> pending {noun}{n === 1 ? "" : "s"}</VisuallyHidden>
    </Badge>
  );
}
