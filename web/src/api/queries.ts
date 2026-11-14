/*
 * Queries shared by the app shell (breadcrumbs) and the pages. They live
 * here, not in the page modules, so the shell doesn't pull lazily loaded
 * pages into the main bundle.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api, unwrap } from "./client";

/** One user with their memberships (admin). */
export const adminUserQuery = (userId: string) =>
  queryOptions({
    queryKey: ["admin", "user", userId],
    queryFn: async () => unwrap(await api.GET("/v1/admin/users/{userId}", { params: { path: { userId } } })),
  });

/** One team summary (admin). */
export const adminTeamQuery = (team: string) =>
  queryOptions({
    queryKey: ["admin", "team", team],
    queryFn: async () => unwrap(await api.GET("/v1/admin/teams/{team}", { params: { path: { team } } })),
  });

/**
 * A team's spend this month (owners, admins and platform staff). It answers 404 while the team's cost
 * mode is Off, so data means cost tracking is on: Team settings' usage tab and its ⌘K command are then
 * "Usage & spend".
 *
 * Pages use useTeamSpend (pages/team/spend.tsx), which does not ask while the team's budget status says its cost
 * mode is "off" (#132). The 404 is still remembered, for the status failing or a mode that changed in between: a page
 * that mounts later (or a window that gains focus) does not ask again while the answer is in the cache. The cache
 * lasts gcTime (5 minutes) after the last page using it, or until a cost mode changes (forgetTeamSpend).
 */
export const teamSpendQuery = (team: string) =>
  queryOptions({
    queryKey: ["team", team, "spend"],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/spend", { params: { path: { team } } })),
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: (q) => q.state.status !== "error",
  });

export const sharedSourceKey = (id: string) => ["admin", "shared-source", id];

/** One platform-shared source (admin view). */
export const sharedSourceQuery = (sourceId: string) =>
  queryOptions({
    queryKey: sharedSourceKey(sourceId),
    queryFn: async () => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}", { params: { path: { sourceId } } })),
  });

/** What needs a platform admin's attention (the Overview's list and the sidebar's counts): one definition, one request. */
export const attentionQuery = () =>
  queryOptions({
    queryKey: ["admin", "attention"],
    queryFn: async () => unwrap(await api.GET("/v1/admin/attention")),
    staleTime: 60_000,
  });

/** The classification levels as stored (pages/team/common.tsx sorts them by rank; the admin pages read them as they are). */
export const classificationsQuery = () =>
  queryOptions({
    queryKey: ["classifications"],
    queryFn: async () => unwrap(await api.GET("/v1/classifications")),
  });

export const membersKey = (team: string) => ["team", team, "members"];

/** A team's members: the one definition, for every list, picker and filter that reads them. */
export const membersQuery = (team: string) =>
  queryOptions({
    queryKey: membersKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/members", { params: { path: { team } } })),
  });

/** Every team's member list: for a change that can move people in or out of any team (SSO group rules, a user's status). */
export const anyMembers = { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === "team" && q.queryKey[2] === "members" };

/* ---------------- agents and conversations (Phase 3) ---------------- */

export const conversationsKey = ["conversations"];

/** Agents the user may chat with (the directory). */
export const agentDirectoryQuery = (filter: { q?: string; team?: string } = {}) =>
  queryOptions({
    queryKey: ["agent-directory", filter.q ?? "", filter.team ?? ""],
    queryFn: async () => unwrap(await api.GET("/v1/agents", { params: { query: { q: filter.q || undefined, team: filter.team || undefined } } })),
    staleTime: 30_000,
  });

/** The user's latest conversations, optionally for one agent. */
export const conversationsQuery = (opts: { agentId?: string; limit?: number } = {}) =>
  queryOptions({
    queryKey: [...conversationsKey, opts.agentId ?? "all", opts.limit ?? 50],
    queryFn: async () => unwrap(await api.GET("/v1/conversations", { params: { query: { agentId: opts.agentId, limit: opts.limit } } })),
  });

/** One agent's conversations of the user, newest first, 50 a page; fetchNextPage follows the cursor (the chat page's list, #124). */
export const agentConversationsQuery = (agentId: string) =>
  infiniteQueryOptions({
    queryKey: [...conversationsKey, "agent", agentId],
    queryFn: async ({ pageParam }) => unwrap(await api.GET("/v1/conversations", { params: { query: { agentId, cursor: pageParam, limit: 50 } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** A published agent's public profile, by team and slug, by ID or by short name. */
export const agentProfileQuery = (ref: { team: string; agent: string } | { id: string } | { short: string }) =>
  queryOptions({
    queryKey: ["agent-profile", "id" in ref ? ref.id : "short" in ref ? `short:${ref.short}` : `${ref.team}/${ref.agent}`],
    queryFn: async () =>
      "id" in ref
        ? unwrap(await api.GET("/v1/agents/id/{agentId}", { params: { path: { agentId: ref.id } } }))
        : "short" in ref
          ? unwrap(await api.GET("/v1/agents/short/{shortName}", { params: { path: { shortName: ref.short } } }))
          : unwrap(await api.GET("/v1/agents/{team}/{agent}", { params: { path: { team: ref.team, agent: ref.agent } } })),
  });

/* ---------------- one team (["team", slug, …]) ---------------- */

export const sourcesKey = (team: string) => ["team", team, "sources"];
export const sourceKey = (team: string, id: string) => ["team", team, "source", id];
export const documentsKey = (team: string, id: string) => ["team", team, "source", id, "documents"];
export const kbsKey = (team: string) => ["team", team, "kbs"];
export const kbKey = (team: string, id: string) => ["team", team, "kb", id];
/** A knowledge base's embedding-profile migration and its index preview: under the KB, so invalidating the team or the KB reaches them (#252). */
export const kbMigrationKey = (team: string, kbId: string) => [...kbKey(team, kbId), "profile-migration"];
export const indexPreviewKey = (team: string, kbId: string) => [...kbKey(team, kbId), "index-preview"];
/** The team's access groups (a source's Access tab). */
export const accessGroupsKey = (team: string) => ["team", team, "access-groups"];
export const keysKey = (team: string) => ["team", team, "api-keys"];
export const agentsKey = (team: string) => ["team", team, "agents"];
export const agentKey = (team: string, id: string) => ["team", team, "agent", id];

/** The team view (team + the viewer's role). Shared by the team layout and the breadcrumbs. */
export const teamQuery = (team: string) =>
  queryOptions({
    queryKey: ["team", team],
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}", { params: { path: { team } } })),
  });

export const sourceQuery = (team: string, sourceId: string) =>
  queryOptions({
    queryKey: sourceKey(team, sourceId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/sources/{sourceId}", { params: { path: { team, sourceId } } })),
  });

export const kbQuery = (team: string, kbId: string) =>
  queryOptions({
    queryKey: kbKey(team, kbId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs/{kbId}", { params: { path: { team, kbId } } })),
  });

/** One agent with its draft, published summary and warnings (the editor and the breadcrumbs). */
export const agentQuery = (team: string, agentId: string) =>
  queryOptions({
    queryKey: agentKey(team, agentId),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents/{agentId}", { params: { path: { team, agentId } } })),
  });
