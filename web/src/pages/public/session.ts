/* Anonymous sessions with a public agent (docs/phase4-publishing.md §5): the profile, the current session and starting one. */
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api, unwrap, type Schemas } from "../../api/client";

export type PublicAgent = Schemas["PublicAgent"];

/** A public agent's profile by ID, short name or team address "{team}/{agent}" (anyone). */
export const publicAgentQuery = (ref: string) =>
  queryOptions({
    queryKey: ["public-agent", ref],
    queryFn: async () => {
      const [team, agent] = ref.split("/");
      if (agent !== undefined) return unwrap(await api.GET("/v1/public/teams/{team}/agents/{agent}", { params: { path: { team: team!, agent } } }));
      return unwrap(await api.GET("/v1/public/agents/{agentRef}", { params: { path: { agentRef: ref } } }));
    },
    retry: false,
  });

/** Whether a public ref is a team address ("{team}/{agent}"), which may also be a signed-in-only agent. */
export const isTeamAddress = (ref: string) => ref.includes("/");

/** The visitor's session with an agent and its current conversation; null without one. */
export const publicSessionQuery = (agentId: string) =>
  queryOptions({
    queryKey: ["public-session", agentId],
    queryFn: async () => {
      try {
        return unwrap(await api.GET("/v1/public/sessions/current", { params: { query: { agentId } } }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: Infinity,
  });

export async function startSession(body: Schemas["PublicSessionCreate"]) {
  return unwrap(await api.POST("/v1/public/sessions", { body }));
}

/** The origin of the page that frames this one (the widget's host page), or "". */
export function embeddingOrigin(): string {
  const ancestors = (globalThis.location as Location & { ancestorOrigins?: DOMStringList } | undefined)?.ancestorOrigins;
  if (ancestors && ancestors.length > 0) return ancestors[0] ?? "";
  try {
    return document.referrer ? new URL(document.referrer).origin : "";
  } catch {
    return "";
  }
}

/** The agent ID, short name or "{team}/{agent}" in a public page's path (/a/id/{uuid}, /a/{short} or /a/{team}/{agent}), or null. */
export function publicRef(pathname: string): string | null {
  const byId = /^\/a\/id\/([0-9a-f-]{36})\/?$/i.exec(pathname);
  if (byId) return byId[1]!;
  const team = /^\/a\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/?$/.exec(pathname);
  if (team && team[1] !== "id") return `${team[1]}/${team[2]}`;
  const short = /^\/a\/([a-z0-9][a-z0-9-]{1,39})\/?$/.exec(pathname);
  return short && short[1] !== "id" ? short[1]! : null;
}
