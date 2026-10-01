import { Outlet, createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect, useRouterState } from "@tanstack/react-router";
import { type ReactNode, Suspense, lazy as reactLazy } from "react";
import { AppLayout } from "./components/layout/shell";
import { HelpButton, NotFoundState } from "./components/not-found";
import { publicRef } from "./pages/public/session";
import {
  adminTeamTabs,
  analyticsTabs,
  costTabs,
  breakGlassTabs,
  crawlDomainTabs,
  dataSourceTabs,
  editorTabs,
  embeddingProfileTabs,
  oldEditorTabs,
  kbTabs,
  evaluationSetTabs, gapTabs,
  limitTabs,
  logTabs,
  moderationTabs,
  movedLegalHoldSearch,
  renamedTabHref,
  notificationTabs,
  retentionTabs,
  sourceTabs,
  tabSearch,
  teamSettingsTabs,
} from "./lib/tabs";
import { InstanceSync, SignInPage, useCurrentUser, useInstance, useMe } from "./session";
import { ErrorAlert } from "@/components/ui/alert/alert";
import { Stack } from "@/components/ui/layout/layout";
import { Loading } from "@/components/ui/spinner/spinner";
import { Toaster } from "@/components/ui/toast/toast";
import styles from "./router.module.css";

/*
 * Pages load on demand, one chunk per page module (a feature folder's
 * routes.ts groups its pages into one); the shell (router, session, layout
 * and UI library) stays in the main bundle.
 */
const pages = {
  user: () => import("./pages/user"),
  people: () => import("./pages/admin/people/routes"),
  models: () => import("./pages/admin/models/routes"),
  policy: () => import("./pages/admin/policy"),
  moderation: () => import("./pages/admin/moderation/page"),
  crawling: () => import("./pages/admin/crawling/page"),
  limits: () => import("./pages/admin/limits/platform"),
  shared: () => import("./pages/admin/shared"),
  kbs: () => import("./pages/team/kbs/routes"),
  evaluations: () => import("./pages/team/evaluations/routes"), gaps: () => import("./pages/team/gaps/gaps-page"),
  teamLayout: () => import("./pages/team/layout"),
  teamSettings: () => import("./pages/team/settings/page"),
  conversations: () => import("./pages/conversations/page"),
  transcript: () => import("./pages/conversations/transcript"),
  adminOverview: () => import("./pages/admin/overview/page"),
  logs: () => import("./pages/admin/logs/page"),
  sources: () => import("./pages/team/sources"),
  agents: () => import("./pages/agents/list"),
  agentEditor: () => import("./pages/agents/editor"),
  chat: () => import("./pages/chat/chat"),
  directory: () => import("./pages/chat/directory"),
  adminAgents: () => import("./pages/admin/agents/routes"),
  adminAnalytics: () => import("./pages/admin/analytics/page"),
  costs: () => import("./pages/admin/costs/page"),
  notifications: () => import("./pages/notifications/routes"),
  publicAccess: () => import("./pages/admin/public-access/page"),
  maintenance: () => import("./pages/admin/maintenance/page"),
  retention: () => import("./pages/admin/retention/routes"),
  breakGlass: () => import("./pages/admin/break-glass/page"),
  systemone: () => import("./pages/admin/systemone/page"),
  parsing: () => import("./pages/admin/parsing/page"),
  groupMapping: () => import("./pages/admin/group-mapping/page"),
  publicPages: () => import("./pages/public/routes"),
  oauth: () => import("./pages/oauth/routes"),
};
const lazy = lazyRouteComponent;

// Signed-out visitors of /a/{short}, /a/id/{uuid} and a public agent's team
// address /a/{team}/{agent} get the public page.
const PublicAgentPage = reactLazy(() => pages.publicPages().then((m) => ({ default: m.PublicAgentPage })));

