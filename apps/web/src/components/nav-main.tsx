import { type LucideIcon } from "lucide-react"

import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export interface NavItem {
  title: string
  id: string
  icon: LucideIcon
  isActive?: boolean
  badge?: string | number
}

interface NavMainProps {
  items: NavItem[]
  onNavigate: (id: string) => void
  label?: string
}

export function NavMain({ items, onNavigate, label = "Platform" }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
          <SidebarMenuItem key={item.id}>
            <SidebarMenuButton
              tooltip={item.title}
              isActive={item.isActive}
              onClick={() => onNavigate(item.id)}
            >
              <item.icon />
              <span>{item.title}</span>
              {item.badge !== undefined && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-accent px-1.5 text-xs font-medium">
                  {item.badge}
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
