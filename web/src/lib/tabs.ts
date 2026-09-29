/*
 * The tabs of each page with sections, in order (the first is the default).
 * Kept here so the router can validate ?tab= without loading page chunks.
 */
/**
 * The agent editor (D2, I6): 6 tabs. The old Configure and Test tabs are Build now; the router redirects
 * ?tab=configure|test. Versions moved into the header's version menu (?history=versions); the router redirects
 * ?tab=versions. Settings (C13) is last.
 */
export const editorTabs = ["build", "evaluations", "appearance", "share", "analytics", "settings"] as const;
export const oldEditorTabs = ["configure", "test", "versions"] as const;
export type EditorTab = (typeof editorTabs)[number];

/** Source detail (D3): Crawls only shows for web sources. */
/** "used-by" is shown for shared sources only (A6). */
export const sourceTabs = ["overview", "documents", "crawls", "used-by", "settings"] as const;
export type SourceTab = (typeof sourceTabs)[number];
/** Knowledge base detail (D3, W4). */
export const kbTabs = ["overview", "sources", "try", "evaluations", "settings"] as const;
/** An evaluation set (docs/evaluations.md §5). */
export const evaluationSetTabs = ["questions", "runs", "settings"] as const;
export const adminTeamTabs = ["overview", "members", "group-mapping", "limits", "settings"] as const;
export const limitTabs = ["resources", "ingestion", "queries", "public", "evaluations"] as const;
export const notificationTabs = ["all", "unread"] as const;
export const moderationTabs = ["team", "all_authenticated", "public", "providers"] as const;

/**
 * validateSearch for a route with tabs: keeps ?tab= when it names a tab other
 * than the first. With `passthrough`, other parameters (list filters, ?record=,
 * date ranges) are kept too.
 */
export function tabSearch<T extends string>(tabs: readonly T[], opts: { passthrough?: boolean } = {}) {
  return (s: Record<string, unknown>): { tab?: T } => {
    const tab = tabs.includes(s.tab as T) && s.tab !== tabs[0] ? { tab: s.tab as T } : {};
    if (!opts.passthrough) return tab;
    const { tab: _drop, ...rest } = s;
    return { ...rest, ...tab };
  };
}
/** The address with a renamed ?tab= value replaced (the rest kept), or undefined when the tab wasn't renamed. */
export function renamedTabHref(pathname: string, searchStr: string, renamed: Record<string, string>) {
  const q = new URLSearchParams(searchStr);
  const tab = q.get("tab") ?? "";
  if (!Object.hasOwn(renamed, tab)) return undefined;
  const next = renamed[tab]!;
  q.set("tab", next);
  return `${pathname}?${q.toString()}`;
}
export const crawlDomainTabs = ["requests", "allowlist"] as const;
/** Team settings (D1). Crawl domains moved to the Data sources page in v0.2.1 (I4); the router redirects ?tab=crawl-domains. */
export const teamSettingsTabs = ["members", "usage", "api-keys", "audit", "general"] as const;
/** The team's Data sources page (I4): the sources, and the team's crawl domain requests. */
export const dataSourceTabs = ["sources", "crawl-domains"] as const;
export type TeamSettingsTab = (typeof teamSettingsTabs)[number];
export const logTabs = ["audit", "access"] as const;
/** Admin → Analytics; Checks (the SystemOne cards) shows only while a SystemOne model is configured (v0.2.1 I8). */
export const analyticsTabs = ["overview", "breakdown", "models", "top", "checks"] as const;
/** Admin → Costs (E2). Overview and Budgets are hidden while the mode is Off. */
export const costTabs = ["overview", "budgets", "prices", "settings"] as const;
/**
 * Admin → Retention: Periods · Dry run · Runs · Legal holds (Admin → Legal holds until v0.2.1, I1). The Dry run was
 * ?tab=report until v0.2.1; the router redirects it.
 */
export const retentionTabs = ["settings", "dry-run", "runs", "holds"] as const;
/** Admin → Embedding profiles: Profiles · Migrations (Admin → Profile migrations until v0.2.1, I1). */
export const embeddingProfileTabs = ["profiles", "migrations"] as const;
/** Admin → Break-glass (ADR-0024). */
export const breakGlassTabs = ["sessions", "settings"] as const;

/**
 * /admin/legal-holds?tab= (until v0.2.1): its Active · Released · All tabs are
 * the Legal holds tab's Status filter (?status=). The old page's default
 * (Active) isn't kept: the tab shows every hold, however it's reached.
 */
export function movedLegalHoldSearch(q: URLSearchParams) {
  const old = q.get("tab");
  if (old === "active" || old === "released") q.set("status", old);
}
