/*
 * Route loaders (#252): the heaviest pages' records are asked for when their route loads, so with defaultPreload
 * "intent" the request starts on hover with the page's chunk, not after the chunk has loaded and the page mounted.
 * A loader never waits and never fails: the page's own useQuery reads the same cache entry, so loading, 403 and 404
 * render on the page exactly as without it, and the app's 15 s freshness (lib/query-defaults.ts) still decides when a
 * cached record is asked for again.
 */
import type { QueryClient } from "@tanstack/react-query";
import { agentQuery, kbQuery, sourceQuery, teamQuery } from "./api/queries";

export type RouterContext = { queryClient: QueryClient };

/** Neither waited for nor reported: the page's query shows an error, and asks again when it mounts. */
const quietly = (p: Promise<unknown>) => void p.catch(() => {});

/**
 * By route: the record it opens, from its path parameters. ensureQueryData: a cached record (fresh or not) is left to
 * the page's query and its staleTime.
 */
export const loaders = {
  team: (qc: QueryClient, p: { team: string }) => quietly(qc.ensureQueryData(teamQuery(p.team))),
  agent: (qc: QueryClient, p: { team: string; agentId: string }) => quietly(qc.ensureQueryData(agentQuery(p.team, p.agentId))),
  source: (qc: QueryClient, p: { team: string; sourceId: string }) => quietly(qc.ensureQueryData(sourceQuery(p.team, p.sourceId))),
  kb: (qc: QueryClient, p: { team: string; kbId: string }) => quietly(qc.ensureQueryData(kbQuery(p.team, p.kbId))),
};
