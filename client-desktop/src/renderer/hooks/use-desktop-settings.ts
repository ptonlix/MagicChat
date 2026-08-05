import { useEffect, useState } from "react"

import type { DesktopSettings } from "@shared/bridge"

export const DESKTOP_SETTINGS_CHANGED_EVENT = "magicchat:desktop-settings-changed"

export function useDesktopSettings(): DesktopSettings | undefined {
  const [settings, setSettings] = useState<DesktopSettings>()

  useEffect(() => {
    let active = true
    const getSettings = window.desktop?.settings?.get
    const refresh = () => {
      if (!getSettings) return
      void getSettings().then(
        (nextSettings) => {
          if (active) setSettings(nextSettings)
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

  return settings
}
