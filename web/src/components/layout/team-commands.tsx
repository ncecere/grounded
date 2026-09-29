/*
 * ⌘K places inside a team, with the words people type for them (docs/v0.2.0.md
 * §7): Team settings' tabs (spend, usage, budget → Usage & spend; members;
 * API keys; audit log), Data sources › Crawl domains, and on a knowledge base, agent or
 * source page the tabs of that object (Try it, Evaluations, OCR settings).
 * Admin pages carry their words in nav.tsx (adminKeywords); these mirror
 * them for the workspace. Each command appears only where its tab shows.
 */
import { useNavigate } from "@tanstack/react-router";
import { ClipboardCheck, FileClock, FlaskConical, Gauge, Globe, KeyRound, ScanText, Search, Users } from "lucide-react";
import { type TeamSettingsTab } from "../../lib/tabs";
import { terms } from "../../lib/terms";
import { type Me } from "../../session";
import { type CommandGroup } from "@/components/ui/command-palette/command-palette";
import { type Location } from "./location";

type Navigate = ReturnType<typeof useNavigate>;
type Membership = Me["teams"][number];
type Item = CommandGroup["items"][number];

/** Who may see what in a team (the same rules as the pages). */
type Access = { member: boolean; canEdit: boolean; isManager: boolean; staff: boolean; evaluations: boolean };

export function teamAccess(me: Me, mine: Membership | undefined): Access {
  const active = mine?.status === "active";
  const role = mine?.role;
  const isManager = active && (role === "owner" || role === "admin");
  return {
    member: Boolean(mine),
    canEdit: isManager || (active && role === "editor"),
    isManager,
    staff: me.capabilities.platformAdmin || me.capabilities.platformAuditor,
    evaluations: me.capabilities.evaluations === true,
  };
}

/** Team settings' tabs, with the words people use for them; `spendOn`: the usage tab is "Usage & spend" (cost tracking is on). */
function settingsItems(navigate: Navigate, slug: string, a: Access, spendOn: boolean): Item[] {
  const hint = terms.teamSettings;
  const go = (tab: TeamSettingsTab) => () =>
    void navigate({ to: "/teams/$team/settings", params: { team: slug }, search: { tab: tab === "members" ? undefined : tab } as never });
  const usageWords = ["usage", "limits", "quota", "tokens", "storage", "rate limit"];
  // Spend and budget are on the tab for team owners and admins (the spend card).
  const moneyWords = a.isManager ? ["spend", "spent", "cost", "costs", "budget", "money", "billing", "price"] : [];
  const items: (Item & { show: boolean })[] = [
    {
      id: "team-tab:members",
      label: "Members",
      icon: <Users aria-hidden />,
      keywords: ["member", "people", "invite", "role", "roles", "who", "access", "sso", "owner", "editor"],
      show: a.member || a.staff,
      hint,
      onSelect: go("members"),
    },
    {
      id: "team-tab:usage",
      // Named like the tab it opens (I4): owners and admins see spend there while cost tracking is on.
      label: a.isManager && spendOn ? terms.usageAndSpend : terms.usageAndLimits,
      icon: <Gauge aria-hidden />,
      keywords: [...usageWords, ...moneyWords],
      show: a.canEdit,
      hint,
      onSelect: go("usage"),
    },
    { id: "team-tab:api-keys", label: "API keys", icon: <KeyRound aria-hidden />, keywords: ["key", "token", "secret", "integration"], show: a.member, hint, onSelect: go("api-keys") },
    {
      id: "team-tab:audit",
      label: terms.auditLog,
      icon: <FileClock aria-hidden />,
      keywords: ["audit", "history", "changes", "who changed", "log", "activity"],
      show: a.canEdit || (!a.member && a.staff),
      hint,
      onSelect: go("audit"),
    },
  ];
  return items.filter((i) => i.show).map(({ show: _show, ...item }) => item);
}

