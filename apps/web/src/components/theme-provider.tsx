import { ReactNode, useEffect, useState } from 'react'
import { ThemeContext, useThemeState } from '@/hooks/use-theme'

interface ThemeProviderProps {
  children: ReactNode
  /** Default theme to use before hydration */
  defaultTheme?: 'light' | 'dark' | 'system'
  /** Storage key for persisting theme preference */
  storageKey?: string
}

/**
 * Provides theme context to the application.
 * Handles theme persistence, system preference detection, and prevents FOUC.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'system',
}: ThemeProviderProps) {
  const themeState = useThemeState()
  const [mounted, setMounted] = useState(false)

  // Prevent hydration mismatch by only rendering children after mount
  useEffect(() => {
    setMounted(true)
  }, [])

  // Set initial theme class immediately to prevent FOUC
  useEffect(() => {
    const root = document.documentElement

    // Check for stored preference or use system
    const stored = localStorage.getItem('grounded-theme')
    const initialTheme =
      stored === 'light' || stored === 'dark'
        ? stored
        : stored === 'system' || !stored
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : defaultTheme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : defaultTheme

    root.classList.add(initialTheme)
  }, [defaultTheme])

  // During SSR or before hydration, render children but with system default
  if (!mounted) {
    return (
      <ThemeContext.Provider
        value={{
          theme: defaultTheme,
          resolvedTheme: 'light',
          setTheme: () => {},
        }}
      >
        {children}
      </ThemeContext.Provider>
    )
  }

  return (
    <ThemeContext.Provider value={themeState}>
      {children}
    </ThemeContext.Provider>
  )
}
