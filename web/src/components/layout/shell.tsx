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
import styles from "./layout.module.css";
import { useActiveTeam } from "./active-team";
import { isAdminRoute, isChatRoute, useCapabilities, useLocationInfo } from "./location";
import { documentTitle, useBreadcrumbs } from "./breadcrumbs";
import { useCurrentPageCrumbs } from "./crumb-tail";
import { TakeoverHost } from "../templates/takeover";
import { useCommands } from "./commands";
import { PALETTE_LABEL } from "./search-commands";
import { type Mode, useRememberHref } from "./mode-switch";
import { MaintenanceBanner } from "./maintenance-banner";
import { BreakGlassBanner } from "./break-glass-banner";
import { AppSidebar } from "./sidebar";

/* ---------------- shell ---------------- */

const collapsedKey = "grounded.sidebarCollapsed";

function initialCollapsed() {
  try {
    const saved = globalThis.localStorage?.getItem(collapsedKey);
    if (saved !== null && saved !== undefined) return saved === "1";
  } catch {
    // Storage can be unavailable (private mode); fall through.
  }
  return globalThis.matchMedia?.("(max-width: 48rem)").matches ?? false;
}

/** The signed-in layout. Renders the matched route, or `children` (e.g. the not-found page). */
export function AppLayout({ children }: { children?: ReactNode }) {
  const me = useCurrentUser();
  const loc = useLocationInfo();
  const { canAdmin, readOnlyAdmin } = useCapabilities(me);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  // Chat pages have their own conversation list: the app sidebar shows icons
  // only there (two columns, not three; W11). Expanding it lasts for the
  // session and doesn't change the saved choice for other pages.
  const [chatExpanded, setChatExpanded] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteShortcut(togglePalette);

  const active = useActiveTeam(me, loc);
  const crumbs = useBreadcrumbs(loc, canAdmin);
  // The bottom record or form page's back link names the route's page underneath.
  const pageCrumbs = useCurrentPageCrumbs();
  const under = pageCrumbs.length > 0 ? crumbs[crumbs.length - 1 - pageCrumbs.length]?.label : undefined;
  const backLabel = typeof under === "string" ? under : undefined;
  // The palette's text: the server search follows it, and it clears when the palette closes.
  const [paletteQuery, setPaletteQuery] = useState("");
  useEffect(() => {
    if (!paletteOpen) setPaletteQuery("");
  }, [paletteOpen]);
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
          setCollapsed(c);
          try {
            globalThis.localStorage?.setItem(collapsedKey, c ? "1" : "0");
          } catch {
            // Ignore storage errors.
          }
        }}
        sidebar={<AppSidebar me={me} mode={mode} active={active} />}
        topbar={
          <TopBar
            start={<Breadcrumbs items={crumbs} className={styles.crumbs} />}
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
