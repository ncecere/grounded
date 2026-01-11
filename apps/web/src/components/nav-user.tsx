import {
  BadgeCheck,
  ChevronsUpDown,
  LogOut,
  Settings,
  Shield,
} from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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

interface NavUserProps {
  user: {
    email: string
    isSystemAdmin?: boolean
    avatar?: string
  }
  onLogout: () => void
  onSettings?: () => void
  onTenants?: () => void
}

function getInitials(email: string): string {
  const parts = email.split("@")[0].split(/[._-]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export function NavUser({ user, onLogout, onSettings, onTenants }: NavUserProps) {
  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={user.avatar} alt={user.email} />
                <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-medium">
                  {getInitials(user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.email}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.isSystemAdmin ? "System Admin" : "User"}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user.avatar} alt={user.email} />
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-xs font-medium">
                    {getInitials(user.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.email}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user.isSystemAdmin ? "System Admin" : "User"}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {user.isSystemAdmin && (
              <>
                <DropdownMenuGroup>
                  {onTenants && (
                    <DropdownMenuItem onClick={onTenants}>
                      <Shield className="mr-2 h-4 w-4" />
                      Manage Tenants
                    </DropdownMenuItem>
                  )}
                  {onSettings && (
                    <DropdownMenuItem onClick={onSettings}>
                      <Settings className="mr-2 h-4 w-4" />
                      System Settings
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={onLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
