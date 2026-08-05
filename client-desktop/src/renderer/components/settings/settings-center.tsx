import { useEffect, type ReactNode } from "react"
import {
  BellRing,
  CircleHelp,
  HardDriveDownload,
  Keyboard,
  MonitorCog,
  Palette,
  RefreshCw,
  Server,
  X,
} from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useLocale } from "@/components/locale-provider"
import type { TranslationKey } from "@/lib/i18n"
import type { DesktopAppInfo, ServerProfile } from "@shared/bridge"

const settingsSections = [
  {
    id: "general",
    label: "settings.nav.general",
    description: "settings.nav.general.desc",
    icon: MonitorCog,
  },
  {
    id: "notifications",
    label: "settings.nav.notifications",
    description: "settings.nav.notifications.desc",
    icon: BellRing,
  },
  {
    id: "appearance",
    label: "settings.nav.appearance",
    description: "settings.nav.appearance.desc",
    icon: Palette,
  },
  {
    id: "storage",
    label: "settings.nav.storage",
    description: "settings.nav.storage.desc",
    icon: HardDriveDownload,
  },
  {
    id: "shortcuts",
    label: "settings.nav.shortcuts",
    description: "settings.nav.shortcuts.desc",
    icon: Keyboard,
  },
  {
    id: "updates",
    label: "settings.nav.updates",
    description: "settings.nav.updates.desc",
    icon: RefreshCw,
  },
  {
    id: "workspace",
    label: "settings.nav.workspace",
    description: "settings.nav.workspace.desc",
    icon: Server,
  },
  {
    id: "about",
    label: "settings.nav.about",
    description: "settings.nav.about.desc",
    icon: CircleHelp,
  },
] as const satisfies ReadonlyArray<{
  id: string
  label: TranslationKey
  description: TranslationKey
  icon: typeof MonitorCog
}>

export type SettingsSectionId = (typeof settingsSections)[number]["id"]

export function SettingsCenter({
  activeSection,
  appInfo,
  children,
  platform,
  profile,
  onOpenChange,
  onSectionChange,
}: {
  activeSection: SettingsSectionId
  appInfo?: DesktopAppInfo
  children: ReactNode
  platform?: string
  profile: ServerProfile
  onOpenChange(open: boolean): void
  onSectionChange(section: SettingsSectionId): void
}) {
  const { t } = useLocale()
  const usesTitleBarOverlay = platform === "win32" || platform === "linux"
  const currentSection =
    settingsSections.find((section) => section.id === activeSection) ?? settingsSections[0]

  useEffect(() => {
    const applicationFrame = document.querySelector<HTMLElement>(".desktop-frame")
    if (!applicationFrame) return

    const wasInert = applicationFrame.hasAttribute("inert")
    const previousAriaHidden = applicationFrame.getAttribute("aria-hidden")
    applicationFrame.setAttribute("inert", "")
    applicationFrame.setAttribute("aria-hidden", "true")

    return () => {
      if (!wasInert) applicationFrame.removeAttribute("inert")
      if (previousAriaHidden === null) applicationFrame.removeAttribute("aria-hidden")
      else applicationFrame.setAttribute("aria-hidden", previousAriaHidden)
    }
  }, [])

  return (
    <Dialog modal={false} open onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn("settings-center", usesTitleBarOverlay && "settings-center-below-titlebar")}
        overlayClassName={
          usesTitleBarOverlay ? "settings-center-overlay-below-titlebar" : undefined
        }
        staticOverlay
        onEscapeKeyDown={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("[data-shortcut-recording]")
          ) {
            event.preventDefault()
          }
        }}
        onPointerDownOutside={(event) => {
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("[data-sonner-toaster]")
          ) {
            event.preventDefault()
          }
        }}
      >
        <DialogTitle className="sr-only">{t("settings.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("settings.description")}</DialogDescription>

        <aside className="settings-center-sidebar">
          <div className="settings-center-profile">
            <img alt={t("brand.name")} src="/logo.png" />
            <div>
              <strong>
                {t("brand.name")}
                {appInfo && (
                  <span className="settings-center-profile-version">v{appInfo.version}</span>
                )}
              </strong>
              <span title={profile.displayName}>{profile.displayName}</span>
            </div>
          </div>
          <nav aria-label={t("settings.navLabel")} className="settings-center-navigation">
            {settingsSections.map((section) => {
              const Icon = section.icon
              const selected = section.id === activeSection
              return (
                <button
                  aria-current={selected ? "page" : undefined}
                  className="settings-center-nav-item"
                  key={section.id}
                  onClick={() => onSectionChange(section.id)}
                  type="button"
                >
                  <Icon aria-hidden="true" size={18} />
                  <span>{t(section.label)}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="settings-center-content">
          <header className="settings-center-content-header">
            <div>
              <h2>{t(currentSection.label)}</h2>
              <p>{t(currentSection.description)}</p>
            </div>
            <button
              aria-label={t("settings.close")}
              className="settings-center-close"
              onClick={() => onOpenChange(false)}
              title={t("settings.close")}
              type="button"
            >
              <X aria-hidden="true" size={19} />
            </button>
          </header>

          <div className="settings-center-scroll">{children}</div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