/** Shows the sign-in page until there is a session (the public agent page for public agent addresses). */
function SessionGate({ children }: { children: ReactNode }) {
  const me = useMe();
  const { supportUrl } = useInstance();
  const path = useRouterState({ select: (st) => st.location.pathname });
  if (me.isLoading) return <Loading className={styles.fullPage} label="Loading…" />;
  if (me.error) {
    return (
      <main className={styles.fullPage}>
        <Stack gap={4} className={styles.error}>
          <ErrorAlert error={me.error} title="Couldn't load your session" />
          {supportUrl && <HelpButton href={supportUrl} />}
        </Stack>
      </main>
    );
  }
  if (!me.data && publicRef(path)) {
    return (
      <Suspense fallback={<Loading className={styles.fullPage} label="Loading…" />}>
        <PublicAgentPage fallback={<SignInPage />} />
      </Suspense>
    );
  }
  if (!me.data) return <SignInPage />;
  return <>{children}</>;
}

/**
 * The admin portal is only for platform admins and auditors. Others get the
 * no-access page in the workspace shell, and no admin page (or admin API
 * request) is loaded.
 */
function AdminGate() {
  const { capabilities } = useCurrentUser();
  if (!capabilities.platformAdmin && !capabilities.platformAuditor) return <NotFoundState what="forbidden" />;
  return <Outlet />;
}

function Root() {
  // The widget's embed page is framed by other pages (and the Share tab's
  // preview): no toast region of its own, so landmarks stay unique. Toasts sit
  // over the sidebar's footer, so they never cover page content (P-11).
  const embedded = useRouterState({ select: (st) => st.location.pathname.startsWith("/embed/") });
  return (
    <>
      <InstanceSync />
      <Outlet />
      {!embedded && <Toaster position="bottom-left" />}
    </>
  );
}

// The session gate wraps the app (not the root), so routes outside it stay
// possible. Route ids are unchanged ("/app/...").
const rootRoute = createRootRoute({
  component: Root,
  notFoundComponent: () => (
    <SessionGate>
      <AppLayout>
        <NotFoundState />
      </AppLayout>
    </SessionGate>
  ),
});
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: () => (
    <SessionGate>
      <AppLayout />
    </SessionGate>
  ),
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: lazy(pages.user, "HomePage") });
const agentDirectoryRoute = createRoute({ getParentRoute: () => appRoute, path: "agents", component: lazy(pages.directory, "AgentDirectoryPage") });
/** Search, agent and date filters live in the URL (?q=&agent=&range=). */
const conversationsRoute = createRoute({ getParentRoute: () => appRoute, path: "conversations", component: lazy(pages.conversations, "ConversationsPage") });
/** One conversation by ID: read-only when its agent was deleted, otherwise it opens in the chat page. */
const conversationRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "conversations/$conversationId",
  component: lazy(pages.transcript, "ConversationTranscriptPage"),
});
/** ?c=<conversationId> opens a stored conversation. */
const chatSearch = (s: Record<string, unknown>): { c?: string } => (typeof s.c === "string" && s.c ? { c: s.c } : {});
const chatRoute = createRoute({ getParentRoute: () => appRoute, path: "a/$team/$agent", validateSearch: chatSearch, component: lazy(pages.chat, "ChatPage") });
const chatByIdRoute = createRoute({ getParentRoute: () => appRoute, path: "a/id/$agentId", validateSearch: chatSearch, component: lazy(pages.chat, "ChatByIdPage") });
const chatByShortRoute = createRoute({ getParentRoute: () => appRoute, path: "a/$short", validateSearch: chatSearch, component: lazy(pages.chat, "ChatByShortNamePage") });
/** The widget's chat page, outside the app and its session gate. */
const embedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "embed/$agentId",
  validateSearch: (s: Record<string, unknown>): { key?: string; preview?: "1"; team?: string } => ({
    ...(typeof s.key === "string" && s.key ? { key: s.key } : {}),
    ...(s.preview === "1" || s.preview === 1 ? { preview: "1" as const } : {}),
    ...(typeof s.team === "string" && s.team ? { team: s.team } : {}),
  }),
  component: lazy(pages.publicPages, "EmbedPage"),
});
const notificationsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "notifications",
  // ?type= (the Type filter) passes through.
  validateSearch: tabSearch(notificationTabs, { passthrough: true }),
  component: lazy(pages.notifications, "NotificationsPage"),
});
const notificationSettingsRoute = createRoute({ getParentRoute: () => appRoute, path: "settings/notifications", component: lazy(pages.notifications, "NotificationSettingsPage") });
const connectedAppsRoute = createRoute({ getParentRoute: () => appRoute, path: "settings/connected-apps", component: lazy(pages.oauth, "ConnectedAppsPage") });
const teamRoute = createRoute({ getParentRoute: () => appRoute, path: "teams/$team", component: lazy(pages.teamLayout, "TeamLayout") });
type Page = ReturnType<typeof lazyRouteComponent>;

