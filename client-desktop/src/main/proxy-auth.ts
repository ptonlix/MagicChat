import path from "node:path"
import { BrowserWindow, ipcMain } from "electron"
import type { WindowController } from "./window-controller"

type LoginCallback = (username?: string, password?: string) => void

export class ProxyAuthPrompt {
  private window?: BrowserWindow
  private readonly credentials = new Map<string, { expiresAt: number; password: string; username: string }>()

  constructor(private readonly windows: WindowController, private readonly preloadPath = path.resolve(__dirname, "../preload/index.cjs")) {}

  show(callback: LoginCallback, proxyHost = ""): void {
    if (this.window && !this.window.isDestroyed()) {
      callback()
      this.window.focus()
      return
    }
    const parent = this.windows.current()
    const prompt = new BrowserWindow({
      height: 370,
      modal: Boolean(parent),
      parent,
      resizable: false,
      show: false,
      title: "代理认证",
      webPreferences: { additionalArguments: ["--magicchat-proxy-auth"], contextIsolation: true, nodeIntegration: false, preload: this.preloadPath, sandbox: true, webSecurity: true },
      width: 430,
    })
    this.window = prompt
    let settled = false
    const settle = (username?: string, password?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ipcMain.removeListener("desktop:internal:proxy-auth-submit", submit)
      ipcMain.removeListener("desktop:internal:proxy-auth-cancel", cancel)
      callback(username, password)
      if (proxyHost && username !== undefined && password !== undefined) {
        this.credentials.set(proxyHost.toLowerCase(), { expiresAt: Date.now() + 10 * 60_000, password, username })
      }
      if (!prompt.isDestroyed()) prompt.destroy()
    }
    const submit = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender.id !== prompt.webContents.id || !value || typeof value !== "object") return
      const input = value as { password?: unknown; username?: unknown }
      if (typeof input.username !== "string" || typeof input.password !== "string" || input.username.length > 256 || input.password.length > 1024) return
      settle(input.username, input.password)
    }
    const cancel = (event: Electron.IpcMainEvent) => { if (event.sender.id === prompt.webContents.id) settle() }
    ipcMain.on("desktop:internal:proxy-auth-submit", submit)
    ipcMain.on("desktop:internal:proxy-auth-cancel", cancel)
    const timeout = setTimeout(() => settle(), 2 * 60_000)
    prompt.on("closed", () => settle())
    prompt.once("ready-to-show", () => prompt.show())
    void prompt.loadURL("magicchat-app://app/proxy-auth.html")
  }

  getCredentials(proxyHost: string): { password: string; username: string } | undefined {
    const value = this.credentials.get(proxyHost.toLowerCase())
    if (!value || value.expiresAt <= Date.now()) {
      this.credentials.delete(proxyHost.toLowerCase())
      return undefined
    }
    return { password: value.password, username: value.username }
  }
}
