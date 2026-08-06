import { app, BrowserWindow, screen, type Display } from "electron"

import type { AuthenticatedTarget } from "@shared/client-contract"
import {
  buildDocumentWindowRoute,
  createdDocumentWindowResponse,
  documentWindowKey,
  documentWindowTargetKey,
  DOCUMENT_WINDOW_LIMITS,
  failedDocumentWindowResponse,
  parseDocumentWindowRequest,
  type DocumentWindowOpenResponse,
  type DocumentWindowRequest,
} from "@shared/document-window-contract"
import type { ConfigStore } from "@main/config-store"
import type { Diagnostics } from "@main/diagnostics"
import {
  clampDocumentWindowBounds,
  resolveDocumentWindowBounds,
  type DocumentWindowRectangle,
} from "@main/document-window-bounds"
import type {
  DocumentWindowPersistedState,
  DocumentWindowStateStore,
} from "@main/document-window-state"
import type { DocumentCollaborationController } from "@main/document-collaboration-controller"
import type { ServerProfiles } from "@main/server-profiles"
import { getMainWindowTitleBarOptions, installTrustedWindowSecurity } from "@main/window-controller"

type DocumentWindowEntry = {
  documentId: string
  key: string
  serverId: string
  targetKey: string
  userId: string
  window: BrowserWindow
  loadFailed: boolean
}

export type DocumentWindowManagerDependencies = {
  collaboration: Pick<DocumentCollaborationController, "closeOwner" | "closeServer" | "closeTarget">
  diagnostics: Pick<Diagnostics, "record">
  developmentUrl?: string
  getMainWindow(): BrowserWindow | undefined
  iconPath: string
  preloadPath: string
  profiles: Pick<ServerProfiles, "require">
  state: DocumentWindowStateStore
  store: Pick<ConfigStore, "getSettings">
}

type DocumentWindowOwnerTarget = Readonly<{
  serverId: string
  userId: string
}>

export class DocumentWindowManager {
  private readonly entries = new Map<string, DocumentWindowEntry>()
  private readonly ownerTargets = new Map<number, DocumentWindowOwnerTarget>()
  private disposed = false

  constructor(private readonly deps: DocumentWindowManagerDependencies) {}

  async open(ownerId: number, rawRequest: unknown): Promise<DocumentWindowOpenResponse> {
    if (this.disposed) return failedDocumentWindowResponse("disposed", "文档窗口能力已关闭")

    let request: DocumentWindowRequest
    try {
      request = parseDocumentWindowRequest(rawRequest)
    } catch (error) {
      return failedDocumentWindowResponse(
        "invalid_request",
        error instanceof Error ? error.message : "文档窗口请求无效",
      )
    }

    let profile
    try {
      profile = this.deps.profiles.require(request.serverId)
    } catch {
      return failedDocumentWindowResponse("server_not_found", "目标服务器不存在")
    }
    const userId = profile.lastUserId
    if (!userId) return failedDocumentWindowResponse("not_authenticated", "当前服务器尚未登录")

    const expectedTarget = this.expectedTarget(ownerId)
    if (
      !expectedTarget ||
      expectedTarget.serverId !== request.serverId ||
      expectedTarget.userId !== userId
    )
      return failedDocumentWindowResponse("target_mismatch", "文档窗口认证目标不匹配")

    const key = documentWindowKey(request, userId)
    const existing = this.entries.get(key)
    if (existing) {
      if (!existing.window.isDestroyed()) {
        this.focus(existing.window)
        return createdDocumentWindowResponse("focused")
      }
      this.cleanup(existing, false)
    }

    const target = documentWindowTargetKey(request.serverId, userId)
    if (this.countTargetWindows(target) >= DOCUMENT_WINDOW_LIMITS.maxPerTarget)
      return failedDocumentWindowResponse(
        "window_limit",
        `同一服务器最多打开 ${DOCUMENT_WINDOW_LIMITS.maxPerTarget} 个文档窗口，请先关闭已有窗口`,
      )

    const bounds = this.resolveBounds(key)
    let window: BrowserWindow
    try {
      window = new BrowserWindow({
        backgroundColor: "#ffffff",
        height: bounds.height,
        icon: this.deps.iconPath,
        minHeight: DOCUMENT_WINDOW_LIMITS.minHeight,
        minWidth: DOCUMENT_WINDOW_LIMITS.minWidth,
        ...getMainWindowTitleBarOptions(process.platform),
        show: false,
        title: "文档",
        webPreferences: {
          contextIsolation: true,
          devTools: !app.isPackaged,
          nodeIntegration: false,
          preload: this.deps.preloadPath,
          sandbox: true,
          webSecurity: true,
        },
        width: bounds.width,
        x: bounds.x,
        y: bounds.y,
      })
      window.removeMenu()
    } catch {
      return failedDocumentWindowResponse("load_failed", "文档窗口创建失败，请稍后重试")
    }

    const entry: DocumentWindowEntry = {
      documentId: request.documentId,
      key,
      loadFailed: false,
      serverId: request.serverId,
      targetKey: target,
      userId,
      window,
    }
    this.entries.set(key, entry)
    this.ownerTargets.set(
      window.webContents.id,
      Object.freeze({ serverId: request.serverId, userId }),
    )
    this.installLifecycle(entry)
    installTrustedWindowSecurity(window)
    try {
      await window.loadURL(
        buildDocumentWindowLoadUrl(request, app.isPackaged, this.deps.developmentUrl),
      )
    } catch {
      this.handleLoadFailure(entry)
      return failedDocumentWindowResponse("load_failed", "文档窗口加载失败，请稍后重试")
    }
    return createdDocumentWindowResponse("created")
  }

