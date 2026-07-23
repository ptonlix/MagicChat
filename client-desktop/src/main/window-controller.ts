import path from "node:path"
import { app, BrowserWindow, dialog, shell, type Event } from "electron"
import { ConfigStore } from "./config-store"
import { Diagnostics } from "./diagnostics"

export class WindowController {
  private mainWindow?: BrowserWindow
  private quitting = false

  constructor(private readonly store: ConfigStore, private readonly diagnostics: Diagnostics, private readonly preloadPath: string) {}

  create(startHidden = false): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow
    const window = new BrowserWindow({
      backgroundColor: "#ffffff",
      height: 820,
      minHeight: 560,
      minWidth: 760,
      show: false,
      title: "MagicChat",
      webPreferences: {
        contextIsolation: true,
        devTools: !app.isPackaged,
        nodeIntegration: false,
        preload: this.preloadPath,
        sandbox: true,
        webSecurity: true,
      },
      width: 1280,
    })
    this.mainWindow = window
    this.installSecurity(window)
    window.on("ready-to-show", () => { if (!startHidden) window.show() })
    window.on("close", (event) => this.handleClose(event))
    window.webContents.on("render-process-gone", (_event, details) => {
      void this.diagnostics.record("renderer", details.reason)
      if (!this.quitting) void window.loadURL("magicchat-app://app/recovery.html")
    })
    window.on("unresponsive", () => {
      const choice = dialog.showMessageBoxSync(window, { type: "warning", buttons: ["等待", "重新加载"], defaultId: 0, cancelId: 0, message: "MagicChat 暂时没有响应" })
      if (choice === 1) window.webContents.reload()
    })
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    if (!app.isPackaged && developmentUrl) void window.loadURL(developmentUrl)
    else void window.loadURL("magicchat-app://app/index.html")
    return window
  }

  show(): void {
    const window = this.create(false)
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  hide(): void { this.mainWindow?.hide() }
  current(): BrowserWindow | undefined { return this.mainWindow?.isDestroyed() ? undefined : this.mainWindow }
  prepareToQuit(): void { this.quitting = true }

  send(channel: string, payload?: unknown): void {
    const window = this.current()
    if (!window) return
    if (window.webContents.isLoadingMainFrame()) {
      window.webContents.once("did-finish-load", () => {
        if (!window.isDestroyed()) window.webContents.send(channel, payload)
      })
      return
    }
    window.webContents.send(channel, payload)
  }

  async verifyAndNavigate(route: string): Promise<void> {
    if (!route.startsWith("/") || route.length > 2048) throw new Error("导航目标无效")
    this.show()
    this.send("desktop:v1:navigate", route)
  }

  private installSecurity(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternal(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    window.webContents.on("will-navigate", (event, url) => {
      if (isTrustedRenderer(url)) return
      event.preventDefault()
      if (isAllowedExternal(url)) void shell.openExternal(url)
    })
  }

  private handleClose(event: Event): void {
    if (this.quitting) return
    if (process.platform === "darwin") return
    if (this.store.getSettings().closeBehavior === "background" && app.isReady()) {
      event.preventDefault()
      this.mainWindow?.hide()
    }
  }
}

function isTrustedRenderer(rawUrl: string): boolean {
  if (rawUrl.startsWith("magicchat-app://app/")) return true
  if (!app.isPackaged) {
    try { const url = new URL(rawUrl); return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) } catch { return false }
  }
  return false
}

function isAllowedExternal(rawUrl: string): boolean {
  try { return new URL(rawUrl).protocol === "https:" } catch { return false }
}
