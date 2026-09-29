/*
 * ⌘K finds objects by name on the server (E15, GET /v1/search): agents,
 * knowledge bases and sources of all the user's teams, agents they may chat
 * with, their own conversations, and for platform staff teams, users,
 * models, connections, embedding profiles and shared sources. The palette's
 * own lists (pages, actions, teams, admin pages) stay local and instant;
 * these results arrive as you type (debounced; a newer query cancels the
 * older request) and are filtered locally as you keep typing. The text that
 * found a result is one of its keywords, so a match the palette can't see
 * (an agent's description) stays listed.
 *
 * Closing the palette cancels a search on its way and drops its results, and
 * reopening it never searches for the text of the last time (docs/v0.2.0.md
 * §7, M5). Conversations are capped at three, with "More conversations…".
 */
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, ClipboardCheck, Cpu, Database, Layers, Library, MessageSquare, MessagesSquare, Plug, Search, Share2, UserRound, UsersRound } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { api, unwrap, type Schemas } from "../../api/client";
import { type CommandGroup } from "@/components/ui/command-palette/command-palette";
import { formatDate, formatRelativeTime } from "@/lib/bitop-format";

type Result = Schemas["SearchResult"];
type Navigate = ReturnType<typeof useNavigate>;

/** The palette's accessible name; its combobox carries it too. */
export const PALETTE_LABEL = "Command palette";
export const MIN_QUERY = 2;
export const SEARCH_DEBOUNCE_MS = 180;
const LIMIT = 30;
/** Conversations shown before "More conversations…" (they often outnumber everything else). */
export const CONVERSATION_HITS = 3;
const searchKey = ["search"] as const;

/** `value` after it stopped changing for `ms`; clearing it is immediate, so a reopened palette never searches for the old text. */
function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  // Cleared: forget the old text now (a state update during render), or the
  // first key typed after reopening would search for it.
  if (value === "" && v !== "") setV("");
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return value === "" ? "" : v;
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
      // Conversations often share a title: "Helper · 3 days ago" tells them apart.
      hint: (r) => hint(r.secondary, formatRelativeTime(r.updatedAt) || undefined, state(r)),
      keywords: (r) => ["conversation", "chat", "history", r.secondary],
      go: ({ teamSlug: team, agentSlug: agent, id }, nav) => (team && agent ? () => void nav({ to: "/a/$team/$agent", params: { team, agent }, search: { c: id } }) : undefined),
    },
  ],
};

/**
 * The first CONVERSATION_HITS conversations, then "More conversations…"
 * (the Conversations page searching for the same text). Conversations with
 * the same title show their agent and exact date instead of a relative one.
 */
function capConversations(results: Result[], text: string, navigate: Navigate): { shown: Result[]; more?: CommandGroup["items"][number] } {
  const conversations = results.filter((r) => r.type === "conversation");
  const kept = new Set(conversations.slice(0, CONVERSATION_HITS));
  const shown = results.filter((r) => r.type !== "conversation" || kept.has(r));
  if (conversations.length <= CONVERSATION_HITS) return { shown };
  return {
    shown,
    more: {
      id: "s:Conversations:more",
      label: "More conversations…",
      icon: <Search aria-hidden />,
      hint: "Conversations page",
      keywords: [text, "conversation", "history"],
      onSelect: () => void navigate({ to: "/conversations", search: { q: text } as never }),
    },
  };
}

const sameTitle = (rs: Result[]) => {
  const seen = new Map<string, number>();
  for (const r of rs) if (r.type === "conversation") seen.set(r.label.toLowerCase(), (seen.get(r.label.toLowerCase()) ?? 0) + 1);
  return (r: Result) => (seen.get(r.label.toLowerCase()) ?? 0) > 1;
};

/**
 * Groups results by type, in the order their best match came (the server
 * ranks them). `text` is what found them: it is kept as a keyword, and
 * "More conversations…" searches for it.
 */
export function searchGroups(results: Result[], navigate: Navigate, text = ""): CommandGroup[] {
  const { shown, more } = capConversations(results, text, navigate);
  const duplicate = sameTitle(shown);
  const groups = new Map<string, CommandGroup>();
  for (const r of shown) {
    for (const spec of specs[r.type] ?? []) {
      const onSelect = spec.go(r, navigate);
      if (!onSelect) continue;
      const g = groups.get(spec.group) ?? { label: spec.group, items: [] };
      const itemHint = r.type === "conversation" && duplicate(r) ? hint(r.secondary, formatDate(r.updatedAt) || undefined, state(r)) : spec.hint(r);
      const keywords = text ? [...spec.keywords(r), text] : spec.keywords(r);
      g.items.push({ id: `s:${spec.group}:${r.id}`, label: r.label, icon: spec.icon, hint: itemHint, keywords, onSelect });
      groups.set(spec.group, g);
    }
  }
  if (more) groups.get("Conversations")?.items.push(more);
  return [...groups.values()];
}

/** The palette's server results for what is typed, and whether a search is on its way. */
export function useSearchCommands(open: boolean, query: string): { groups: CommandGroup[]; searching: boolean } {
  const navigate = useNavigate();
  const client = useQueryClient();
  const text = open ? query.trim() : "";
  const q = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const enabled = open && q.length >= MIN_QUERY;
  const res = useQuery({
    queryKey: [...searchKey, q],
    // The signal cancels a request whose query is no longer wanted.
    // The results remember the text that found them (a placeholder shows the last text's results).
    queryFn: async ({ signal }) => ({ q, results: unwrap(await api.GET("/v1/search", { params: { query: { q, limit: LIMIT } }, signal })) }),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  // Closing the palette cancels a search on its way: nothing arrives for a closed palette.
  useEffect(() => {
    if (!open) void client.cancelQueries({ queryKey: searchKey });
  }, [open, client]);
  const data = enabled && text.length >= MIN_QUERY ? res.data : undefined;
  const groups = useMemo(() => searchGroups(data?.results ?? [], navigate, data?.q), [data, navigate]);
  const searching = open && text.length >= MIN_QUERY && (text !== q || res.isFetching);
  return { groups, searching };
}
