/*
 * Page sections as pill tabs, the one tab style in the app. The active tab is
 * kept in the URL (?tab=) so it can be linked to and back/forward move between
 * tabs; the first tab is the default and leaves the URL clean.
 *
 * A route that uses tabs declares them with tabSearch() (lib/tabs.ts) in its validateSearch.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Tab, Tabs, TabsList, TabsPanel } from "@/components/ui/tabs/tabs";
import { useCrumbTail } from "./layout/crumb-tail";
import t from "./page-tabs.module.css";

/**
 * The active tab (from ?tab=) and a way to change it. Changing tabs pushes a
 * history entry, so Back returns to the previous tab.
 */
export function useUrlTab<T extends string>(tabs: readonly T[]): [T, (next: T, opts?: { replace?: boolean }) => void] {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab = tabs.includes(search.tab as T) ? (search.tab as T) : (tabs[0] as T);
  const setTab = (next: T, opts?: { replace?: boolean }) =>
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({ ...prev, tab: next === tabs[0] ? undefined : next })) as never,
      replace: opts?.replace ?? false,
    });
  return [tab, setTab];
}

export type PageTab<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  /** Rendered only while the tab is active. */
  content: ReactNode;
  /** Leave the tab out (e.g. the viewer can't use it). */
  hidden?: boolean;
  /** The breadcrumb for this tab (default: the label when it's text). */
  crumb?: string;
};

type PageTabsProps<T extends string> = {
  /** Accessible name of the tab list, e.g. "Source sections". */
  label: string;
  tabs: PageTab<T>[];
  value: T;
  onValueChange: (next: T) => void;
  /**
   * Which tabs add their name to the breadcrumbs (F-12): "after-first"
   * (default; the first tab is the page itself), "always", or "none" (for
   * tabs nested inside another tabbed page).
   */
  crumb?: "after-first" | "always" | "none";
};

/** Pill tabs over a page's sections. Pair with useUrlTab. */
export function PageTabs<T extends string>({ label, tabs, value, onValueChange, crumb = "after-first" }: PageTabsProps<T>) {
  const shown = tabs.filter((x) => !x.hidden);
  const active = shown.some((x) => x.value === value) ? value : shown[0]?.value;
  const current = shown.find((x) => x.value === active);
  const crumbText = current?.crumb ?? (typeof current?.label === "string" ? current.label : undefined);
  const showCrumb = crumb === "always" || (crumb === "after-first" && current !== shown[0]);
  useCrumbTail(showCrumb ? crumbText : undefined);
  return (
    <Tabs value={active} onValueChange={(v) => onValueChange(v as T)} className={t.tabs}>
      <TabsList aria-label={label} variant="pills" className={t.list}>
        {shown.map((x) => (
          <Tab key={x.value} value={x.value} icon={x.icon} count={x.count}>
            {x.label}
          </Tab>
        ))}
      </TabsList>
      {shown.map((x) => (
        <TabsPanel key={x.value} value={x.value} className={t.panel}>
          {x.content}
        </TabsPanel>
      ))}
    </Tabs>
  );
}
