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
import type { ServerProfile } from "@shared/bridge"

const settingsSections = [
  { id: "general", label: "通用", description: "启动与窗口行为", icon: MonitorCog },
  { id: "notifications", label: "新消息通知", description: "提示音与内容隐私", icon: BellRing },
  { id: "appearance", label: "外观与布局", description: "应用配色", icon: Palette },
  { id: "storage", label: "存储空间", description: "本地消息缓存", icon: HardDriveDownload },
  { id: "shortcuts", label: "快捷键", description: "全局操作组合键", icon: Keyboard },
  { id: "updates", label: "软件更新", description: "检查与安装版本", icon: RefreshCw },
  { id: "workspace", label: "工作空间", description: "服务器连接信息", icon: Server },
  { id: "about", label: "关于即应", description: "版本与诊断", icon: CircleHelp },
] as const

export type SettingsSectionId = (typeof settingsSections)[number]["id"]

export function SettingsCenter({
  activeSection,
  children,
  platform,
  profile,
  onOpenChange,
  onSectionChange,
}: {
  activeSection: SettingsSectionId
  children: ReactNode
  platform?: string
  profile: ServerProfile
  onOpenChange(open: boolean): void
  onSectionChange(section: SettingsSectionId): void
}) {
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
        <DialogTitle className="sr-only">设置</DialogTitle>
        <DialogDescription className="sr-only">管理即应桌面端设置</DialogDescription>

        <aside className="settings-center-sidebar">
          <div className="settings-center-profile">
            <img alt="即应" src="/logo.png" />
            <div>
              <strong>即应</strong>
              <span title={profile.displayName}>{profile.displayName}</span>
            </div>
          </div>
          <nav aria-label="设置分类" className="settings-center-navigation">
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
                  <span>{section.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="settings-center-content">
          <header className="settings-center-content-header">
            <div>
              <h2>{currentSection.label}</h2>
              <p>{currentSection.description}</p>
            </div>
            <button
              aria-label="关闭设置"
              className="settings-center-close"
              onClick={() => onOpenChange(false)}
              title="关闭设置"
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
