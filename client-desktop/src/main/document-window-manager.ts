import { app, BrowserWindow, dialog, screen, type Display, type Event } from "electron"

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
import { normalizeDiagnosticProcessExitReason } from "@shared/diagnostics-contract"
import {
  getMainWindowTitleBarOptions,
  installTrustedWindowSecurity,
  setTrustedWindowTheme,
} from "@main/window-controller"

type DocumentWindowEntry = {
  boundsPersistTimer?: ReturnType<typeof setTimeout>
  closeRequest?: Readonly<{
    promise: Promise<boolean>
    resolve(closed: boolean): void
  }>
  documentId: string
  key: string
  loadRequest: Readonly<{
    promise: Promise<boolean>
    resolve(loaded: boolean): void
  }>
  loadResult?: boolean
  serverId: string
  targetKey: string
  userId: string
  window: BrowserWindow
  loadFailed: boolean
  closeConfirmationPending: boolean
}

export type DocumentWindowManagerDependencies = {
  collaboration: Pick<DocumentCollaborationController, "closeOwner" | "closeServer" | "closeTarget">
  diagnostics: Pick<Diagnostics, "recordEvent">
  developmentUrl?: string
  getMainWindow(): BrowserWindow | undefined
  iconPath: string
  initialDarkTheme?: boolean
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
  private readonly pendingStateWrites = new Set<Promise<void>>()
  private darkTheme: boolean
  private disposed = false

  constructor(private readonly deps: DocumentWindowManagerDependencies) {
    this.darkTheme = deps.initialDarkTheme ?? false
  }

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
        const loaded = await existing.loadRequest.promise
        if (!loaded || this.entries.get(existing.key) !== existing || existing.window.isDestroyed())
          return failedDocumentWindowResponse("load_failed", "文档窗口加载失败，请稍后重试")
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
      setTrustedWindowTheme(window, this.darkTheme, process.platform)
    } catch {
      return failedDocumentWindowResponse("load_failed", "文档窗口创建失败，请稍后重试")
    }

    let resolveLoad!: (loaded: boolean) => void
    const loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve
    })
    const entry: DocumentWindowEntry = {
      documentId: request.documentId,
      key,
      loadRequest: Object.freeze({ promise: loadPromise, resolve: resolveLoad }),
      loadFailed: false,
      serverId: request.serverId,
      targetKey: target,
      userId,
      window,
      closeConfirmationPending: false,
    }
    this.entries.set(key, entry)
    this.ownerTargets.set(
      window.webContents.id,
      Object.freeze({ serverId: request.serverId, userId }),
    )
    this.installLifecycle(entry)
    installTrustedWindowSecurity(window, {
      navigationGuard: (url) =>
        isDocumentWindowNavigationAllowed(url, request, app.isPackaged, this.deps.developmentUrl),
    })
    try {
      await window.loadURL(
        buildDocumentWindowLoadUrl(request, app.isPackaged, this.deps.developmentUrl),
      )
    } catch {
      this.handleLoadFailure(entry)
      return failedDocumentWindowResponse("load_failed", "文档窗口加载失败，请稍后重试")
    }
    if (entry.loadFailed || this.entries.get(entry.key) !== entry || entry.window.isDestroyed()) {
      this.resolveLoadRequest(entry, false)
      return failedDocumentWindowResponse("load_failed", "文档窗口加载失败，请稍后重试")
    }
    this.resolveLoadRequest(entry, true)
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

  async requestCloseAll(): Promise<boolean> {
    return this.requestCloseEntries([...this.entries.values()])
  }

  async requestCloseServer(serverId: string): Promise<boolean> {
    return this.requestCloseEntries(
      [...this.entries.values()].filter((entry) => entry.serverId === serverId),
    )
  }

  async deleteServerState(serverId: string): Promise<void> {
    await this.flushStateWrites()
    await this.deps.state.deleteServer(serverId)
  }

  setThemeBackground(dark: boolean): void {
    this.darkTheme = dark
    for (const entry of this.entries.values()) {
      if (!entry.window.isDestroyed()) setTrustedWindowTheme(entry.window, dark, process.platform)
    }
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
    const saved = this.deps.state.get(key)
    const display = this.getSavedDisplay(saved) ?? this.getMainDisplay()
    const mainBounds = this.deps.getMainWindow()?.getBounds()
    return resolveDocumentWindowBounds(saved?.bounds, display.workArea, mainBounds)
  }

  private getSavedDisplay(state: DocumentWindowPersistedState | undefined): Display | undefined {
    if (state?.displayId === undefined) return undefined
    return screen.getAllDisplays().find((display) => String(display.id) === String(state.displayId))
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
    window.on("resize", () => this.schedulePersistBounds(entry))
    window.on("move", () => this.schedulePersistBounds(entry))
    window.on("close", () => this.flushPersistBounds(entry))
    window.on("closed", () => this.cleanup(entry, false))
    window.webContents.on("will-prevent-unload", (event) => {
      void this.confirmBeforeUnload(entry, event)
    })
    window.webContents.on("render-process-gone", (_event, details) => {
      void this.deps.diagnostics.recordEvent({
        data: { processExitReason: normalizeDiagnosticProcessExitReason(details.reason) },
        origin: "renderer",
        type: "renderer.process-gone",
      })
      this.cleanup(entry, true)
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
    void this.deps.diagnostics.recordEvent({ origin: "main", type: "document-window.load-failed" })
    this.cleanup(entry, false)
    if (!this.disposed && !entry.window.isDestroyed())
      void Promise.resolve(entry.window.loadURL("magicchat-app://app/recovery.html")).catch(
        () => undefined,
      )
  }

  private async confirmBeforeUnload(entry: DocumentWindowEntry, event: Event): Promise<void> {
    if (
      entry.closeConfirmationPending ||
      this.entries.get(entry.key) !== entry ||
      entry.window.isDestroyed()
    )
      return

    entry.closeConfirmationPending = true
    try {
      const result = await dialog.showMessageBox(entry.window, {
        buttons: ["取消", "放弃修改"],
        cancelId: 0,
        defaultId: 0,
        message: "文档尚未同步完成，确定要放弃未同步修改并关闭吗？",
        noLink: true,
        title: "关闭文档",
        type: "warning",
      })
      if (
        result.response === 1 &&
        this.entries.get(entry.key) === entry &&
        !entry.window.isDestroyed()
      ) {
        // Electron 的 destroy() 不会再次触发 beforeunload，确认放弃后可以可靠关闭窗口。
        event.preventDefault()
        entry.window.destroy()
      } else {
        this.resolveCloseRequest(entry, false)
      }
    } catch {
      // 对话框异常时保留 beforeunload 拦截，避免未同步编辑被静默丢弃。
      this.resolveCloseRequest(entry, false)
    } finally {
      entry.closeConfirmationPending = false
    }
  }

  private closeEntry(entry: DocumentWindowEntry): void {
    if (entry.window.isDestroyed()) {
      this.cleanup(entry, false)
      return
    }
    this.cleanup(entry, true)
  }

  private requestClose(entry: DocumentWindowEntry): Promise<boolean> {
    if (entry.window.isDestroyed()) {
      this.cleanup(entry, false)
      return Promise.resolve(true)
    }
    if (entry.closeRequest) return entry.closeRequest.promise

    let resolve!: (closed: boolean) => void
    const promise = new Promise<boolean>((complete) => {
      resolve = complete
    })
    entry.closeRequest = Object.freeze({ promise, resolve })
    try {
      entry.window.close()
    } catch {
      this.resolveCloseRequest(entry, false)
    }
    return promise
  }

  private resolveCloseRequest(entry: DocumentWindowEntry, closed: boolean): void {
    const request = entry.closeRequest
    if (!request) return
    entry.closeRequest = undefined
    request.resolve(closed)
  }

  private resolveLoadRequest(entry: DocumentWindowEntry, loaded: boolean): void {
    if (entry.loadResult !== undefined) return
    entry.loadResult = loaded
    entry.loadRequest.resolve(loaded)
  }

  private async requestCloseEntries(entries: ReadonlyArray<DocumentWindowEntry>): Promise<boolean> {
    if (this.disposed) return true
    for (const entry of entries) {
      if (this.entries.get(entry.key) !== entry) continue
      if (!(await this.requestClose(entry))) {
        await this.flushStateWrites()
        return false
      }
    }
    await this.flushStateWrites()
    return true
  }

  private schedulePersistBounds(entry: DocumentWindowEntry): void {
    if (entry.boundsPersistTimer) clearTimeout(entry.boundsPersistTimer)
    entry.boundsPersistTimer = setTimeout(() => {
      entry.boundsPersistTimer = undefined
      this.persistBounds(entry)
    }, 200)
  }

  private flushPersistBounds(entry: DocumentWindowEntry): void {
    if (entry.boundsPersistTimer) {
      clearTimeout(entry.boundsPersistTimer)
      entry.boundsPersistTimer = undefined
    }
    this.persistBounds(entry)
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
      this.trackStateWrite(this.deps.state.set(entry.key, state))
    } catch {
      // 窗口正在销毁或系统屏幕信息暂不可用时，不阻断关闭流程。
    }
  }

  private trackStateWrite(write: Promise<void>): void {
    const tracked = write.catch(() => undefined)
    this.pendingStateWrites.add(tracked)
    void tracked.finally(() => this.pendingStateWrites.delete(tracked))
  }

  private async flushStateWrites(): Promise<void> {
    while (this.pendingStateWrites.size > 0) {
      await Promise.all([...this.pendingStateWrites])
    }
  }

  private focus(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  private cleanup(entry: DocumentWindowEntry, destroy: boolean): void {
    if (this.entries.get(entry.key) !== entry) return
    if (entry.boundsPersistTimer) clearTimeout(entry.boundsPersistTimer)
    entry.boundsPersistTimer = undefined
    this.entries.delete(entry.key)
    this.ownerTargets.delete(entry.window.webContents.id)
    this.deps.collaboration.closeOwner(entry.window.webContents.id)
    this.resolveLoadRequest(entry, false)
    if (!entry.loadFailed) this.persistBounds(entry)
    if (destroy && !entry.window.isDestroyed()) entry.window.destroy()
    this.resolveCloseRequest(entry, true)
  }
}

export function isDocumentWindowNavigationAllowed(
  rawUrl: string,
  request: DocumentWindowRequest,
  isPackaged: boolean,
  developmentUrl?: string,
): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol === "magicchat-app:") {
    if (url.hostname !== "app" || url.username || url.password) return false
    if (url.pathname === "/recovery.html") return !url.search && !url.hash
    return isCanonicalDocumentWindowUrl(url, request)
  }

  if (isPackaged || !developmentUrl) return false

  try {
    const development = new URL(developmentUrl)
    if (
      development.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(development.hostname) ||
      development.username ||
      development.password ||
      url.origin !== development.origin
    )
      return false
  } catch {
    return false
  }

  return isCanonicalDocumentWindowUrl(url, request)
}

function isCanonicalDocumentWindowUrl(url: URL, request: DocumentWindowRequest): boolean {
  if (url.pathname !== `/documents/document/${encodeURIComponent(request.documentId)}` || url.hash)
    return false

  const keys = [...url.searchParams.keys()].sort()
  return (
    keys.length === 2 &&
    keys[0] === "serverId" &&
    keys[1] === "window" &&
    url.searchParams.getAll("serverId").length === 1 &&
    url.searchParams.get("serverId") === request.serverId &&
    url.searchParams.getAll("window").length === 1 &&
    url.searchParams.get("window") === "document"
  )
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
