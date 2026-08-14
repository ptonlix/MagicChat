/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

export const THEME_VALUES = [
  "system",
  "light",
  "dark",
  "blue",
  "violet",
  "rose",
  "amber",
  "emerald",
] as const

export type Theme = (typeof THEME_VALUES)[number]
type ResolvedTheme = "dark" | "light"

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const COLOR_SCHEME_QUERY = "(prefers-color-scheme: dark)"

const ThemeProviderContext = React.createContext<ThemeProviderState | undefined>(undefined)

export function isTheme(value: string | null): value is Theme {
  return value !== null && THEME_VALUES.includes(value as Theme)
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia(COLOR_SCHEME_QUERY).matches) {
    return "dark"
  }

  return "light"
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return getSystemTheme()
  if (theme === "dark") return "dark"
  return "light"
}

function isColorTheme(theme: Theme): boolean {
  return theme !== "system" && theme !== "light" && theme !== "dark"
}

function toDesktopThemeSource(theme: Theme): ResolvedTheme | "system" {
  return theme === "system" || theme === "dark" ? theme : "light"
}

function disableTransitionsTemporarily() {
  const style = document.createElement("style")
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important}",
    ),
  )
  document.head.appendChild(style)

  return () => {
    window.getComputedStyle(document.body)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        style.remove()
      })
    })
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
  ...props
}: ThemeProviderProps) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    const storedTheme = window.localStorage.getItem(storageKey)
    if (isTheme(storedTheme)) {
      return storedTheme
    }

    return defaultTheme
  })

  const setTheme = React.useCallback(
    (nextTheme: Theme) => {
      window.localStorage.setItem(storageKey, nextTheme)
      setThemeState(nextTheme)
    },
    [storageKey],
  )

  const applyTheme = React.useCallback(
    (nextTheme: Theme) => {
      const root = document.documentElement
      const resolvedTheme = resolveTheme(nextTheme)
      const restoreTransitions = disableTransitionOnChange ? disableTransitionsTemporarily() : null

      root.classList.remove("light", "dark")
      root.classList.add(resolvedTheme)
      if (isColorTheme(nextTheme)) root.dataset.colorTheme = nextTheme
      else delete root.dataset.colorTheme

      if (restoreTransitions) {
        restoreTransitions()
      }
    },
    [disableTransitionOnChange],
  )

  React.useEffect(() => {
    applyTheme(theme)
    void window.desktop.appearance
      .setThemeSource(toDesktopThemeSource(theme))
      .catch(() => undefined)

    if (theme !== "system") {
      return undefined
    }

    const mediaQuery = window.matchMedia(COLOR_SCHEME_QUERY)
    const handleChange = () => {
      applyTheme("system")
      void window.desktop.appearance.setThemeSource("system").catch(() => undefined)
    }

    mediaQuery.addEventListener("change", handleChange)

    return () => {
      mediaQuery.removeEventListener("change", handleChange)
    }
  }, [theme, applyTheme])

  React.useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) {
        return
      }

      if (event.key !== storageKey) {
        return
      }

      if (isTheme(event.newValue)) {
        setThemeState(event.newValue)
        return
      }

      setThemeState(defaultTheme)
    }

    window.addEventListener("storage", handleStorageChange)

    return () => {
      window.removeEventListener("storage", handleStorageChange)
    }
  }, [defaultTheme, storageKey])

  const value = React.useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme, setTheme],
  )

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = React.useContext(ThemeProviderContext)

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return context
}