/** The team overview's old tabs, now in Team settings (D1): /teams/x?tab=members → /teams/x/settings. */
const oldTeamTabs = { members: undefined, usage: "usage", audit: "audit" } as const;
const teamIndexRoute = createRoute({
  getParentRoute: () => teamRoute,
  path: "/",
  validateSearch: (s: Record<string, unknown>): { tab?: keyof typeof oldTeamTabs } => (typeof s.tab === "string" && s.tab in oldTeamTabs ? { tab: s.tab as keyof typeof oldTeamTabs } : {}),
  beforeLoad: ({ search, params }) => {
    if (!search.tab) return;
    const tab = oldTeamTabs[search.tab];
    throw redirect({ href: `/teams/${encodeURIComponent(params.team)}/settings${tab ? `?tab=${tab}` : ""}`, replace: true });
  },
  component: lazy(pages.teamLayout, "TeamOverviewPage"),
});
/**
 * Team pages that moved: API keys into Team settings (D1), and crawl domains
 * into a tab of Data sources (I4, docs/v0.2.1.md). Other parameters, such as
 * ?record=, come along.
 */
const teamMovedTo = { "api-keys": "settings?tab=api-keys", "crawl-domains": "sources?tab=crawl-domains" } as const;
const movedHref = (team: string, to: keyof typeof teamMovedTo, searchStr = "") => {
  const rest = new URLSearchParams(searchStr);
  rest.delete("tab");
  const extra = rest.toString();
  return `/teams/${encodeURIComponent(team)}/${teamMovedTo[to]}${extra ? `&${extra}` : ""}`;
};
const teamMoved = <P extends string>(path: P, to: keyof typeof teamMovedTo) =>
  createRoute({
    getParentRoute: () => teamRoute,
    path,
    beforeLoad: ({ params, location }) => {
      throw redirect({ href: movedHref((params as { team: string }).team, to, location.searchStr), replace: true });
    },
  });
const team = <P extends string>(path: P, component: Page) => createRoute({ getParentRoute: () => teamRoute, path, component });
/** A team list page whose filters (?q=, ?trend=…) live in the URL. */
const teamList = <P extends string>(path: P, component: Page) =>
  createRoute({ getParentRoute: () => teamRoute, path, validateSearch: (s: Record<string, unknown>): Record<string, unknown> => s, component });
/** A team page whose sections are tabs (?tab=). */
const teamTabs = <P extends string, T extends string>(path: P, tabs: readonly T[], component: Page, opts?: { passthrough?: boolean }) =>
  createRoute({ getParentRoute: () => teamRoute, path, validateSearch: tabSearch(tabs, opts), component });

/**
 * The agent editor: ?tab= plus its tabs' own parameters (?test=, ?record=,
 * ?range=, ?view=) and the version history (?history=, ?version=). Old links
 * to Configure or Test open Build; ?tab=test also opens the Test panel. The
 * old Versions tab (I6) opens the version history: ?tab=versions →
 * ?history=versions, and its version records ?record=<n> → ?version=<n>.
 */
const agentEditorRoute = createRoute({
  getParentRoute: () => teamRoute,
  path: "agents/$agentId",
  validateSearch: tabSearch(editorTabs, { passthrough: true }),
  beforeLoad: ({ location }) => {
    const q = new URLSearchParams(location.searchStr);
    const tab = q.get("tab");
    if (!oldEditorTabs.includes(tab as (typeof oldEditorTabs)[number])) return;
    q.delete("tab");
    if (tab === "test") q.set("test", "open");
    if (tab === "versions") {
      q.set("history", "versions");
      const record = q.get("record");
      q.delete("record");
      if (record) q.set("version", record);
    }
    const rest = q.toString();
    throw redirect({ href: `${location.pathname}${rest ? `?${rest}` : ""}`, replace: true });
  },
  component: lazy(pages.agentEditor, "AgentEditorPage"),
});

