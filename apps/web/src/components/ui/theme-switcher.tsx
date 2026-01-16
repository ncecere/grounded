import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type Theme } from '@/hooks/use-theme'
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
]

/**
 * Theme switcher component for use in dropdown menus.
 * Renders as a submenu with Light, Dark, and System options.
 */
export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme()

  const currentTheme = themes.find((t) => t.value === theme)
  const CurrentIcon = currentTheme?.icon ?? Monitor

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <CurrentIcon className="mr-2 h-4 w-4" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {themes.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="flex items-center gap-2"
            >
              <Icon className="h-4 w-4" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * Compact theme toggle button for header placement.
 * Cycles through light → dark → system.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  const cycle = () => {
    if (theme === 'light') setTheme('dark')
    else if (theme === 'dark') setTheme('system')
    else setTheme('light')
  }

  const Icon = theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun

  return (
    <button
      onClick={cycle}
      className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      title={`Current: ${theme}. Click to change.`}
    >
      <Icon className="h-4 w-4" />
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
