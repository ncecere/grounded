import { Archive, BarChart3, Bot, Cpu, Earth, ShieldCheck, Database, Gauge, Globe, Home, LayoutDashboard, Layers, Library, LockOpen, Network, Plug, Scale, ScrollText, Settings, Share2, Shuffle, Sparkles, Tags, Users, UsersRound, Wrench } from "lucide-react";
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
  | "/admin/profile-migrations"
  | "/admin/systemone"
  | "/admin/shared-sources"
  | "/admin/crawl-domains"
  | "/admin/limits"
  | "/admin/agents"
  | "/admin/analytics"
  | "/admin/moderation"
  | "/admin/public-access"
  | "/admin/maintenance"
  | "/admin/retention"
  | "/admin/legal-holds"
  | "/admin/break-glass"
  | "/admin/logs";

export type AdminNavItem = { to: AdminPath; label: string; icon: ReactNode; exact?: boolean; /** Only when a SystemOne model exists. */ systemOne?: boolean };

/** Admin sidebar groups (D6). */
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
      { to: "/admin/break-glass", label: "Break-glass", icon: icon(LockOpen) },
    ],
  },
  {
    label: "Models",
    items: [
      { to: "/admin/connections", label: "Connections", icon: icon(Plug) },
      { to: "/admin/models", label: "Models", icon: icon(Cpu) },
      { to: "/admin/embedding-profiles", label: "Embedding profiles", icon: icon(Layers) },
      { to: "/admin/profile-migrations", label: "Profile migrations", icon: icon(Shuffle) },
      { to: "/admin/systemone", label: "SystemOne", icon: icon(Sparkles), systemOne: true },
    ],
  },
  {
    label: "Policy",
    items: [
      { to: "/admin/classifications", label: "Classifications", icon: icon(Tags) },
      { to: "/admin/limits", label: "Limits", icon: icon(Gauge) },
      { to: "/admin/moderation", label: "Moderation", icon: icon(ShieldCheck) },
      { to: "/admin/public-access", label: "Public access", icon: icon(Earth) },
      { to: "/admin/maintenance", label: "Maintenance", icon: icon(Wrench) },
      { to: "/admin/retention", label: "Retention", icon: icon(Archive) },
      { to: "/admin/legal-holds", label: "Legal holds", icon: icon(Scale) },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: icon(BarChart3) },
      { to: "/admin/logs", label: terms.logs, icon: icon(ScrollText) },
    ],
  },
];

export const adminNav = adminSections.flatMap((section) => section.items);

/** Extra command-palette search words for admin pages. */
export const adminKeywords: Partial<Record<AdminPath, string[]>> = {
  "/admin": ["overview", "dashboard", "attention", "home"],
  "/admin/group-mapping": ["sso", "groups", "identity provider", "idp", "oidc", "membership rules", "access"],
  "/admin/crawl-domains": ["allowlist", "domain requests", "web", "crawling"],
  "/admin/limits": ["quota", "usage", "rate limit", "storage", "defaults", "ceilings"],
  "/admin/agents": ["kill switch", "disable", "chat", "assistant"],
  "/admin/analytics": ["usage", "dashboard", "answers", "statistics", "report", "csv", "tokens"],
  "/admin/logs": ["audit log", "access log", "sensitive", "restricted", "who used", "history", "changes"],
  "/admin/moderation": ["guardrail", "safety", "policy", "block", "public", "classifier"],
  "/admin/public-access": ["public", "anonymous", "widget", "embed", "captcha", "turnstile", "switch"],
  "/admin/maintenance": ["maintenance mode", "pause", "ingestion", "downtime", "upgrade", "freeze"],
  "/admin/retention": ["records", "delete", "purge", "keep", "dry run", "transcripts", "period"],
  "/admin/legal-holds": ["litigation", "records request", "preserve", "keep", "hold"],
  "/admin/break-glass": ["emergency access", "read team content", "transcripts", "approval", "investigate"],
  "/admin/profile-migrations": ["embedding migration", "re-embed", "switch model", "switch back", "profile"],
  "/admin/systemone": ["judging", "passages", "rerank", "re-rank", "injection", "judgment", "jev", "typesafe"],
};

export type TeamPath = "/teams/$team" | "/teams/$team/sources" | "/teams/$team/kbs" | "/teams/$team/agents" | "/teams/$team/settings";

export type TeamNavItem = { to: TeamPath; label: string; icon: ReactNode; exact?: boolean; /** Platform staff who aren't members see it too. */ staff?: boolean };

const teamNav: TeamNavItem[] = [
  { to: "/teams/$team", label: "Overview", icon: icon(LayoutDashboard), exact: true, staff: true },
  { to: "/teams/$team/sources", label: "Data sources", icon: icon(Database) },
  { to: "/teams/$team/kbs", label: "Knowledge bases", icon: icon(Library) },
  { to: "/teams/$team/agents", label: "Agents", icon: icon(Bot) },
  { to: "/teams/$team/settings", label: terms.teamSettings, icon: icon(Settings), staff: true },
];

/** Team pages the user can open: members see all; platform staff who aren't
 * members see the overview and team settings (members), not the content,
 * plus the data sources under a break-glass session with the documents
 * scope (`breakGlassDocuments`, ADR-0024). */
export function teamNavFor(me: Me, slug: string, breakGlassDocuments = false) {
  if (me.teams.some((t) => t.slug === slug)) return teamNav;
  return teamNav.filter((item) => item.staff || (breakGlassDocuments && item.to === "/teams/$team/sources"));
}
