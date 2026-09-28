/*
 * ⌘K finds objects by name on the server (E15, GET /v1/search): agents,
 * knowledge bases and sources of all the user's teams, agents they may chat
 * with, their own conversations, and for platform staff teams, users,
 * models, connections, embedding profiles and shared sources. The palette's
 * own lists (pages, actions, teams, admin pages) stay local and instant;
 * these results arrive as you type (debounced; a newer query cancels the
 * older request) and are filtered locally as you keep typing.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, ClipboardCheck, Cpu, Database, Layers, Library, MessageSquare, MessagesSquare, Plug, Share2, UserRound, UsersRound } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import { type CommandGroup } from "@/components/ui/command-palette/command-palette";

type Result = Schemas["SearchResult"];
type Navigate = ReturnType<typeof useNavigate>;

/** The palette's accessible name; its combobox carries it too. */
export const PALETTE_LABEL = "Command palette";
export const MIN_QUERY = 2;
export const SEARCH_DEBOUNCE_MS = 180;
const LIMIT = 30;

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const statusLabels: Record<string, string> = {
  archived: "Archived",
  suspended: "Suspended",
  disabled: "Disabled",
  retired: "Retired",
  paused: "Paused",
  agent_deleted: "Agent deleted",
};
const kindLabels: Record<string, string> = {
  chat: "Chat model",
  embedding: "Embedding model",
  rerank: "Rerank model",
  moderation: "Moderation model",
  systemone: "SystemOne model",
  vision: "Vision model",
  upload: "Uploads",
  web: "Website",
  knowledge_base: "Knowledge base set",
  agent: "Agent set",
};

/** "Team name · Archived": the secondary line and the state, when not the usual one. */
const hint = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ") || undefined;
const state = (r: Result) => (r.status ? (statusLabels[r.status] ?? r.status) : undefined);
const kind = (r: Result) => (r.kind ? (kindLabels[r.kind] ?? r.kind) : undefined);

/**
 * How one kind of result becomes a command: its group, icon, hint, extra
 * search words, and where it goes (`go` returns undefined when the result
 * can't be opened this way, e.g. an agent the user may chat with but not
 * edit has no Agents entry).
 */
type Spec = {
  group: string;
  icon: ReactNode;
  hint: (r: Result) => string | undefined;
  keywords: (r: Result) => string[];
  go: (r: Result, nav: Navigate) => (() => void) | undefined;
};

const record = (to: "/admin/models" | "/admin/connections" | "/admin/embedding-profiles") => (r: Result, nav: Navigate) => () =>
  void nav({ to, search: { record: r.id } as never });
const withState = (r: Result) => hint(r.secondary, state(r));

