import {
  BookOpen,
  Bot,
  BarChart3,
  Settings,
  Building2,
  Cpu,
  Users,
  Share2,
  LayoutDashboard,
  ClipboardList,
  ArrowLeft,
} from "lucide-react"

import { canAccessPage, pageRegistryById, type PageId, type PageRegistryEntry } from "@/app/page-registry"
import { TenantSwitcher } from "@/components/tenant-switcher"
import { NavMain, type NavItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import type { UserTenant } from "@/lib/api"

const navPageIds = [
  "kbs",
  "agents",
  "analytics",
  "tenant-settings",
  "dashboard",
  "admin-analytics",
  "tenants",
  "users",
  "shared-kbs",
  "models",
  "settings",
  "admin-audit-logs",
] as const satisfies readonly PageId[]

type SidebarPageId = (typeof navPageIds)[number]

const navIcons: Record<SidebarPageId, NavItem["icon"]> = {
  kbs: BookOpen,
  agents: Bot,
  analytics: BarChart3,
  "tenant-settings": Settings,
  dashboard: LayoutDashboard,
  "admin-analytics": BarChart3,
  tenants: Building2,
  users: Users,
  "shared-kbs": Share2,
  models: Cpu,
  settings: Settings,
  "admin-audit-logs": ClipboardList,
}

const labelOverrides: Partial<Record<SidebarPageId, string>> = {
  "tenant-settings": "Settings",
  "shared-kbs": "Shared KBs",
}

  const navEntries = navPageIds.flatMap((pageId) => {
    const entry = pageRegistryById[pageId]
    return entry ? [entry] : []
  })

export type Page = PageId

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user: {
    email: string
    isSystemAdmin?: boolean
    avatar?: string
  }
  currentPage: Page
  onNavigate: (page: Page) => void
  onLogout: () => void
  tenants?: UserTenant[]
  currentTenant?: UserTenant | null
  onTenantChange?: (tenant: UserTenant) => void
  isAdminMode?: boolean
  onEnterAdminMode?: () => void
  onExitAdminMode?: () => void
}

export function AppSidebar({
  user,
  currentPage,
  onNavigate,
  onLogout,
  tenants = [],
  currentTenant,
  onTenantChange,
  isAdminMode = false,
  onEnterAdminMode,
  onExitAdminMode,
  ...props
}: AppSidebarProps) {
  const hasTenant = tenants.length > 0 && currentTenant

  // Check if user can manage tenant (owner or admin)
  const canManageTenant = currentTenant?.role === "owner" || currentTenant?.role === "admin"

  const getNavItems = (entries: ReadonlyArray<PageRegistryEntry>): NavItem[] =>
    entries.reduce<NavItem[]>((items, entry) => {
      const pageId = entry.id as SidebarPageId
      const icon = navIcons[pageId]
      if (!icon) {
        return items
      }

      items.push({
        title: labelOverrides[pageId] ?? entry.label,
        id: entry.id,
        icon,
        isActive: currentPage === entry.id,
      })
      return items
    }, [])

  const accessContext = {
    hasTenant: !!hasTenant,
    canManageTenant: !!canManageTenant,
    isSystemAdmin: user.isSystemAdmin,
  }

  const accessibleEntries = navEntries.filter((entry) => canAccessPage(entry, accessContext))
  const workspaceNavEntries = accessibleEntries.filter((entry) => entry.group === "workspace")
  const adminNavEntries = accessibleEntries.filter((entry) => entry.group === "admin")

  // Main navigation items
  const mainNavItems: NavItem[] = getNavItems(workspaceNavEntries)

  // Admin navigation items
  const adminNavItems: NavItem[] = getNavItems(adminNavEntries)

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {isAdminMode ? (
          // Admin mode: show Grounded / Admin Panel header
          <div className="flex items-center gap-2 px-2 py-1.5">
            <img
              src="/grounded-logo.png"
              alt="Grounded"
              className="size-8 rounded-lg"
            />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">Grounded</span>
              <span className="truncate text-xs text-muted-foreground">Admin Panel</span>
            </div>
          </div>
        ) : hasTenant && onTenantChange ? (
          <TenantSwitcher
            tenants={tenants}
            currentTenant={currentTenant}
            onTenantChange={onTenantChange}
            onCreateTenant={user.isSystemAdmin ? () => {
              onEnterAdminMode?.();
              // After entering admin mode, navigate to tenants page
              onNavigate("tenants");
            } : undefined}
            isAdmin={user.isSystemAdmin}
          />
        ) : (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <img
              src="/grounded-logo.png"
              alt="Grounded"
              className="size-8 rounded-lg"
            />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">Grounded</span>
              <span className="truncate text-xs text-muted-foreground">Knowledge Platform</span>
            </div>
          </div>
        )}
      </SidebarHeader>
      <SidebarContent>
        {isAdminMode ? (
          // Admin mode: show Back to Workspace + admin nav only
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      onClick={onExitAdminMode}
                      tooltip="Back to Workspace"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <ArrowLeft />
                      <span>Back to Workspace</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
            {adminNavItems.length > 0 && (
              <NavMain
                items={adminNavItems}
                onNavigate={(id) => onNavigate(id as Page)}
                label="Administration"
              />
            )}
          </>
        ) : (
          // Workspace mode: show workspace nav only
          <>
            {mainNavItems.length > 0 && (
              <NavMain
                items={mainNavItems}
                onNavigate={(id) => onNavigate(id as Page)}
                label="Workspace"
              />
            )}
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={user}
          onLogout={onLogout}
          isAdminMode={isAdminMode}
          onAdminPanel={user.isSystemAdmin ? onEnterAdminMode : undefined}
          onExitAdminMode={user.isSystemAdmin ? onExitAdminMode : undefined}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
