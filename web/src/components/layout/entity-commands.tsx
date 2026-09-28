/*
 * ⌘K finds agents, knowledge bases and sources by name (P-01). While the
 * palette is open it loads the directory (agents the user can chat with)
 * and, for up to MAX_TEAMS of the user's teams, their agents, knowledge
 * bases and sources (the same cached queries the team pages use).
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Database, Library, MessageSquare } from "lucide-react";
import { useMemo } from "react";
import { api, unwrap } from "../../api/client";
import { agentDirectoryQuery } from "../../api/queries";
import { agentsKey, kbsKey, sourcesKey } from "../../pages/team/common";
import { type Me } from "../../session";
import { type CommandGroup } from "@/components/ui/command-palette/command-palette";

export const MAX_TEAMS = 10;
const MAX_ITEMS = 200;

const listQueries = (team: string) => [
  { queryKey: agentsKey(team), queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/agents", { params: { path: { team } } })) },
  { queryKey: kbsKey(team), queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/kbs", { params: { path: { team } } })) },
  { queryKey: sourcesKey(team), queryFn: async () => unwrap(await api.GET("/v1/teams/{team}/sources", { params: { path: { team } } })) },
];

export function useEntityCommands(me: Me, open: boolean): CommandGroup[] {
  const navigate = useNavigate();
  const teams = me.teams.slice(0, MAX_TEAMS);
  const directory = useQuery({ ...agentDirectoryQuery(), enabled: open });
  const lists = useQueries({
    queries: teams.flatMap((t) => listQueries(t.slug).map((q) => ({ ...q, enabled: open, staleTime: 30_000 }))),
  });
  const stamp = lists.map((l) => l.dataUpdatedAt).join(",") + ":" + directory.dataUpdatedAt;

  return useMemo(() => {
    const chat: CommandGroup = { label: "Chat with an agent", items: [] };
    for (const a of (directory.data ?? []).slice(0, MAX_ITEMS)) {
      chat.items.push({
        id: "chat:" + a.id,
        label: a.name,
        icon: <MessageSquare aria-hidden />,
        hint: a.teamName,
        keywords: ["chat", a.teamName, a.description.slice(0, 120)],
        onSelect: () => void navigate({ to: "/a/$team/$agent", params: { team: a.teamSlug, agent: a.slug } }),
      });
    }
    const agents: CommandGroup = { label: "Agents", items: [] };
    const kbs: CommandGroup = { label: "Knowledge bases", items: [] };
    const sources: CommandGroup = { label: "Data sources", items: [] };
    teams.forEach((t, i) => {
      const [ag, kb, src] = [lists[i * 3]?.data, lists[i * 3 + 1]?.data, lists[i * 3 + 2]?.data] as [
        { id: string; name: string }[] | undefined,
        { id: string; name: string }[] | undefined,
        { id: string; name: string }[] | undefined,
      ];
      for (const a of ag ?? []) {
        agents.items.push({
          id: `agent:${t.slug}:${a.id}`,
          label: a.name,
          icon: <Bot aria-hidden />,
          hint: t.name,
          keywords: ["agent", "edit", "configure", t.name],
          onSelect: () => void navigate({ to: "/teams/$team/agents/$agentId", params: { team: t.slug, agentId: a.id } }),
        });
      }
      for (const k of kb ?? []) {
        kbs.items.push({
          id: `kb:${t.slug}:${k.id}`,
          label: k.name,
          icon: <Library aria-hidden />,
          hint: t.name,
          keywords: ["knowledge base", "kb", t.name],
          onSelect: () => void navigate({ to: "/teams/$team/kbs/$kbId", params: { team: t.slug, kbId: k.id } }),
        });
      }
      for (const s of src ?? []) {
        sources.items.push({
          id: `source:${t.slug}:${s.id}`,
          label: s.name,
          icon: <Database aria-hidden />,
          hint: t.name,
          keywords: ["source", "data source", "documents", t.name],
          onSelect: () => void navigate({ to: "/teams/$team/sources/$sourceId", params: { team: t.slug, sourceId: s.id } }),
        });
      }
    });
    return [chat, agents, kbs, sources].map((g) => ({ ...g, items: g.items.slice(0, MAX_ITEMS) })).filter((g) => g.items.length > 0);
    // `stamp` changes whenever one of the lists loads or refreshes.
  }, [stamp, navigate, me.teams]);
}