const specs: Record<Result["type"], Spec[]> = {
  team: [
    {
      group: "Teams in Admin",
      icon: <UsersRound aria-hidden />,
      hint: (r) => hint("Admin", state(r)),
      keywords: (r) => [r.secondary, "team", "admin"],
      go: (r, nav) => () => void nav({ to: "/admin/teams/$team", params: { team: r.teamSlug ?? r.secondary } }),
    },
  ],
  user: [
    {
      group: "Users",
      icon: <UserRound aria-hidden />,
      hint: withState,
      keywords: (r) => [r.secondary, "user", "person"],
      go: (r, nav) => () => void nav({ to: "/admin/users/$userId", params: { userId: r.id } }),
    },
  ],
  model: [{ group: "Models", icon: <Cpu aria-hidden />, hint: (r) => hint(kind(r), state(r)), keywords: (r) => [r.secondary, r.kind ?? "", "model"], go: record("/admin/models") }],
  connection: [{ group: "Connections", icon: <Plug aria-hidden />, hint: withState, keywords: (r) => [r.secondary, "connection", "gateway"], go: record("/admin/connections") }],
  embedding_profile: [
    { group: "Embedding profiles", icon: <Layers aria-hidden />, hint: withState, keywords: (r) => [r.secondary, "embedding profile"], go: record("/admin/embedding-profiles") },
  ],
  shared_source: [
    {
      group: "Shared sources",
      icon: <Share2 aria-hidden />,
      hint: (r) => hint(kind(r), state(r)),
      keywords: (r) => ["shared source", r.kind ?? ""],
      go: (r, nav) => () => void nav({ to: "/admin/shared-sources/$sourceId", params: { sourceId: r.id } }),
    },
  ],
  agent: [
    {
      group: "Chat with an agent",
      icon: <MessageSquare aria-hidden />,
      hint: (r) => r.secondary,
      keywords: (r) => ["chat", r.secondary],
      go: ({ canChat, teamSlug: team, agentSlug: agent }, nav) => (canChat && team && agent ? () => void nav({ to: "/a/$team/$agent", params: { team, agent } }) : undefined),
    },
    {
      group: "Agents",
      icon: <Bot aria-hidden />,
      hint: (r) => r.secondary,
      keywords: (r) => ["agent", "edit", "configure", r.secondary],
      go: ({ canOpen, teamSlug: team, id }, nav) => (canOpen && team ? () => void nav({ to: "/teams/$team/agents/$agentId", params: { team, agentId: id } }) : undefined),
    },
  ],
  knowledge_base: [
    {
      group: "Knowledge bases",
      icon: <Library aria-hidden />,
      hint: (r) => r.secondary,
      keywords: (r) => ["knowledge base", "kb", r.secondary],
      go: ({ teamSlug: team, id }, nav) => (team ? () => void nav({ to: "/teams/$team/kbs/$kbId", params: { team, kbId: id } }) : undefined),
    },
  ],
  data_source: [
    {
      group: "Data sources",
      icon: <Database aria-hidden />,
      hint: withState,
      keywords: (r) => ["source", "data source", "documents", r.secondary],
      go: ({ teamSlug: team, id }, nav) => (team ? () => void nav({ to: "/teams/$team/sources/$sourceId", params: { team, sourceId: id } }) : undefined),
    },
  ],
  evaluation_set: [
    {
      group: "Evaluation sets",
      icon: <ClipboardCheck aria-hidden />,
      hint: (r) => hint(r.secondary, kind(r)),
      keywords: (r) => ["evaluation", "test questions", "regression", r.secondary],
      go: ({ teamSlug: team, id }, nav) => (team ? () => void nav({ to: "/teams/$team/evaluations/$setId", params: { team, setId: id } }) : undefined),
    },
  ],
  conversation: [
    {
      group: "Conversations",
      icon: <MessagesSquare aria-hidden />,
      hint: withState,
      keywords: (r) => ["conversation", "chat", "history", r.secondary],
      go: ({ teamSlug: team, agentSlug: agent, id }, nav) => (team && agent ? () => void nav({ to: "/a/$team/$agent", params: { team, agent }, search: { c: id } }) : undefined),
    },
  ],
};

/** Groups results by type, in the order their best match came (the server ranks them). */
export function searchGroups(results: Result[], navigate: Navigate): CommandGroup[] {
  const groups = new Map<string, CommandGroup>();
  for (const r of results) {
    for (const spec of specs[r.type] ?? []) {
      const onSelect = spec.go(r, navigate);
      if (!onSelect) continue;
      const g = groups.get(spec.group) ?? { label: spec.group, items: [] };
      g.items.push({ id: `s:${spec.group}:${r.id}`, label: r.label, icon: spec.icon, hint: spec.hint(r), keywords: spec.keywords(r), onSelect });
      groups.set(spec.group, g);
    }
  }
  return [...groups.values()];
}

/** The palette's server results for what is typed, and whether a search is on its way. */
export function useSearchCommands(open: boolean, query: string): { groups: CommandGroup[]; searching: boolean } {
  const navigate = useNavigate();
  const text = query.trim();
  const q = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const enabled = open && q.length >= MIN_QUERY;
  const res = useQuery({
    queryKey: ["search", q],
    // The signal cancels a request whose query is no longer wanted.
    queryFn: async ({ signal }) => unwrap(await api.GET("/v1/search", { params: { query: { q, limit: LIMIT } }, signal })),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const data = enabled && text.length >= MIN_QUERY ? res.data : undefined;
  const groups = useMemo(() => searchGroups(data ?? [], navigate), [data, navigate]);
  const searching = open && text.length >= MIN_QUERY && (text !== q || res.isFetching);
  return { groups, searching };
}
