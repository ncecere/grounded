import * as React from "react"
import { ChevronsUpDown, Building2, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import type { UserTenant } from "@/lib/api"

interface TenantSwitcherProps {
  tenants: UserTenant[]
  currentTenant: UserTenant | null
  onTenantChange: (tenant: UserTenant) => void
  onCreateTenant?: () => void
  isAdmin?: boolean
}

export function TenantSwitcher({
  tenants,
  currentTenant,
  onTenantChange,
  onCreateTenant,
  isAdmin,
}: TenantSwitcherProps) {
  const { isMobile } = useSidebar()

  if (!currentTenant) {
    return null
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <Building2 className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{currentTenant.name}</span>
                <span className="truncate text-xs capitalize text-muted-foreground">
                  {currentTenant.role}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Tenants
            </DropdownMenuLabel>
            {tenants.map((tenant, index) => (
              <DropdownMenuItem
                key={tenant.id}
                onClick={() => onTenantChange(tenant)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border bg-background">
                  <Building2 className="size-4 shrink-0" />
                </div>
                <div className="flex flex-col">
                  <span className="font-medium">{tenant.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{tenant.role}</span>
                </div>
                {tenant.id === currentTenant.id && (
                  <div className="ml-auto h-2 w-2 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
            ))}
            {isAdmin && onCreateTenant && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onCreateTenant} className="gap-2 p-2">
                  <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                    <Plus className="size-4" />
                  </div>
                  <div className="font-medium text-muted-foreground">Add tenant</div>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
