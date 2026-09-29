import { Archive, BarChart3, Bot, ClipboardCheck, Cpu, Earth, ShieldCheck, Database, Gauge, Globe, Home, LayoutDashboard, Layers, Library, LockOpen, Network, Plug, Scale, ScanText, ScrollText, Settings, Share2, Shuffle, Sparkles, Tags, Users, UsersRound, Wrench, CircleDollarSign, ToggleRight, Wallet } from "lucide-react";
import { type ReactNode } from "react";
import { terms } from "../../lib/terms";
import { type Me } from "../../session";

export const icon = (C: typeof Home) => <C aria-hidden />;

export type AdminPath =
  | "/admin"
  | "/admin/users"
  | "/admin/teams"
  | "/admin/group-mapping"
  | "/admin/classifications"
  | "/admin/connections"
  | "/admin/models"
  | "/admin/embedding-profiles"
  | "/admin/systemone"
  | "/admin/shared-sources"
  | "/admin/crawl-domains"
  | "/admin/parsing"
  | "/admin/limits"
  | "/admin/agents"
  | "/admin/analytics"
  | "/admin/costs"
  | "/admin/moderation"
  | "/admin/public-access"
  | "/admin/maintenance"
  | "/admin/retention"
  | "/admin/break-glass"
  | "/admin/logs";

export type AdminNavItem = { to: AdminPath; label: string; icon: ReactNode; exact?: boolean; /** Only when a SystemOne model exists. */ systemOne?: boolean };

/**
 * Admin sidebar groups (D6; regrouped in v0.2.1, I1): Overview and 7 groups, 21 items.
 * Profile migrations is a tab of Embedding profiles and Legal holds a tab of
 * Retention (adminTabCommands keeps both in ⌘K).
 */
export const adminSections: { label?: string; items: AdminNavItem[] }[] = [
  { items: [{ to: "/admin", label: terms.adminOverview, icon: icon(LayoutDashboard), exact: true }] },
  {
    label: "People",
    items: [
      { to: "/admin/users", label: "Users", icon: icon(Users) },
      { to: "/admin/teams", label: "Teams", icon: icon(UsersRound) },
      { to: "/admin/group-mapping", label: terms.groupMapping, icon: icon(Network) },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/shared-sources", label: "Shared sources", icon: icon(Share2) },
      { to: "/admin/agents", label: "Agents", icon: icon(Bot) },
      { to: "/admin/crawl-domains", label: terms.crawlDomains, icon: icon(Globe) },
      { to: "/admin/parsing", label: "Parsing & OCR", icon: icon(ScanText) },
    ],
  },
  {
    label: "Models",
    items: [
      { to: "/admin/connections", label: "Connections", icon: icon(Plug) },
      { to: "/admin/models", label: "Models", icon: icon(Cpu) },
      { to: "/admin/embedding-profiles", label: "Embedding profiles", icon: icon(Layers) },
      { to: "/admin/systemone", label: "SystemOne", icon: icon(Sparkles), systemOne: true },
    ],
  },
  {
    label: "Usage & spend",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: icon(BarChart3) },
      { to: "/admin/costs", label: "Costs", icon: icon(CircleDollarSign) },
      { to: "/admin/limits", label: "Limits", icon: icon(Gauge) },
    ],
  },
  {
    label: "Safety",
    items: [
      { to: "/admin/classifications", label: "Classifications", icon: icon(Tags) },
      { to: "/admin/moderation", label: "Moderation", icon: icon(ShieldCheck) },
      { to: "/admin/public-access", label: "Public access", icon: icon(Earth) },
    ],
  },
  {
    label: "Records",
    items: [
      { to: "/admin/logs", label: terms.logs, icon: icon(ScrollText) },
      { to: "/admin/retention", label: "Retention", icon: icon(Archive) },
      { to: "/admin/break-glass", label: "Break-glass", icon: icon(LockOpen) },
    ],
  },
  { label: "Operations", items: [{ to: "/admin/maintenance", label: "Maintenance", icon: icon(Wrench) }] },
];

/** Admin group labels before v0.2.1 and the group each one's pages mostly went to (remembered open groups, admin-groups.ts). */
export const oldAdminGroups: Record<string, string[]> = { Policy: ["Safety"], Monitoring: ["Usage & spend", "Records"] };

/**
 * Admin places inside a sidebar page, for ⌘K: tabs (Profile migrations and Legal holds, whose old pages
 * redirect there, router.tsx; Budgets) and the Overview's Features card. Their names rank above the page
 * that holds them, so typing "legal holds" or "budget" and pressing Enter opens the place itself.
 */
