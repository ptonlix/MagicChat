/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import { DESKTOP_SETTINGS_CHANGED_EVENT } from "@/hooks/use-desktop-settings"
import { translate, type TranslationKey } from "@/lib/i18n"
import type { DesktopFontScale, DesktopLanguage } from "@shared/bridge"

const FONT_SCALE_RATIO: Record<DesktopFontScale, number> = {
  normal: 1,
  medium: 1.2,
  large: 1.3,
}

const BASE_FONT_SIZE_PX = 16

type LocaleContextValue = {
  fontScale: DesktopFontScale
  locale: DesktopLanguage
  t(key: TranslationKey, params?: Readonly<Record<string, string | number>>): string
}

const LocaleContext = React.createContext<LocaleContextValue | undefined>(undefined)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = React.useState<DesktopLanguage>("zh-CN")
  const [fontScale, setFontScale] = React.useState<DesktopFontScale>("normal")

  React.useEffect(() => {
    let active = true
    const getSettings = window.desktop?.settings?.get
    const refresh = () => {
      if (!getSettings) return
      void getSettings().then(
        (settings) => {
          if (!active) return
          setLocale(settings.language)
          setFontScale(settings.fontScale)
        },
        () => undefined,
      )
    }
    refresh()
    window.addEventListener(DESKTOP_SETTINGS_CHANGED_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(DESKTOP_SETTINGS_CHANGED_EVENT, refresh)
    }
  }, [])

  React.useEffect(() => {
    document.documentElement.style.fontSize = `${BASE_FONT_SIZE_PX * FONT_SCALE_RATIO[fontScale]}px`
  }, [fontScale])

  const value = React.useMemo(
    () => ({
      fontScale,
      locale,
      t: (key: TranslationKey, params?: Readonly<Record<string, string | number>>) =>
        translate(locale, key, params),
    }),
    [fontScale, locale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const context = React.useContext(LocaleContext)
  if (context === undefined) throw new Error("useLocale must be used within a LocaleProvider")
  return context
}
