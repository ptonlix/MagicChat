import path from "node:path"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import {
  app,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  systemPreferences,
  Tray,
  type NativeImage,
} from "electron"
import { ConfigStore } from "@main/config-store"
import { presentTrayMessage } from "@main/tray-message-presentation"
import { formatUnreadBadge } from "@main/unread-badge"
import { WindowController } from "@main/window-controller"
import { MAX_TRAY_MESSAGES } from "@shared/bridge"
import type { TrayMessage } from "@shared/bridge"
import type { DesktopThemeSource } from "@shared/bridge"

export class SystemIntegration {
  private tray?: Tray
  private trayMessages: ReadonlyArray<TrayMessage> = []
  private readonly granted = new Set<"microphone" | "notifications">()
  private readonly handleNativeThemeUpdated = () => this.syncThemeBackground()

  constructor(
    private readonly store: ConfigStore,
    private readonly windows: WindowController,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly additionalThemeWindows: ReadonlyArray<{
      setThemeBackground(dark: boolean): void
    }> = [],
  ) {
    nativeTheme.on("updated", this.handleNativeThemeUpdated)
  }

  createTray(iconPath: string): boolean {
    try {
      const image = nativeImage.createFromPath(iconPath)
      if (image.isEmpty()) return false
      this.tray = new Tray(prepareTrayImage(image, this.platform))
      this.tray.setToolTip("即应")
      this.refreshTrayMenu()
      this.tray.on("click", () => this.tray?.popUpContextMenu())
      return true
    } catch {
      return false
    }
  }

  setThemeSource(source: DesktopThemeSource): void {
    nativeTheme.themeSource = source
    this.syncThemeBackground()
  }

  dispose(): void {
    nativeTheme.off("updated", this.handleNativeThemeUpdated)
  }

  private syncThemeBackground(): void {
    const dark = nativeTheme.shouldUseDarkColors
    this.windows.setThemeBackground(dark)
    for (const windows of this.additionalThemeWindows) windows.setThemeBackground(dark)
  }

  async setAutoLaunch(enabled: boolean): Promise<void> {
    if (this.platform === "linux") await setLinuxAutoLaunch(enabled)
    else
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: enabled,
        args: enabled ? ["--hidden"] : [],
      })
    await this.store.setSettings({ autoLaunch: enabled })
  }

  setBadge(count: number): void {
    const normalized = Math.max(0, Math.min(9999, Math.trunc(count)))
    if (this.platform === "darwin") {
      const badge = formatUnreadBadge(normalized)
      app.dock?.setBadge(badge)
      this.tray?.setTitle(badge ? ` ${badge}` : "")
    } else if (this.platform === "linux") app.setBadgeCount(normalized)
    else this.tray?.setToolTip(normalized ? `即应（${normalized} 条未读）` : "即应")
  }

  setTrayMessages(messages: ReadonlyArray<TrayMessage>): void {
    this.trayMessages = messages.slice(0, MAX_TRAY_MESSAGES)
    this.refreshTrayMenu()
  }

  refreshTray(): void {
    this.refreshTrayMenu()
  }

  private refreshTrayMenu(): void {
    if (!this.tray) return
    if (this.platform === "darwin") {
      this.tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "打开即应", click: () => this.windows.show() },
          { label: "关闭即应", click: () => app.quit() },
        ]),
      )
      return
    }
    const privacy = this.store.getSettings().notificationPrivacy
    const messageItems =
      this.trayMessages.length > 0
        ? this.trayMessages.map((message) => ({
            ...presentTrayMessage(message, privacy),
            click: () => void this.openTrayMessage(message).catch(() => this.windows.show()),
          }))
        : [{ enabled: false, label: "暂无未读消息" }]

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { enabled: false, label: "未读消息" },
        ...messageItems,
        { type: "separator" },
        { label: "打开即应", click: () => this.windows.show() },
        { label: "关闭即应", click: () => app.quit() },
      ]),
    )
  }

  private async openTrayMessage(message: TrayMessage): Promise<void> {
    if (!this.store.server(message.serverId)) throw new Error("目标服务器不存在")
    await this.store.setSettings({ selectedServerId: message.serverId })
    await this.windows.verifyAndNavigate(`/chat/${encodeURIComponent(message.conversationId)}`)
  }

  configurePermissions(): void {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
      callback(this.isGranted(permission)),
    )
    session.defaultSession.setPermissionCheckHandler((_contents, permission) =>
      this.isGranted(permission),
    )
  }

  async requestPermission(kind: "microphone" | "notifications"): Promise<boolean> {
    if (kind === "microphone" && this.platform === "darwin") {
      const granted = await systemPreferences.askForMediaAccess("microphone")
      if (granted) this.granted.add(kind)
      return granted
    }
    this.granted.add(kind)
    return true
  }

  async openPermissionSettings(_kind: "screen"): Promise<boolean> {
    if (this.platform !== "darwin") return false
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    )
    return true
  }

  private isGranted(permission: string): boolean {
    if (permission === "media") return this.granted.has("microphone")
    if (permission === "notifications") return this.granted.has("notifications")
    return false
  }
}

export function prepareTrayImage(
  image: Pick<NativeImage, "resize">,
  platform: NodeJS.Platform,
): NativeImage {
  const resizedImage = image.resize({ height: 20, width: 20 })
  if (platform === "darwin") resizedImage.setTemplateImage(true)
  return resizedImage
}

export function runtimeIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "logo.png")
    : path.resolve(__dirname, "../../../client-desktop/public/logo.png")
}

export function runtimeTrayIconPath(platform: NodeJS.Platform = process.platform): string {
  if (platform !== "darwin") return runtimeIconPath()
  return app.isPackaged
    ? path.join(process.resourcesPath, "trayTemplate.png")
    : path.resolve(__dirname, "../../../client-desktop/public/trayTemplate.png")
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