  get(key: string): BrowserWindow | undefined {
    const entry = this.entries.get(key)
    if (!entry || entry.window.isDestroyed()) return undefined
    return entry.window
  }

  size(targetKey?: string): number {
    return targetKey
      ? this.countTargetWindows(targetKey)
      : [...this.entries.values()].filter((entry) => !entry.window.isDestroyed()).length
  }

  closeTarget(target: AuthenticatedTarget): void {
    const key = documentWindowTargetKey(target.id, target.userId)
    for (const entry of [...this.entries.values()]) {
      if (entry.targetKey === key) this.closeEntry(entry)
    }
  }

  closeServer(serverId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.serverId === serverId) this.closeEntry(entry)
    }
  }

  closeOwner(ownerId: number): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.window.webContents.id === ownerId) this.cleanup(entry, false)
    }
    this.ownerTargets.delete(ownerId)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of [...this.entries.values()]) this.cleanup(entry, true)
    this.entries.clear()
    this.ownerTargets.clear()
  }

  private expectedTarget(ownerId: number): DocumentWindowOwnerTarget | undefined {
    const ownerTarget = this.ownerTargets.get(ownerId)
    if (ownerTarget) return ownerTarget
    const mainWindow = this.deps.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === ownerId) {
      const serverId = this.deps.store.getSettings().selectedServerId
      if (!serverId) return undefined
      try {
        const profile = this.deps.profiles.require(serverId)
        if (profile.lastUserId) return Object.freeze({ serverId, userId: profile.lastUserId })
      } catch {
        return undefined
      }
    }
    return undefined
  }

  private countTargetWindows(targetKey: string): number {
    return [...this.entries.values()].filter(
      (entry) => entry.targetKey === targetKey && !entry.window.isDestroyed(),
    ).length
  }

  private resolveBounds(key: string): DocumentWindowRectangle {
    const display = this.getMainDisplay()
    const mainBounds = this.deps.getMainWindow()?.getBounds()
    const saved = this.deps.state.get(key)
    return resolveDocumentWindowBounds(saved?.bounds, display.workArea, mainBounds)
  }

  private getMainDisplay(): Display {
    const mainBounds = this.deps.getMainWindow()?.getBounds()
    const point = mainBounds
      ? {
          x: mainBounds.x + Math.floor(mainBounds.width / 2),
          y: mainBounds.y + Math.floor(mainBounds.height / 2),
        }
      : { x: 0, y: 0 }
    return screen.getDisplayNearestPoint(point)
  }

  private installLifecycle(entry: DocumentWindowEntry): void {
    const { window } = entry
    window.on("ready-to-show", () => {
      if (!this.disposed && !window.isDestroyed()) this.focus(window)
    })
    window.on("resize", () => this.persistBounds(entry))
    window.on("move", () => this.persistBounds(entry))
    window.on("closed", () => this.cleanup(entry, false))
    window.webContents.on("render-process-gone", (_event, details) => {
      void this.deps.diagnostics.record("renderer", details.reason)
      this.cleanup(entry, false)
    })
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) this.handleLoadFailure(entry)
      },
    )
  }

  private handleLoadFailure(entry: DocumentWindowEntry): void {
    if (entry.loadFailed || this.entries.get(entry.key) !== entry) return
    entry.loadFailed = true
    void this.deps.diagnostics.record("renderer", "document-window-load-failed")
    this.cleanup(entry, false)
    if (!this.disposed && !entry.window.isDestroyed())
      void Promise.resolve(entry.window.loadURL("magicchat-app://app/recovery.html")).catch(
        () => undefined,
      )
  }

  private closeEntry(entry: DocumentWindowEntry): void {
    if (entry.window.isDestroyed()) {
      this.cleanup(entry, false)
      return
    }
    this.cleanup(entry, true)
  }

  private persistBounds(entry: DocumentWindowEntry): void {
    if (entry.window.isDestroyed()) return
    try {
      const raw = entry.window.getBounds()
      const display = screen.getDisplayNearestPoint({ x: raw.x, y: raw.y })
      const bounds = clampDocumentWindowBounds(raw, display.workArea)
      const state: DocumentWindowPersistedState = {
        bounds,
        displayId: display.id,
      }
      void this.deps.state.set(entry.key, state).catch(() => undefined)
    } catch {
      // 窗口正在销毁或系统屏幕信息暂不可用时，不阻断关闭流程。
    }
  }

  private focus(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  private cleanup(entry: DocumentWindowEntry, destroy: boolean): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
    this.ownerTargets.delete(entry.window.webContents.id)
    this.deps.collaboration.closeOwner(entry.window.webContents.id)
    if (!entry.loadFailed) this.persistBounds(entry)
    if (destroy && !entry.window.isDestroyed()) entry.window.destroy()
  }
}

export function buildDocumentWindowLoadUrl(
  request: DocumentWindowRequest,
  isPackaged: boolean,
  developmentUrl?: string,
): string {
  if (!isPackaged && developmentUrl) {
    try {
      const url = new URL(developmentUrl)
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username ||
        url.password
      )
        return buildDocumentWindowRoute(request)
      url.pathname = `/documents/document/${encodeURIComponent(request.documentId)}`
      url.search = new URLSearchParams({
        serverId: request.serverId,
        window: "document",
      }).toString()
      url.hash = ""
      return url.toString()
    } catch {
      // 开发地址来自 Main 环境变量；格式异常时回退到受控本地协议，不传播底层异常。
    }
  }
  return buildDocumentWindowRoute(request)
}
