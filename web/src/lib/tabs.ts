/*
 * The tabs of each page with sections, in order (the first is the default).
 * Kept here so the router can validate ?tab= without loading page chunks.
 */
/** The agent editor (D2). The old Configure and Test tabs are Build now; the router redirects ?tab=configure|test. Settings (C13) is last. */
export const editorTabs = ["build", "appearance", "share", "versions", "analytics", "evaluations", "settings"] as const;
export const oldEditorTabs = ["configure", "test"] as const;
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
export const crawlDomainTabs = ["requests", "allowlist"] as const;
/** Team settings (D1). Crawl domains moved to the Data sources page in v0.2.1 (I4); the router redirects ?tab=crawl-domains. */
export const teamSettingsTabs = ["members", "usage", "api-keys", "audit", "general"] as const;
/** The team's Data sources page (I4): the sources, and the team's crawl domain requests. */
export const dataSourceTabs = ["sources", "crawl-domains"] as const;
export type TeamSettingsTab = (typeof teamSettingsTabs)[number];
export const logTabs = ["audit", "access"] as const;
export const analyticsTabs = ["overview", "breakdown", "models", "top"] as const;
/** Admin → Costs (E2). Overview and Budgets are hidden while the mode is Off. */
export const costTabs = ["overview", "budgets", "prices", "settings"] as const;
export const retentionTabs = ["settings", "report", "runs"] as const;
export const legalHoldTabs = ["active", "released", "all"] as const;
/** Admin → Break-glass (ADR-0024). */
export const breakGlassTabs = ["sessions", "settings"] as const;