/** Data sources › Crawl domains (I4: moved from Team settings), with the words people use for it. */
function crawlDomainsItem(navigate: Navigate, slug: string, a: Access): Item[] {
  if (!a.member) return [];
  return [
    {
      id: "team-tab:crawl-domains",
      label: terms.crawlDomains,
      icon: <Globe aria-hidden />,
      keywords: ["crawl", "domain", "website", "allowlist", "host", "request"],
      hint: "Data sources",
      onSelect: () => void navigate({ to: "/teams/$team/sources", params: { team: slug }, search: { tab: "crawl-domains" } }),
    },
  ];
}

/** The tabs of the knowledge base, agent or source the page shows. */
function objectItems(navigate: Navigate, loc: Location, slug: string, a: Access): Item[] {
  const p = loc.params;
  const tryWords = ["try", "test", "preview", "search", "playground", "question"];
  const evalWords = ["evaluation", "eval", "test questions", "regression", "score", "quality"];
  if (loc.routeId === "/app/teams/$team/kbs/$kbId" && p.kbId) {
    const kb = (tab: "try" | "evaluations") => () => void navigate({ to: "/teams/$team/kbs/$kbId", params: { team: slug, kbId: p.kbId! }, search: { tab } });
    const items: Item[] = [{ id: "kb-tab:try", label: terms.tryIt, icon: <Search aria-hidden />, hint: "This knowledge base", keywords: [...tryWords, "retrieval"], onSelect: kb("try") }];
    if (a.canEdit && a.evaluations) {
      items.push({ id: "kb-tab:evaluations", label: "Evaluations", icon: <ClipboardCheck aria-hidden />, hint: "This knowledge base", keywords: evalWords, onSelect: kb("evaluations") });
    }
    return items;
  }
  if (loc.routeId === "/app/teams/$team/agents/$agentId" && p.agentId && a.canEdit) {
    const to = "/teams/$team/agents/$agentId";
    const params = { team: slug, agentId: p.agentId };
    const items: Item[] = [
      {
        id: "agent-tab:try",
        label: terms.tryIt,
        icon: <FlaskConical aria-hidden />,
        hint: "This agent",
        keywords: [...tryWords, "chat", "draft"],
        onSelect: () => void navigate({ to, params, search: { test: "open" } as never }),
      },
    ];
    if (a.evaluations) {
      items.push({
        id: "agent-tab:evaluations",
        label: "Evaluations",
        icon: <ClipboardCheck aria-hidden />,
        hint: "This agent",
        keywords: evalWords,
        onSelect: () => void navigate({ to, params, search: { tab: "evaluations" } as never }),
      });
    }
    return items;
  }
  if (loc.routeId === "/app/teams/$team/sources/$sourceId" && p.sourceId && a.canEdit) {
    return [
      {
        id: "source-tab:ocr",
        label: "OCR settings",
        icon: <ScanText aria-hidden />,
        hint: "This data source",
        keywords: ["ocr", "scanned", "scan", "images", "text recognition", "tesseract"],
        onSelect: () => void navigate({ to: "/teams/$team/sources/$sourceId", params: { team: slug, sourceId: p.sourceId! }, search: { tab: "settings" }, hash: "ocr" }),
      },
    ];
  }
  return [];
}

/** Places in the current team: its settings tabs, and the page's own tabs. */
export function teamPlacesGroup(
  navigate: Navigate,
  loc: Location,
  me: Me,
  team: { slug: string; name: string; spendOn: boolean },
  mine: Membership | undefined,
): CommandGroup {
  const slug = team.slug;
  const a = teamAccess(me, mine);
  const onTeamPage = loc.routeId.startsWith("/app/teams/$team") && loc.params.team === slug;
  return {
    label: team.name,
    items: [...(onTeamPage ? objectItems(navigate, loc, slug, a) : []), ...settingsItems(navigate, slug, a, team.spendOn), ...crawlDomainsItem(navigate, slug, a)],
  };
}
