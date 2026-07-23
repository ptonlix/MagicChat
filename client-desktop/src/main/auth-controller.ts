import { randomBytes } from "node:crypto"
import { app, BrowserWindow } from "electron"
import type { DesktopAuthResult, ServerProfile } from "@shared/bridge"
import { ServerProfiles } from "@main/server-profiles"
import { SessionController } from "@main/session-controller"

const AUTH_TIMEOUT_MS = 10 * 60_000

type PendingAuthentication = {
  completing: boolean
  profile: ServerProfile
  timer: NodeJS.Timeout
  window: BrowserWindow
}

export class AuthController {
  private readonly pending = new Map<string, PendingAuthentication>()

  constructor(
    private readonly profiles: ServerProfiles,
    private readonly sessions: SessionController,
    private readonly onFinished: (result: DesktopAuthResult) => void,
    private readonly getParentWindow: () => BrowserWindow | undefined
  ) {}

  start(
    serverId: string,
    providerKey: string
  ): { transactionId: string } {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(providerKey)) {
      throw new Error("第三方登录方式无效")
    }
    if (this.pending.size > 0) {
      const active = [...this.pending.values()][0]
      active.window.show()
      active.window.focus()
      throw new Error("已有第三方登录正在进行")
    }

    const profile = this.profiles.require(serverId)
    const transactionId = randomBytes(32).toString("base64url")
    const profileSession = this.sessions.for(profile)
    const parent = this.getParentWindow()
    const authWindow = new BrowserWindow({
      autoHideMenuBar: true,
      backgroundColor: "#ffffff",
      height: 720,
      minHeight: 560,
      minWidth: 420,
      parent,
      show: false,
      title: `登录到 ${profile.displayName}`,
      webPreferences: {
        contextIsolation: true,
        devTools: !app.isPackaged,
        nodeIntegration: false,
        sandbox: true,
        session: profileSession,
        webSecurity: true,
      },
      width: 520,
    })
    const timer = setTimeout(
      () =>
        this.finish(transactionId, {
          error: "第三方登录已超时，请重新尝试",
          status: "error",
          transactionId,
        }),
      AUTH_TIMEOUT_MS
    )
    this.pending.set(transactionId, {
      completing: false,
      profile,
      timer,
      window: authWindow,
    })

    authWindow.once("ready-to-show", () => authWindow.show())
    authWindow.once("closed", () => {
      if (this.pending.has(transactionId)) {
        this.finish(transactionId, { status: "canceled", transactionId })
      }
    })
    authWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedAuthNavigation(url, profile.normalizedUrl)) {
        void authWindow.loadURL(url)
      }
      return { action: "deny" }
    })
    authWindow.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedAuthNavigation(url, profile.normalizedUrl)) {
        event.preventDefault()
      }
    })
    authWindow.webContents.on("did-navigate", (_event, url) => {
      void this.completeIfAuthenticated(transactionId, url)
    })
    authWindow.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        if (isMainFrame && errorCode !== -3 && this.pending.has(transactionId)) {
          this.finish(transactionId, {
            error: `认证页面加载失败：${errorDescription}`,
            status: "error",
            transactionId,
          })
        }
      }
    )
    const preventDownload = (
      event: Electron.Event,
      _item: Electron.DownloadItem,
      webContents: Electron.WebContents
    ) => {
      if (webContents.id === authWindow.webContents.id) event.preventDefault()
    }
    profileSession.on("will-download", preventDownload)
    authWindow.once("closed", () => {
      profileSession.removeListener("will-download", preventDownload)
    })

    const startUrl = buildWebAuthStartUrl(profile, providerKey)
    void authWindow.loadURL(startUrl).catch((error: unknown) => {
      if (!this.pending.has(transactionId)) return
      this.finish(transactionId, {
        error: error instanceof Error ? error.message : "无法打开第三方登录页面",
        status: "error",
        transactionId,
      })
    })

    return { transactionId }
  }

  cancel(transactionId: string): void {
    if (!this.pending.has(transactionId)) return
    this.finish(transactionId, { status: "canceled", transactionId })
  }

  dispose(): void {
    for (const [transactionId, pending] of this.pending) {
      this.pending.delete(transactionId)
      clearTimeout(pending.timer)
      if (!pending.window.isDestroyed()) pending.window.destroy()
    }
  }

  private async completeIfAuthenticated(
    transactionId: string,
    rawUrl: string
  ): Promise<void> {
    const pending = this.pending.get(transactionId)
    if (!pending || pending.completing) return
    if (!isAuthCompletionUrl(rawUrl, pending.profile.normalizedUrl)) return

    pending.completing = true
    try {
      const response = await this.sessions
        .for(pending.profile)
        .fetch(`${pending.profile.normalizedUrl}/api/client/me`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        })
      const payload = (await response.json()) as {
        data?: { user?: { id?: string } }
      }
      const userId = payload.data?.user?.id
      if (!response.ok || !userId) throw new Error("登录会话验证失败")

      await this.profiles.recordUser(pending.profile.id, userId)
      this.finish(transactionId, { status: "success", transactionId, userId })
    } catch (error) {
      this.finish(transactionId, {
        error: error instanceof Error ? error.message : "第三方登录失败",
        status: "error",
        transactionId,
      })
    }
  }

  private finish(transactionId: string, result: DesktopAuthResult): void {
    const pending = this.pending.get(transactionId)
    if (!pending) return
    this.pending.delete(transactionId)
    clearTimeout(pending.timer)
    if (!pending.window.isDestroyed()) pending.window.close()
    this.onFinished(result)
  }
}

export function buildWebAuthStartUrl(
  profile: Pick<ServerProfile, "normalizedUrl">,
  providerKey: string
): string {
  return `${profile.normalizedUrl}/api/client/auth/third-party/${encodeURIComponent(providerKey)}/start?redirect=/init`
}

export function isAllowedAuthNavigation(
  rawUrl: string,
  serverUrl: string
): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === "https:") return true
    const server = new URL(serverUrl)
    return (
      url.origin === server.origin &&
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
  } catch {
    return false
  }
}

export function isAuthCompletionUrl(
  rawUrl: string,
  serverUrl: string
): boolean {
  try {
    const url = new URL(rawUrl)
    const server = new URL(serverUrl)
    return (
      url.origin === server.origin &&
      (url.pathname === "/init" || url.pathname.startsWith("/init/"))
    )
  } catch {
    return false
  }
}
