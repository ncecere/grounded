/*
 * The signed-in app shell: sidebar (brand, team switcher, navigation, user
 * menu), top bar (sidebar toggle, breadcrumbs, command palette) and the main
 * content area.
 */
import { Outlet } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { NotificationBell } from "../notifications/bell";
import { terms } from "../../lib/terms";
import { useCurrentUser, useInstance } from "../../session";
import { AppShell, Main, TopBar } from "@/components/ui/app-shell/app-shell";
import { Badge } from "@/components/ui/badge/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs/breadcrumbs";
import { CommandPalette, CommandPaletteTrigger, useCommandPaletteShortcut } from "@/components/ui/command-palette/command-palette";
import { TooltipProvider } from "@/components/ui/tooltip/tooltip";
import { useMediaQuery } from "@/lib/bitop-utils";
import styles from "./layout.module.css";
import { useActiveTeam } from "./active-team";
import { isAdminRoute, isChatRoute, useCapabilities, useLocationInfo } from "./location";
import { documentTitle, fitCrumbs, useBreadcrumbs } from "./breadcrumbs";
import { useCurrentPageCrumbs } from "./crumb-tail";
import { TakeoverHost } from "../templates/takeover";
import { useCommands } from "./commands";
import { PALETTE_LABEL } from "./search-commands";
import { type Mode, useRememberHref } from "./mode-switch";
import { MaintenanceBanner } from "./maintenance-banner";
import { BreakGlassBanner } from "./break-glass-banner";
import { RateLimitBanner } from "./rate-limit-banner";
import { AppSidebar } from "./sidebar";

/* ---------------- shell ---------------- */

const collapsedKey = "grounded.sidebarCollapsed";

/**
 * Below this width the sidebar starts as the icon rail, so lists and tables
 * get the room (1024 px: a 240 px sidebar left tables scrolling inside
 * themselves; AD-32). It follows the window until the person chooses.
 */
export const COMPACT_SHELL_QUERY = "(max-width: 68.75rem)";

/** The person's own choice (the toggle), or null to follow the window's width. */
function savedCollapsed(): boolean | null {
  try {
    const saved = globalThis.localStorage?.getItem(collapsedKey);
    if (saved !== null && saved !== undefined) return saved === "1";
  } catch {
    // Storage can be unavailable (private mode); fall through.
  }
  return null;
}

/** The signed-in layout. Renders the matched route, or `children` (e.g. the not-found page). */
export function AppLayout({ children }: { children?: ReactNode }) {
  const me = useCurrentUser();
  const loc = useLocationInfo();
  const { canAdmin, readOnlyAdmin } = useCapabilities(me);
  const [choice, setChoice] = useState(savedCollapsed);
  const compact = useMediaQuery(COMPACT_SHELL_QUERY);
  const collapsed = choice ?? compact;
  // Chat pages have their own conversation list: the app sidebar shows icons
  // only there (two columns, not three; W11). Expanding it lasts for the
  // session and doesn't change the saved choice for other pages.
  const [chatExpanded, setChatExpanded] = useState(false);
  // The palette's text: the server search follows it. It clears as the palette
  // closes, in the same update (not in an effect after it), so a closing
  // palette never renders or searches the old text again (M5).
  const [paletteOpen, setPaletteOpenState] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const setPaletteOpen = useCallback((open: boolean) => {
    setPaletteOpenState(open);
    if (!open) setPaletteQuery("");
  }, []);
  const togglePalette = useCallback(() => {
    setPaletteOpenState((o) => !o);
    setPaletteQuery("");
  }, []);
  useCommandPaletteShortcut(togglePalette);

  const active = useActiveTeam(me, loc);
  const crumbs = useBreadcrumbs(loc, canAdmin);
  const narrow = useMediaQuery("(max-width: 37.5rem)");
  // The bottom record or form page's back link names the route's page underneath.
  const pageCrumbs = useCurrentPageCrumbs();
  const under = pageCrumbs.length > 0 ? crumbs[crumbs.length - 1 - pageCrumbs.length]?.label : undefined;
  const backLabel = typeof under === "string" ? under : undefined;
  const commands = useCommands(me, active, paletteOpen, paletteQuery);
  const placeholder = canAdmin ? "Search teams, people, agents, conversations and pages…" : "Search agents, conversations, knowledge bases and pages…";
  // Only admins and auditors get the admin shell (its sidebar queries admin APIs);
  // others see the workspace shell around the no-access page.
  const inAdmin = canAdmin && isAdminRoute(loc.routeId);
  const instanceName = useInstance().name;
  const title = documentTitle(crumbs, instanceName);
  useEffect(() => {
    document.title = title;
  }, [title]);
  // The chat page uses the whole main area (its own panels scroll, not the page).
  const onChat = !children && isChatRoute(loc.routeId);
  const fullBleed = onChat;
  const mode: Mode = inAdmin ? "admin" : "workspace";
  useRememberHref();

  return (
    <TooltipProvider>
      <AppShell
        collapsed={onChat ? !chatExpanded : collapsed}
        onCollapsedChange={(c) => {
          if (onChat) {
            setChatExpanded(!c);
            return;
          }
          setChoice(c);
          try {
            globalThis.localStorage?.setItem(collapsedKey, c ? "1" : "0");
          } catch {
            // Ignore storage errors.
          }
        }}
        sidebar={<AppSidebar me={me} mode={mode} active={active} />}
        topbar={
          <TopBar
            start={<Breadcrumbs items={fitCrumbs(crumbs, narrow)} className={styles.crumbs} />}
            end={
              <>
                {inAdmin && readOnlyAdmin && (
                  // On a phone only the dot shows (the word stays for screen readers), so the search button fits.
                  <Badge tone="warning" dot className={styles.adminBadge} title={terms.readOnly}>
                    <span className={styles.adminBadgeText}>{terms.readOnly}</span>
                  </Badge>
                )}
                <NotificationBell />
                <CommandPaletteTrigger onClick={() => setPaletteOpen(true)} label="Search or jump to…" className={styles.search} />
              </>
            }
          />
        }
      >
        {fullBleed ? (
          <Main contained={false} className={styles.fullBleed}>
            {children ?? <Outlet />}
          </Main>
        ) : (
          <Main>
            <BreakGlassBanner me={me} />
            <MaintenanceBanner me={me} />
            <RateLimitBanner />
            <TakeoverHost backLabel={backLabel}>{children ?? <Outlet />}</TakeoverHost>
          </Main>
        )}
      </AppShell>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={commands.groups}
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        label={PALETTE_LABEL}
        placeholder={placeholder}
        // The empty state is a polite live region: it says a search is running, then its outcome.
        emptyText={commands.searching ? "Searching…" : "No results found."}
      />
    </TooltipProvider>
  );
}