const adminRoute = createRoute({ getParentRoute: () => appRoute, path: "admin", component: AdminGate });
const adminIndexRoute = createRoute({ getParentRoute: () => adminRoute, path: "/", component: lazy(pages.adminOverview, "AdminOverviewPage") });
const admin = <P extends string>(path: P, component: Page) => createRoute({ getParentRoute: () => adminRoute, path, component });
/**
 * Old admin addresses that moved (D6, v0.2.1 I1): to the new page and tab. The
 * other parameters (?record=, filters) are kept; the old page's ?tab= is
 * dropped, or translated by `rewrite` first.
 */
const adminMoved = <P extends string>(
  path: P,
  to: "/admin/logs" | "/admin/crawl-domains" | "/admin/embedding-profiles" | "/admin/retention",
  tab?: "access" | "migrations" | "holds",
  rewrite?: (q: URLSearchParams) => void,
) =>
  createRoute({
    getParentRoute: () => adminRoute,
    path,
    beforeLoad: ({ location }) => {
      const old = new URLSearchParams(location.searchStr);
      rewrite?.(old);
      old.delete("tab");
      const q = new URLSearchParams(tab ? { tab } : {});
      old.forEach((v, k) => q.append(k, v));
      const rest = q.toString();
      // href, not typed search: typing the target's search here would make the route tree's type circular.
      throw redirect({ href: rest ? `${to}?${rest}` : to, replace: true });
    },
  });
/** An admin page with tabs; list filters, ?q= and ?record= pass through (ListPage, RecordSheet). `renamed` redirects old ?tab= values. */
const adminTabs = <P extends string, T extends string>(path: P, tabs: readonly T[], component: Page, opts?: { passthrough?: boolean; renamed?: Record<string, T> }) =>
  createRoute({ getParentRoute: () => adminRoute, path, validateSearch: tabSearch(tabs, { passthrough: true, ...opts }), component, beforeLoad: ({ location }) => {
    const href = opts?.renamed && renamedTabHref(location.pathname, location.searchStr, opts.renamed);
    if (href) throw redirect({ href, replace: true });
  } });

/** Admin → Agents keeps its list filters (?team=, ?audience=, ?status=, ?q=) and ?record= in the URL. */
const adminAgentsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "agents",
  validateSearch: (s: Record<string, unknown>): { team?: string } & Record<string, unknown> => s,
  component: lazy(pages.adminAgents, "AdminAgentsPage"),
});

/** A team's conversations under the admin's break-glass session (ADR-0024); ?record= opens a transcript. */
const breakGlassConversationsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: "break-glass/$sessionId/conversations",
  validateSearch: (s: Record<string, unknown>): Record<string, unknown> => s,
  component: lazy(pages.breakGlass, "BreakGlassConversationsPage"),
});

/** Members · Usage & spend (or limits) · API keys · Audit log · General (D1, I4); ?tab=crawl-domains moved to Data sources. */
const teamSettingsRoute = createRoute({
  getParentRoute: () => teamRoute,
  path: "settings",
  validateSearch: tabSearch(teamSettingsTabs, { passthrough: true }),
  beforeLoad: ({ params, location }) => {
    if (new URLSearchParams(location.searchStr).get("tab") !== "crawl-domains") return;
    throw redirect({ href: movedHref(params.team, "crawl-domains", location.searchStr), replace: true });
  },
  component: lazy(pages.teamSettings, "TeamSettingsPage"),
});
/** Audit · Access (D6). */
const logsRoute = createRoute({ getParentRoute: () => adminRoute, path: "logs", validateSearch: tabSearch(logTabs, { passthrough: true }), component: lazy(pages.logs, "LogsPage") });