export const adminTabCommands: { id: string; label: string; to: AdminPath; tab?: string; hash?: string; icon: ReactNode; keywords: string[] }[] = [
  {
    id: "profile-migrations",
    label: "Profile migrations",
    to: "/admin/embedding-profiles",
    tab: "migrations",
    icon: icon(Shuffle),
    keywords: ["profile migration", "embedding migration", "migrate", "re-embed", "switch model", "switch back", "embedding profiles"],
  },
  {
    id: "legal-holds",
    label: "Legal holds",
    to: "/admin/retention",
    tab: "holds",
    icon: icon(Scale),
    keywords: ["legal hold", "litigation", "records request", "preserve", "keep", "hold", "retention"],
  },
  {
    id: "budgets",
    label: "Budgets",
    to: "/admin/costs",
    tab: "budgets",
    icon: icon(Wallet),
    keywords: ["budget", "team budgets", "monthly budget", "extension", "enforce", "track only", "spend limit", "costs"],
  },
  {
    id: "features",
    label: "Features",
    to: "/admin",
    hash: "features",
    icon: icon(ToggleRight),
    keywords: ["feature", "feature switches", "evaluations", "evaluation switch", "turn on", "turn off", "optional", "cost tracking", "overview"],
  },
];

export const adminNav = adminSections.flatMap((section) => section.items);

/** The label of the admin group holding the page at `pathname` (Overview has none). */
export function activeAdminGroup(pathname: string): string | undefined {
  const inside = (to: string, exact?: boolean) => pathname === to || (!exact && pathname.startsWith(to + "/"));
  return adminSections.find((s) => s.items.some((i) => inside(i.to, i.exact)))?.label;
}

/** Extra command-palette search words for admin pages. */
export const adminKeywords: Partial<Record<AdminPath, string[]>> = {
  "/admin": ["overview", "dashboard", "attention", "home", "platform at a glance", "recent changes"],
  "/admin/group-mapping": ["sso", "groups", "identity provider", "idp", "oidc", "membership rules", "access"],
  "/admin/crawl-domains": ["allowlist", "domain requests", "web", "crawling"],
  "/admin/parsing": ["ocr", "scanned", "scan", "tesseract", "tika", "vision", "images", "pdf", "languages"],
  "/admin/limits": ["quota", "usage", "rate limit", "storage", "defaults", "ceilings", "evaluation limits", "questions per set"],
  "/admin/agents": ["kill switch", "disable", "chat", "assistant"],
  "/admin/analytics": ["usage", "dashboard", "answers", "statistics", "report", "csv", "tokens"],
  "/admin/costs": ["spend", "budget", "prices", "pricing", "money", "billing", "currency", "extension", "tokens"],
  "/admin/logs": ["audit log", "access log", "sensitive", "restricted", "who used", "history", "changes"],
  "/admin/moderation": ["guardrail", "safety", "policy", "block", "public", "classifier"],
  "/admin/public-access": ["public", "anonymous", "widget", "embed", "captcha", "turnstile", "switch"],
  "/admin/maintenance": ["maintenance mode", "pause", "ingestion", "downtime", "upgrade", "freeze"],
  "/admin/retention": ["records", "delete", "purge", "keep", "dry run", "transcripts", "period", "legal holds"],
  "/admin/break-glass": ["emergency access", "read team content", "transcripts", "approval", "investigate"],
  "/admin/embedding-profiles": ["embedding", "vectors", "chunking", "passages", "dimensions", "migrations"],
  "/admin/systemone": ["judging", "passages", "rerank", "re-rank", "injection", "judgment", "jev", "typesafe"],
};

export type TeamPath =
  | "/teams/$team"
  | "/teams/$team/sources"
  | "/teams/$team/kbs"
  | "/teams/$team/agents"
  | "/teams/$team/evaluations"
  | "/teams/$team/settings";

export type TeamNavItem = {
  to: TeamPath;
  label: string;
  icon: ReactNode;
  exact?: boolean;
  /** Platform staff who aren't members see it too. */
  staff?: boolean;
  /** Only the team's editors, admins and owners, while evaluations are on. */
  editors?: boolean;
  /** Extra command-palette search words. */
  keywords?: string[];
};

const teamNav: TeamNavItem[] = [
  { to: "/teams/$team", label: "Overview", icon: icon(LayoutDashboard), exact: true, staff: true },
  { to: "/teams/$team/sources", label: "Data sources", icon: icon(Database) },
  { to: "/teams/$team/kbs", label: "Knowledge bases", icon: icon(Library) },
  { to: "/teams/$team/agents", label: "Agents", icon: icon(Bot) },
  {
    to: "/teams/$team/evaluations",
    label: "Evaluations",
    icon: icon(ClipboardCheck),
    editors: true,
    keywords: ["evaluation", "eval", "evals", "test questions", "regression", "score", "quality", "recall"],
  },
  { to: "/teams/$team/settings", label: terms.teamSettings, icon: icon(Settings), staff: true },
];

/** Team pages the user can open: members see all but the editors' pages (Evaluations: editors and above,
 * while evaluations are on, docs/v0.2.1.md §6.2); platform staff who aren't
 * members see the overview and team settings (members), not the content,
 * plus the data sources under a break-glass session with the documents
 * scope (`breakGlassDocuments`, ADR-0024). */
export function teamNavFor(me: Me, slug: string, breakGlassDocuments = false) {
  const mine = me.teams.find((t) => t.slug === slug);
  if (mine) {
    const editor = mine.status === "active" && (mine.role === "owner" || mine.role === "admin" || mine.role === "editor");
    return teamNav.filter((item) => !item.editors || (editor && me.capabilities.evaluations === true));
  }
  return teamNav.filter((item) => item.staff || (breakGlassDocuments && item.to === "/teams/$team/sources"));
}
