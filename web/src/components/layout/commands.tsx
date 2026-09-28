/* The command palette's groups: pages, team actions, agents/KBs/sources by name, teams and admin pages. */
import { useNavigate } from "@tanstack/react-router";
import { Bell, Boxes, Compass, Globe, Home, MessagesSquare, Plus, UserPlus } from "lucide-react";
import { useMemo } from "react";
import { requestIntent, type Intent } from "../../lib/intents";
import { type TeamSettingsTab } from "../../lib/tabs";
import { terms } from "../../lib/terms";
import { type Me } from "../../session";
import { type CommandGroup } from "@/components/ui/command-palette/command-palette";
import { roleLabels } from "../roles";
import { type ActiveTeam } from "./active-team";
import { useEntityCommands } from "./entity-commands";
import { useCapabilities } from "./location";
import { adminKeywords, adminNav, icon, teamNavFor, type AdminPath, type TeamPath } from "./nav";

type Navigate = ReturnType<typeof useNavigate>;
type Membership = Me["teams"][number];
type Item = CommandGroup["items"][number];

function pageGroup(navigate: Navigate, me: Me, slug: string | undefined, mine: Membership | undefined): CommandGroup {
  const pages: CommandGroup = {
    label: "Pages",
    items: [
      { id: "home", label: "Home", icon: icon(Home), hint: "Page", onSelect: () => void navigate({ to: "/" }) },
      { id: "agents", label: terms.discoverAgents, icon: icon(Compass), hint: "Page", keywords: ["agents", "chat", "assistant", "directory"], onSelect: () => void navigate({ to: "/agents" }) },
      {
        id: "conversations",
        label: terms.conversations,
        icon: icon(MessagesSquare),
        hint: "Page",
        keywords: ["history", "chats", "search"],
        onSelect: () => void navigate({ to: "/conversations" }),
      },
      { id: "notifications", label: "Notifications", icon: icon(Bell), hint: "Page", keywords: ["inbox", "alerts"], onSelect: () => void navigate({ to: "/notifications" }) },
      {
        id: "notification-settings",
        label: "Notification settings",
        icon: icon(Bell),
        hint: "Page",
        keywords: ["email", "preferences", "unsubscribe"],
        onSelect: () => void navigate({ to: "/settings/notifications" }),
      },
    ],
  };
  if (slug) {
    for (const item of teamNavFor(me, slug)) {
      pages.items.push({
        id: "team:" + item.to,
        label: item.label,
        icon: item.icon,
        hint: mine?.name ?? "Team",
        keywords: ["team", mine?.name ?? ""],
        onSelect: () => void navigate({ to: item.to, params: { team: slug } }),
      });
    }
  }
  return pages;
}

/** "New …" actions in the current team, by what the user's role allows. */
function teamActionGroup(navigate: Navigate, slug: string, mine: Membership): CommandGroup {
  const active = mine.status === "active";
  const canEdit = active && (mine.role === "owner" || mine.role === "admin" || mine.role === "editor");
  const act = (to: TeamPath, intent: Intent) => () => {
    void navigate({ to, params: { team: slug } });
    requestIntent(intent);
  };
  const settings = (tab: TeamSettingsTab, intent: Intent) => () => {
    void navigate({ to: "/teams/$team/settings", params: { team: slug }, search: { tab: tab === "members" ? undefined : tab } });
    requestIntent(intent);
  };
  const actions: CommandGroup = { label: "Actions", items: [] };
  if (canEdit) {
    actions.items.push(
      { id: "new-source", label: "New data source", icon: <Plus aria-hidden />, keywords: ["create", "upload"], onSelect: act("/teams/$team/sources", "new-source") },
      { id: "new-kb", label: "New knowledge base", icon: <Plus aria-hidden />, keywords: ["create"], onSelect: act("/teams/$team/kbs", "new-kb") },
      { id: "new-agent", label: "New agent", icon: <Plus aria-hidden />, keywords: ["create", "chat", "assistant", "bot"], onSelect: act("/teams/$team/agents", "new-agent") },
      {
        id: "new-domain-request",
        label: "Request a domain",
        icon: <Globe aria-hidden />,
        keywords: ["crawl", "website", "allowlist", "host"],
        onSelect: settings("crawl-domains", "new-domain-request"),
      },
    );
  }
  if (active) {
    actions.items.push({ id: "new-key", label: "New API key", icon: <Plus aria-hidden />, keywords: ["create", "token"], onSelect: settings("api-keys", "new-api-key") });
  }
  if (active && (mine.role === "owner" || mine.role === "admin")) {
    actions.items.push({ id: "add-member", label: "Add member", icon: <UserPlus aria-hidden />, keywords: ["invite", "people", "team"], onSelect: settings("members", "add-member") });
  }
  return actions;
}

function teamsGroup(navigate: Navigate, teams: Me["teams"]): CommandGroup {
  return {
    label: "Teams",
    items: teams.map((t) => ({
      id: "t:" + t.slug,
      label: t.name,
      icon: icon(Boxes),
      hint: roleLabels[t.role],
      keywords: [t.slug, "team"],
      onSelect: () => void navigate({ to: "/teams/$team", params: { team: t.slug } }),
    })),
  };
}

/** Admin pages, plus create actions for platform admins (not auditors). */
function adminGroup(navigate: Navigate, platformAdmin: boolean): CommandGroup {
  const items: Item[] = adminNav.map((n) => ({
    id: "admin:" + n.to,
    label: n.label,
    icon: n.icon,
    hint: "Admin",
    keywords: ["admin", ...(adminKeywords[n.to] ?? [])],
    onSelect: () => void navigate({ to: n.to }),
  }));
  if (platformAdmin) {
    const adminAct = (to: AdminPath, intent: Intent) => () => {
      void navigate({ to });
      requestIntent(intent);
    };
    items.push(
      {
        id: "admin:new-shared-source",
        label: "New shared source",
        icon: <Plus aria-hidden />,
        hint: "Admin",
        keywords: ["create", "website", "upload", "platform"],
        onSelect: adminAct("/admin/shared-sources", "new-shared-source"),
      },
      {
        id: "admin:add-allowlist",
        label: "Add a crawl allowlist pattern",
        icon: <Plus aria-hidden />,
        hint: "Admin",
        keywords: ["crawl", "domain", "host", "allow"],
        onSelect: () => {
          void navigate({ to: "/admin/crawl-domains", search: { tab: "allowlist" } });
          requestIntent("add-allowlist");
        },
      },
    );
  }
  return { label: "Admin", items };
}

/** The palette's groups; `open` loads the agents, KBs and sources to search by name. */
export function useCommands(me: Me, active: ActiveTeam, open: boolean): CommandGroup[] {
  const navigate = useNavigate();
  const { canAdmin } = useCapabilities(me);
  const slug = active.slug;
  const mine = active.membership;
  const entities = useEntityCommands(me, open);

  return useMemo(() => {
    const groups: CommandGroup[] = [pageGroup(navigate, me, slug, mine)];
    if (slug && mine) groups.push(teamActionGroup(navigate, slug, mine));
    groups.push(...entities);
    groups.push(teamsGroup(navigate, me.teams));
    if (canAdmin) groups.push(adminGroup(navigate, me.capabilities.platformAdmin));
    return groups;
    // `me` is only read for its teams (teamNavFor), which are a dependency.
  }, [navigate, slug, mine, entities, me.teams, me.capabilities.platformAdmin, canAdmin]);
}