const appTree = appRoute.addChildren([
    homeRoute,
    agentDirectoryRoute,
    conversationsRoute,
    conversationRoute,
    notificationsRoute, notificationSettingsRoute, connectedAppsRoute,
    chatByIdRoute,
    chatByShortRoute,
    chatRoute,
    teamRoute.addChildren([
      teamIndexRoute,
      teamTabs("sources", dataSourceTabs, lazy(pages.sources, "SourcesPage"), { passthrough: true }),
      teamTabs("sources/$sourceId", sourceTabs, lazy(pages.sources, "SourceDetailPage"), { passthrough: true }),
      team("kbs", lazy(pages.kbs, "KBsPage")),
      teamTabs("kbs/$kbId", kbTabs, lazy(pages.kbs, "KBDetailPage"), { passthrough: true }),
      teamList("evaluations", lazy(pages.evaluations, "TeamEvaluationsPage")), teamTabs("gaps", gapTabs, lazy(pages.gaps, "TeamGapsPage"), { passthrough: true }),
      teamTabs("evaluations/$setId", evaluationSetTabs, lazy(pages.evaluations, "EvaluationSetPage"), { passthrough: true }),
      team("agents", lazy(pages.agents, "AgentsPage")),
      agentEditorRoute,
      teamSettingsRoute,
      teamMoved("domains", "crawl-domains"),
      teamMoved("api-keys", "api-keys"),
    ]),
    adminRoute.addChildren([
      adminIndexRoute,
      admin("users", lazy(pages.people, "AdminUsersPage")), admin("users/$userId", lazy(pages.people, "AdminUserPage")),
      admin("teams", lazy(pages.people, "AdminTeamsPage")), adminTabs("teams/$team", adminTeamTabs, lazy(pages.people, "AdminTeamPage")),
      admin("group-mapping", lazy(pages.groupMapping, "GroupMappingPage")),
      admin("classifications", lazy(pages.policy, "ClassificationsPage")),
      admin("connections", lazy(pages.models, "ConnectionsPage")),
      admin("models", lazy(pages.models, "ModelsPage")), admin("mcp-servers", lazy(pages.models, "MCPServersPage")),
      adminTabs("embedding-profiles", embeddingProfileTabs, lazy(pages.models, "EmbeddingProfilesPage")),
      adminMoved("profile-migrations", "/admin/embedding-profiles", "migrations"),
      admin("systemone", lazy(pages.systemone, "SystemOnePage")),
      admin("shared-sources", lazy(pages.shared, "SharedSourcesPage")),
      adminTabs("shared-sources/$sourceId", sourceTabs, lazy(pages.shared, "SharedSourceDetailPage"), { passthrough: true }),
      adminTabs("crawl-domains", crawlDomainTabs, lazy(pages.crawling, "CrawlingPage")),
      adminMoved("crawling", "/admin/crawl-domains"),
      admin("parsing", lazy(pages.parsing, "ParsingPage")),
      adminTabs("limits", limitTabs, lazy(pages.limits, "LimitsPage")),
      adminAgentsRoute,
      adminTabs("analytics", analyticsTabs, lazy(pages.adminAnalytics, "AdminAnalyticsPage")),
      adminTabs("costs", costTabs, lazy(pages.costs, "CostsPage")),
      adminTabs("moderation", moderationTabs, lazy(pages.moderation, "ModerationPage")),
      admin("public-access", lazy(pages.publicAccess, "PublicAccessPage")), admin("maintenance", lazy(pages.maintenance, "MaintenancePage")),
      adminTabs("retention", retentionTabs, lazy(pages.retention, "RetentionPage"), { renamed: { report: "dry-run" } }),
      adminMoved("legal-holds", "/admin/retention", "holds", movedLegalHoldSearch),
      adminTabs("break-glass", breakGlassTabs, lazy(pages.breakGlass, "BreakGlassPage")), breakGlassConversationsRoute,
      logsRoute,
      adminMoved("access-log", "/admin/logs", "access"), adminMoved("audit", "/admin/logs"),
    ]),
  ]);

/** The OAuth consent page (docs/mcp.md): behind sign-in, outside the app's shell. */
const OAuthConsentPage = lazy(pages.oauth, "OAuthConsentPage");
const oauthConsentRoute = createRoute({ getParentRoute: () => rootRoute, path: "oauth/consent", component: () => <SessionGate><OAuthConsentPage /></SessionGate> });

export const routeTree = rootRoute.addChildren([appTree, embedRoute, oauthConsentRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  // Shown while a page's chunk loads (after a short delay, so fast loads don't flash).
  defaultPendingComponent: () => <Loading className={styles.pending} label="Loading…" />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
