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
import { useCommands } from "./commands";
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
  const commands = useCommands(me, active, paletteOpen);
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
                  <Badge tone="warning" dot className={styles.adminBadge}>
                    {terms.readOnly}
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
            {children ?? <Outlet />}
          </Main>
        )}
      </AppShell>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={commands} placeholder="Search agents, knowledge bases, sources and pages…" />
    </TooltipProvider>
  );
}
