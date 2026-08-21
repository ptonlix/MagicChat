import { app, BrowserWindow, type BrowserWindowConstructorOptions, type Event } from "electron"
import { ConfigStore } from "@main/config-store"
import { Diagnostics } from "@main/diagnostics"
import { resolveWindowCloseAction } from "@main/window-close-policy"
import { monitorWindowResponsiveness } from "@main/window-responsiveness"
import { DESKTOP_TITLEBAR_HEIGHT } from "@shared/bridge"
import { normalizeDiagnosticProcessExitReason } from "@shared/diagnostics-contract"

export class WindowController {
  private mainWindow?: BrowserWindow
  private quitting = false

  constructor(
    private readonly store: ConfigStore,
    private readonly diagnostics: Diagnostics,
    private readonly preloadPath: string,
    private readonly iconPath: string,
  ) {}

  create(startHidden = false): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow
    const window = new BrowserWindow({
      backgroundColor: "#ffffff",
      height: 820,
      icon: this.iconPath,
      minHeight: 560,
      minWidth: 760,
      ...getMainWindowTitleBarOptions(process.platform),
      show: false,
      title: "即应",
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
    window.removeMenu()
    this.mainWindow = window
    installTrustedWindowSecurity(window)
    window.on("ready-to-show", () => {
      if (!startHidden) window.show()
    })
    window.on("close", (event) => this.handleClose(event))
    window.webContents.on("render-process-gone", (_event, details) => {
      void this.diagnostics.recordEvent({
        data: { processExitReason: normalizeDiagnosticProcessExitReason(details.reason) },
        origin: "renderer",
        type: "renderer.process-gone",
      })
      if (!this.quitting) void window.loadURL("magicchat-app://app/recovery.html")
    })
    monitorWindowResponsiveness(window, this.diagnostics)
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

  hide(): void {
    this.mainWindow?.hide()
  }
  current(): BrowserWindow | undefined {
    return this.mainWindow?.isDestroyed() ? undefined : this.mainWindow
  }
  cancelPrepareToQuit(): void {
    this.quitting = false
  }
  prepareToQuit(): void {
    this.quitting = true
  }

  setThemeBackground(dark: boolean): void {
    const window = this.current()
    if (window) setTrustedWindowTheme(window, dark, process.platform)
  }

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

  private handleClose(event: Event): void {
    const action = resolveWindowCloseAction({
      appReady: app.isReady(),
      closeBehavior: this.store.getSettings().closeBehavior,
      quitting: this.quitting,
    })
    if (action === "allow") return

    event.preventDefault()
    if (action === "hide") this.mainWindow?.hide()
    else app.quit()
  }
}

export function setTrustedWindowTheme(
  window: Pick<BrowserWindow, "setBackgroundColor" | "setTitleBarOverlay">,
  dark: boolean,
  platform: NodeJS.Platform,
): void {
  window.setBackgroundColor(dark ? "#09090b" : "#ffffff")
  if (platform === "darwin") return
  window.setTitleBarOverlay({
    color: "#00000000",
    height: DESKTOP_TITLEBAR_HEIGHT,
    symbolColor: dark ? "#fafafa" : "#18181b",
  })
}

export type TrustedWindowSecurityOptions = Readonly<{
  navigationGuard?: (url: string) => boolean
}>

export function installTrustedWindowSecurity(
  window: BrowserWindow,
  options: TrustedWindowSecurityOptions = {},
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedWindowNavigation(url, options.navigationGuard)) return
    event.preventDefault()
  })
  window.webContents.on("will-redirect", (event, url) => {
    if (isAllowedWindowNavigation(url, options.navigationGuard)) return
    event.preventDefault()
  })
}

export function isMainApplicationUrl(rawUrl: string, packaged: boolean): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.search || url.hash) return false
    if (url.protocol === "magicchat-app:" && url.hostname === "app")
      return url.pathname === "/" || url.pathname === "/index.html"
    if (!packaged && url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
      return url.pathname === "/" || url.pathname === "/index.html"
  } catch {
    return false
  }
  return false
}

export function getMainWindowTitleBarOptions(
  platform: NodeJS.Platform,
): Pick<
  BrowserWindowConstructorOptions,
  "titleBarOverlay" | "titleBarStyle" | "trafficLightPosition"
> {
  if (platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 6, y: 13 },
    }
  }

  return {
    titleBarOverlay: {
      color: "#00000000",
      height: DESKTOP_TITLEBAR_HEIGHT,
      symbolColor: "#18181b",
    },
    titleBarStyle: "hidden",
  }
}

function isTrustedRenderer(rawUrl: string): boolean {
  if (rawUrl.startsWith("magicchat-app://app/")) return true
  if (!app.isPackaged) {
    try {
      const url = new URL(rawUrl)
      return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)
    } catch {
      return false
    }
  }
  return false
}

function isAllowedWindowNavigation(
  rawUrl: string,
  navigationGuard?: (url: string) => boolean,
): boolean {
  return isTrustedRenderer(rawUrl) && (navigationGuard?.(rawUrl) ?? true)
}
