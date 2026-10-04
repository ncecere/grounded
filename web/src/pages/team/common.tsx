/*
 * Shared pieces for the team area: the team context provided by the team
 * layout, permission helpers mirroring the server's rules, and the queries
 * several team pages use.
 */
import { formatStorage } from "@/lib/format";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import type { TeamRole } from "../../components/roles";
import { Badge } from "@/components/ui/badge/badge";

export type Team = Schemas["Team"];
export type Doc = Schemas["Document"];
export type DocStatus = Schemas["DocumentStatus"];
export type KB = Schemas["KnowledgeBase"];
export type Classification = Schemas["Classification"];
export type ProfileOption = Schemas["EmbeddingProfileOption"];

export type TeamCtx = {
  /** Team slug, used in API paths and links. */
  slug: string;
  team: Team;
  /** The viewer's role; absent for platform admins/auditors viewing the team. */
  role?: TeamRole;
  archived: boolean;
  /** Editors and above on an active team may change sources and KBs. */
  canEdit: boolean;
  /** Admins and owners. */
  isManager: boolean;
};

export function teamCtx(team: Team, role?: TeamRole): TeamCtx {
  const archived = team.status === "archived";
  const isManager = role === "owner" || role === "admin";
  return {
    slug: team.slug,
    team,
    role,
    archived,
    isManager,
    canEdit: !archived && (isManager || role === "editor"),
  };
}

export const TeamContext = createContext<TeamCtx | null>(null);

/** The current team; only call below the team layout. */
export function useTeam(): TeamCtx {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error("useTeam called outside the team layout");
  return ctx;
}

export const sourcesKey = (team: string) => ["team", team, "sources"];
export const sourceKey = (team: string, id: string) => ["team", team, "source", id];
export const documentsKey = (team: string, id: string) => ["team", team, "source", id, "documents"];
export const kbsKey = (team: string) => ["team", team, "kbs"];
export const kbKey = (team: string, id: string) => ["team", team, "kb", id];
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

/** Classification levels, least to most sensitive. */
export function useClassificationLevels() {
  return useQuery({
    queryKey: ["classifications"],
    queryFn: async () => unwrap(await api.GET("/v1/classifications")),
    select: (list) => [...list].sort((a, b) => a.rank - b.rank),
    staleTime: 60_000,
  });
}

export function useEmbeddingProfiles() {
  return useQuery({
    queryKey: ["embedding-profiles"],
    queryFn: async () => unwrap(await api.GET("/v1/embedding-profiles")),
    staleTime: 60_000,
  });
}

export function useSources(team: string) {
  return useQuery({
    queryKey: sourcesKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/sources", { params: { path: { team } } })),
  });
}

/** Platform-shared sources a team can attach (catalog: metadata and counts only). */
export function useSharedSources() {
  return useQuery({
    queryKey: ["shared-sources"],
    queryFn: async () => unwrap(await api.GET("/v1/shared-sources")),
    staleTime: 30_000,
  });
}

export function useKBs(team: string) {
  return useQuery({
    queryKey: kbsKey(team),
    queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs", { params: { path: { team } } })),
  });
}

/** A function naming a classification level ("Sensitive" for "sensitive"); the key until the levels load. */
export function useLevelName() {
  const levels = useClassificationLevels();
  return (key: string | null | undefined) => (key ? (levels.data?.find((l) => l.key === key)?.name ?? key) : "");
}

/** The rank of a classification key, or undefined when unknown. */
export function rankOf(levels: Classification[] | undefined, key: string | null | undefined) {
  return levels?.find((l) => l.key === key)?.rank;
}

/** Levels a team may use: rank ≤ the team's approved maximum. */
export function allowedLevels(levels: Classification[] | undefined, teamMax: string) {
  const max = rankOf(levels, teamMax);
  if (!levels || max === undefined) return [];
  return levels.filter((l) => l.rank <= max);
}

export function ClassificationBadge({ levels, value }: { levels?: Classification[]; value?: string | null }) {
  if (!value) return <Badge variant="outline">No classification</Badge>;
  const level = levels?.find((l) => l.key === value);
  const rank = level?.rank ?? 0;
  return (
    <Badge tone={rank >= 2 ? "danger" : rank === 1 ? "warning" : "success"} variant="outline">
      {level?.name ?? value}
    </Badge>
  );
}

export function profileName(profiles: ProfileOption[] | undefined, id: string) {
  return profiles?.find((p) => p.id === id)?.name ?? "Unknown profile";
}

/** A size in IEC units, as everywhere (lib/format.ts formatStorage). */
export const formatBytes = (n: number) => formatStorage(n);

export const plural = (n: number, one: string, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** The save bar's text while fields are invalid: "Not saved: fix the highlighted field", or "… the 4 highlighted fields" (BU-16). */
export const notSavedText = (invalidFields: number) =>
  invalidFields > 1 ? `Not saved: fix the ${invalidFields} highlighted fields` : "Not saved: fix the highlighted field";
