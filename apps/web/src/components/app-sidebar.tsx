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
} from "lucide-react"

import { pageRegistryById, type PageId, type PageRegistryEntry } from "@/app/page-registry"
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

const workspaceNavEntries = navEntries.filter((entry) => entry.group === "workspace")
const adminNavEntries = navEntries.filter((entry) => entry.group === "admin")

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
}

export function AppSidebar({
  user,
  currentPage,
  onNavigate,
  onLogout,
  tenants = [],
  currentTenant,
  onTenantChange,
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

  // Main navigation items (require a tenant)
  const mainNavItems: NavItem[] = hasTenant
    ? getNavItems(
        canManageTenant
          ? workspaceNavEntries
          : workspaceNavEntries.filter((entry) => entry.id !== "tenant-settings")
      )
    : []

  // Admin navigation items
  const adminNavItems: NavItem[] = user.isSystemAdmin ? getNavItems(adminNavEntries) : []

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {hasTenant && onTenantChange ? (
          <TenantSwitcher
            tenants={tenants}
            currentTenant={currentTenant}
            onTenantChange={onTenantChange}
            onCreateTenant={user.isSystemAdmin ? () => onNavigate("tenants") : undefined}
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
        {mainNavItems.length > 0 && (
          <NavMain
            items={mainNavItems}
            onNavigate={(id) => onNavigate(id as Page)}
            label="Workspace"
          />
        )}
        {adminNavItems.length > 0 && (
          <>
            {mainNavItems.length > 0 && <SidebarSeparator />}
            <NavMain
              items={adminNavItems}
              onNavigate={(id) => onNavigate(id as Page)}
              label="Administration"
            />
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          user={user}
          onLogout={onLogout}
          onSettings={user.isSystemAdmin ? () => onNavigate("settings") : undefined}
          onTenants={user.isSystemAdmin ? () => onNavigate("tenants") : undefined}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
