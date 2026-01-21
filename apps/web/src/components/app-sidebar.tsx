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

export type Page = "kbs" | "agents" | "sources" | "chat" | "test-suites" | "test-suite-detail" | "analytics" | "dashboard" | "settings" | "tenants" | "models" | "users" | "shared-kbs" | "shared-kb-sources" | "shared-kb-detail" | "admin-analytics" | "tenant-settings" | "admin-audit-logs"

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

  // Main navigation items (require a tenant)
  const mainNavItems: NavItem[] = hasTenant
    ? [
        {
          title: "Knowledge Bases",
          id: "kbs",
          icon: BookOpen,
          isActive: currentPage === "kbs",
        },
        {
          title: "Agents",
          id: "agents",
          icon: Bot,
          isActive: currentPage === "agents",
        },
        {
          title: "Analytics",
          id: "analytics",
          icon: BarChart3,
          isActive: currentPage === "analytics",
        },
        ...(canManageTenant
          ? [
              {
                title: "Settings",
                id: "tenant-settings" as const,
                icon: Settings,
                isActive: currentPage === "tenant-settings",
              },
            ]
          : []),
      ]
    : []

  // Admin navigation items
  const adminNavItems: NavItem[] = user.isSystemAdmin
    ? [
        {
          title: "Dashboard",
          id: "dashboard",
          icon: LayoutDashboard,
          isActive: currentPage === "dashboard",
        },
        {
          title: "Analytics",
          id: "admin-analytics",
          icon: BarChart3,
          isActive: currentPage === "admin-analytics",
        },
        {
          title: "Tenants",
          id: "tenants",
          icon: Building2,
          isActive: currentPage === "tenants",
        },
        {
          title: "Users",
          id: "users",
          icon: Users,
          isActive: currentPage === "users",
        },
        {
          title: "Shared KBs",
          id: "shared-kbs",
          icon: Share2,
          isActive: currentPage === "shared-kbs",
        },
        {
          title: "AI Models",
          id: "models",
          icon: Cpu,
          isActive: currentPage === "models",
        },
        {
          title: "Settings",
          id: "settings",
          icon: Settings,
          isActive: currentPage === "settings",
        },
        {
          title: "Audit Logs",
          id: "admin-audit-logs",
          icon: ClipboardList,
          isActive: currentPage === "admin-audit-logs",
        },
      ]
    : []

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
