/*
 * Every tab of an admin page as a ⌘K command, "Costs › Settings" (AD-30): a
 * query of several words finds the tab whose page and name hold them all
 * ("costs settings", "retention runs", "limits ingestion"), and "settings"
 * lists every settings tab. Tabs that are the page itself (the first) are
 * left out; places with their own commands (Budgets, Legal holds, Profile
 * migrations) are in nav.tsx.
 */
import type { AdminPath } from "./nav";

export type AdminTabCommand = { id: string; page: string; label: string; to: AdminPath; tab: string; keywords?: string[] };

const tabs = (to: AdminPath, page: string, list: [tab: string, label: string, keywords?: string[]][]): AdminTabCommand[] =>
  list.map(([tab, label, keywords]) => ({ id: `${to}?tab=${tab}`, page, label: `${page} › ${label}`, to, tab, keywords }));

export const adminPageTabCommands: AdminTabCommand[] = [
  ...tabs("/admin/costs", "Costs", [
    ["prices", "Prices", ["pricing", "price per token", "model prices"]],
    // The currency, time zone and default budget are on Admin → Settings (AD2-13): "time zone" finds that page.
    ["settings", "Settings", ["cost tracking", "warning threshold", "enforce", "track only"]],
  ]),
  ...tabs("/admin/retention", "Retention", [
    ["dry-run", "Dry run", ["preview", "what would be deleted"]],
    ["runs", "Runs", ["history", "deleted"]],
  ]),
  ...tabs("/admin/break-glass", "Break-glass", [["settings", "Settings", ["approval", "second admin", "longest session"]]]),
  ...tabs("/admin/logs", "Logs", [["access", "Access log", ["sensitive", "restricted", "who used"]]]),
  ...tabs("/admin/analytics", "Analytics", [
    ["breakdown", "Breakdown", ["audience", "channel"]],
    ["models", "Models & tokens", ["tokens", "model usage"]],
    ["top", "Top agents & teams", ["busiest", "most used"]],
    ["checks", "Checks", ["citation checks", "systemone", "judging"]],
  ]),
  ...tabs("/admin/crawl-domains", "Crawl domains", [["allowlist", "Allowlist", ["allowed hosts", "patterns"]]]),
  ...tabs("/admin/moderation", "Moderation", [
    ["all_authenticated", "Signed-in users", ["policy"]],
    ["public", "Public", ["policy", "anonymous"]],
    ["providers", "Providers", ["classifier", "moderation model"]],
  ]),
  ...tabs("/admin/limits", "Limits", [
    ["ingestion", "Ingestion", ["crawled pages", "documents per day", "concurrent crawls"]],
    ["queries", "Queries & chat", ["rate limit", "questions per day"]],
    ["public", "Public agents", ["anonymous", "widget"]],
    // Not Evaluations: "evaluations" belongs to the Overview's switch (the Limits page lists "evaluation limits").
  ]),
];

/**
 * Health across the platform, for "health" or "failing" (AD-30): the lists
 * with a Health filter, set to Failing.
 */
export const adminHealthCommands: { id: string; label: string; to: AdminPath; keywords: string[] }[] = [
  { id: "health:models", label: "Failing models", to: "/admin/models", keywords: ["health", "model health", "failing", "errors", "test"] },
  { id: "health:connections", label: "Failing connections", to: "/admin/connections", keywords: ["health", "connection health", "gateway", "failing", "errors"] },
];
