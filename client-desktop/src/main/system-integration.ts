import path from "node:path"
import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { app, Menu, nativeImage, session, systemPreferences, Tray } from "electron"
import { ConfigStore } from "./config-store"
import { WindowController } from "./window-controller"

export class SystemIntegration {
  private tray?: Tray
  private readonly granted = new Set<"microphone" | "notifications">()

  constructor(private readonly store: ConfigStore, private readonly windows: WindowController) {}

  createTray(iconPath: string): boolean {
    try {
      const image = nativeImage.createFromPath(iconPath)
      if (image.isEmpty()) return false
      this.tray = new Tray(image.resize({ height: 20, width: 20 }))
      this.tray.setToolTip("MagicChat")
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: "显示 MagicChat", click: () => this.windows.show() },
        { label: "隐藏窗口", click: () => this.windows.hide() },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]))
      this.tray.on("click", () => this.windows.show())
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
    if (process.platform === "darwin") app.dock?.setBadge(normalized ? String(normalized) : "")
    else if (process.platform === "linux") app.setBadgeCount(normalized)
    else this.tray?.setToolTip(normalized ? `MagicChat（${normalized} 条未读）` : "MagicChat")
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
