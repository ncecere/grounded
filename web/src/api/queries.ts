/*
 * Queries shared by the app shell (breadcrumbs) and the pages. They live
 * here, not in the page modules, so the shell doesn't pull lazily loaded
 * pages into the main bundle.
 */
import { queryOptions } from "@tanstack/react-query";
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

export const sharedSourceKey = (id: string) => ["admin", "shared-source", id];

/** One platform-shared source (admin view). */
export const sharedSourceQuery = (sourceId: string) =>
  queryOptions({
    queryKey: sharedSourceKey(sourceId),
    queryFn: async () => unwrap(await api.GET("/v1/admin/shared-sources/{sourceId}", { params: { path: { sourceId } } })),
  });

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
