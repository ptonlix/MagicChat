import path from "node:path"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { app, Menu, nativeImage, session, systemPreferences, Tray } from "electron"
import { ConfigStore } from "@main/config-store"
import { formatUnreadBadge } from "@main/unread-badge"
import { WindowController } from "@main/window-controller"
import type { TrayMessage } from "@shared/bridge"

export class SystemIntegration {
  private tray?: Tray
  private trayMessages: ReadonlyArray<TrayMessage> = []
  private readonly granted = new Set<"microphone" | "notifications">()

  constructor(private readonly store: ConfigStore, private readonly windows: WindowController) {}

  createTray(iconPath: string): boolean {
    try {
      const image = nativeImage.createFromPath(iconPath)
      if (image.isEmpty()) return false
      this.tray = new Tray(image.resize({ height: 20, width: 20 }))
      this.tray.setToolTip("即应")
      this.refreshTrayMenu()
      this.tray.on("click", () => this.tray?.popUpContextMenu())
      return true
    } catch { return false }
  }

  async setAutoLaunch(enabled: boolean): Promise<void> {
    if (process.platform === "linux") await setLinuxAutoLaunch(enabled)
    else app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled, args: enabled ? ["--hidden"] : [] })
    await this.store.setSettings({ autoLaunch: enabled })
  }

  setBadge(count: number): void {
    const normalized = Math.max(0, Math.min(9999, Math.trunc(count)))
    if (process.platform === "darwin") {
      const badge = formatUnreadBadge(normalized)
      app.dock?.setBadge(badge)
      this.tray?.setTitle(badge ? ` ${badge}` : "")
    }
    else if (process.platform === "linux") app.setBadgeCount(normalized)
    else this.tray?.setToolTip(normalized ? `即应（${normalized} 条未读）` : "即应")
  }

  setTrayMessages(messages: ReadonlyArray<TrayMessage>): void {
    this.trayMessages = messages
    this.refreshTrayMenu()
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return
    const messageItems = this.trayMessages.length > 0
      ? this.trayMessages.map((message) => ({
          click: () => void this.openTrayMessage(message).catch(() => this.windows.show()),
          label: trayMessageLabel(message.name, message.unreadCount),
          sublabel: message.summary,
        }))
      : [{ enabled: false, label: "暂无最新消息" }]

    this.tray.setContextMenu(Menu.buildFromTemplate([
      { enabled: false, label: "最新消息" },
      ...messageItems,
      { type: "separator" },
      { label: "打开即应", click: () => this.windows.show() },
      { label: "关闭即应", click: () => app.quit() },
    ]))
  }

  private async openTrayMessage(message: TrayMessage): Promise<void> {
    await this.store.setSettings({ selectedServerId: message.serverId })
    await this.windows.verifyAndNavigate(`/chat/${encodeURIComponent(message.conversationId)}`)
  }

  configurePermissions(): void {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(this.isGranted(permission)))
    session.defaultSession.setPermissionCheckHandler((_contents, permission) => this.isGranted(permission))
  }

  async requestPermission(kind: "microphone" | "notifications"): Promise<boolean> {
    if (kind === "microphone" && process.platform === "darwin") {
      const granted = await systemPreferences.askForMediaAccess("microphone")
      if (granted) this.granted.add(kind)
      return granted
    }
    this.granted.add(kind)
    return true
  }

  private isGranted(permission: string): boolean {
    if (permission === "media") return this.granted.has("microphone")
    if (permission === "notifications") return this.granted.has("notifications")
    return false
  }
}

function trayMessageLabel(name: string, unreadCount: number): string {
  const badge = formatUnreadBadge(unreadCount)
  return badge ? `${name}  [${badge}]` : name
}

export function runtimeIconPath(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "logo.png") : path.resolve(__dirname, "../../../client-desktop/public/logo.png")
}

async function setLinuxAutoLaunch(enabled: boolean): Promise<void> {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(app.getPath("home"), ".config")
  const directory = path.join(configRoot, "autostart")
  const filePath = path.join(directory, "com.magicchat.desktop.desktop")
  if (!enabled) {
    await rm(filePath, { force: true })
    return
  }
  await mkdir(directory, { mode: 0o700, recursive: true })
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, linuxAutostartEntry(process.execPath), { mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export function linuxAutostartEntry(executable: string): string {
  const escaped = executable.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")
  return `[Desktop Entry]\nType=Application\nName=MagicChat\nExec="${escaped}" --hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`
}
