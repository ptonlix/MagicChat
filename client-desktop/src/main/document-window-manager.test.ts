import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  let nextWindowId = 2
  let rejectNextLoad = false
  class FakeWindow {
    readonly webContents = {
      id: nextWindowId++,
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        this.webContentsListeners.set(event, listener)
      }),
      setWindowOpenHandler: vi.fn(),
    }
    readonly listeners = new Map<string, (...args: unknown[]) => void>()
    readonly webContentsListeners = new Map<string, (...args: unknown[]) => void>()
    destroyed = false
    minimized = false
    readonly bounds = { height: 760, width: 1120, x: 160, y: 30 }
    readonly loadURL = vi.fn(async (_url: string) => {
      if (rejectNextLoad) {
        rejectNextLoad = false
        throw new Error("模拟文档窗口加载失败")
      }
    })
    readonly removeMenu = vi.fn()
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly restore = vi.fn(() => {
      this.minimized = false
    })
    readonly getBounds = vi.fn(() => ({ ...this.bounds }))
    readonly on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      this.listeners.set(event, listener)
    })
    readonly isDestroyed = vi.fn(() => this.destroyed)
    readonly isMinimized = vi.fn(() => this.minimized)
    readonly destroy = vi.fn(() => {
      this.destroyed = true
      this.listeners.get("closed")?.()
    })
    readonly close = vi.fn(() => this.destroy())

    constructor() {
      windows.push(this)
    }
  }
  const windows: Array<InstanceType<typeof FakeWindow>> = []
  const showMessageBox = vi.fn()
  return {
    FakeWindow,
    showMessageBox,
    windows,
    reset() {
      nextWindowId = 2
      rejectNextLoad = false
      windows.length = 0
    },
    rejectNextLoad() {
      rejectNextLoad = true
    },
  }
})

vi.mock("electron", () => ({
  app: { isPackaged: false },
  BrowserWindow: mocks.FakeWindow,
  dialog: { showMessageBox: mocks.showMessageBox },
  screen: {
    getDisplayNearestPoint: vi.fn(() => ({
      bounds: { height: 900, width: 1440, x: 0, y: 0 },
      id: "display-1",
      workArea: { height: 820, width: 1280, x: 0, y: 0 },
    })),
  },
}))

vi.mock("@main/window-controller", () => ({
  getMainWindowTitleBarOptions: vi.fn(() => ({ titleBarStyle: "hidden" })),
  installTrustedWindowSecurity: vi.fn(),
}))

import {
  buildDocumentWindowLoadUrl,
  DocumentWindowManager,
  isDocumentWindowNavigationAllowed,
  type DocumentWindowManagerDependencies,
} from "@main/document-window-manager"

const documentId = "550e8400-e29b-41d4-a716-446655440000"
const target = {
  id: "server-1",
  lastUserId: "user-1",
  normalizedUrl: "https://chat.example.com",
}

describe("DocumentWindowManager", () => {
  beforeEach(() => {
    mocks.reset()
    vi.clearAllMocks()
  })

  it("按目标和文档幂等创建并聚焦已有窗口", async () => {
    const mainWindow = createMainWindow()
    const manager = createManager(mainWindow)

    await expect(manager.open(1, { documentId, serverId: target.id })).resolves.toMatchObject({
      ok: true,
      result: { status: "created" },
    })
    const child = mocks.windows[0]!
    expect(child.loadURL).toHaveBeenCalledWith(
      `magicchat-app://app/documents/document/${documentId}?serverId=server-1&window=document`,
    )

    await expect(manager.open(1, { documentId, serverId: target.id })).resolves.toMatchObject({
      ok: true,
      result: { status: "focused" },
    })
    expect(mocks.windows).toHaveLength(1)
    expect(child.focus).toHaveBeenCalled()
  })

  it("开发环境使用 Vite 文档路由，不回退到过期的本地构建目录", async () => {
    const mainWindow = createMainWindow()
    const manager = createManager(
      mainWindow,
      undefined,
      undefined,
      target.id,
      "http://localhost:20050/",
    )

    await expect(manager.open(1, { documentId, serverId: target.id })).resolves.toMatchObject({
      ok: true,
      result: { status: "created" },
    })
    expect(mocks.windows[0]?.loadURL).toHaveBeenCalledWith(
      `http://localhost:20050/documents/document/${documentId}?serverId=server-1&window=document`,
    )
  })

  it("生产环境保持受控本地协议，异常开发地址不会泄漏为任意导航", () => {
    expect(
      buildDocumentWindowLoadUrl(
        { documentId, serverId: target.id },
        true,
        "http://localhost:20050/",
      ),
    ).toBe(`magicchat-app://app/documents/document/${documentId}?serverId=server-1&window=document`)
    expect(
      buildDocumentWindowLoadUrl({ documentId, serverId: target.id }, false, "not a url"),
    ).toBe(`magicchat-app://app/documents/document/${documentId}?serverId=server-1&window=document`)
    expect(
      buildDocumentWindowLoadUrl(
        { documentId, serverId: target.id },
        false,
        "https://attacker.example/",
      ),
    ).toBe(`magicchat-app://app/documents/document/${documentId}?serverId=server-1&window=document`)
  })

  it("文档窗口只允许规范文档路由和受控恢复页导航", () => {
    const request = { documentId, serverId: target.id }

    expect(
      isDocumentWindowNavigationAllowed(
        `magicchat-app://app/documents/document/${documentId}?serverId=server-1&window=document`,
        request,
        true,
      ),
    ).toBe(true)
    expect(
      isDocumentWindowNavigationAllowed("magicchat-app://app/recovery.html", request, true),
    ).toBe(true)
    expect(isDocumentWindowNavigationAllowed("magicchat-app://app/chat", request, true)).toBe(false)
    expect(
      isDocumentWindowNavigationAllowed(
        `magicchat-app://app/documents/document/${documentId}?serverId=server-1&window=document&x=1`,
        request,
        true,
      ),
    ).toBe(false)
    expect(isDocumentWindowNavigationAllowed("https://example.com", request, true)).toBe(false)
    expect(
      isDocumentWindowNavigationAllowed(
        `http://localhost:20050/documents/document/${documentId}?serverId=server-1&window=document`,
        request,
        false,
        "http://localhost:20050/",
      ),
    ).toBe(true)
  })

  it("主窗口聊天 owner 打开文档时只新增独立顶层窗口，不改变主窗口", async () => {
    const mainWindow = createMainWindow() as unknown as {
      isDestroyed(): boolean
      webContents: { id: number }
    }
    const manager = createManager(mainWindow)

    await expect(
      manager.open(mainWindow.webContents.id, { documentId, serverId: target.id }),
    ).resolves.toMatchObject({
      ok: true,
      result: { status: "created" },
    })
    expect(mainWindow.isDestroyed()).toBe(false)
    expect(mocks.windows).toHaveLength(1)
    expect(manager.size()).toBe(1)
  })

  it("限制同一认证目标最多八个窗口并在关闭后允许重建", async () => {
    const mainWindow = createMainWindow()
    const collaboration = { closeOwner: vi.fn(), closeServer: vi.fn(), closeTarget: vi.fn() }
    const manager = createManager(mainWindow, collaboration)
    for (let index = 0; index < 8; index += 1) {
      await expect(
        manager.open(1, { documentId: indexedDocumentId(index), serverId: target.id }),
      ).resolves.toMatchObject({ ok: true, result: { status: "created" } })
    }
    await expect(
      manager.open(1, { documentId: indexedDocumentId(8), serverId: target.id }),
    ).resolves.toMatchObject({
      error: { code: "window_limit" },
      ok: false,
    })

    const first = mocks.windows[0]!
    first.listeners.get("closed")?.()
    expect(collaboration.closeOwner).toHaveBeenCalledWith(first.webContents.id)
    await expect(
      manager.open(1, { documentId: indexedDocumentId(8), serverId: target.id }),
    ).resolves.toMatchObject({ ok: true, result: { status: "created" } })
  })

  it("拒绝非法参数、未登录和与当前主窗口不匹配的服务器", async () => {
    const serverProfiles = {
      require: vi.fn((serverId: string) => {
        if (serverId === "missing") throw new Error("missing")
        return { ...target, id: serverId }
      }),
    }
    const manager = createManager(createMainWindow(), undefined, serverProfiles)
    await expect(
      manager.open(1, { documentId: "invalid", serverId: target.id }),
    ).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    })
    await expect(manager.open(1, { documentId, serverId: "missing" })).resolves.toMatchObject({
      error: { code: "server_not_found" },
      ok: false,
    })
    await expect(manager.open(1, { documentId, serverId: "server-2" })).resolves.toMatchObject({
      error: { code: "target_mismatch" },
      ok: false,
    })

    const profiles = {
      require: vi.fn(() => ({ ...target, lastUserId: undefined })),
    }
    await expect(
      createManager(createMainWindow(), undefined, profiles).open(1, {
        documentId,
        serverId: target.id,
      }),
    ).resolves.toMatchObject({ error: { code: "not_authenticated" }, ok: false })
  })

  it("Renderer 崩溃和 dispose 都会幂等清理 owner 与索引", async () => {
    const mainWindow = createMainWindow()
    const collaboration = { closeOwner: vi.fn(), closeServer: vi.fn(), closeTarget: vi.fn() }
    const manager = createManager(mainWindow, collaboration)
    await manager.open(1, { documentId, serverId: target.id })
    const child = mocks.windows[0]!
    child.webContentsListeners.get("render-process-gone")?.({}, { reason: "crashed" })
    expect(manager.size()).toBe(0)
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(collaboration.closeOwner).toHaveBeenCalledWith(child.webContents.id)
    expect(collaboration.closeOwner).toHaveBeenCalledTimes(1)
    manager.dispose()
    manager.dispose()
    expect(manager.size()).toBe(0)
  })

  it("关闭未同步文档时取消保留窗口，确认放弃后允许关闭", async () => {
    const mainWindow = createMainWindow()
    const manager = createManager(mainWindow)
    await manager.open(1, { documentId, serverId: target.id })
    const child = mocks.windows[0]!
    const listener = child.webContentsListeners.get("will-prevent-unload")
    mocks.showMessageBox
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 1 })

    const cancelEvent = { preventDefault: vi.fn() }
    listener?.(cancelEvent)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancelEvent.preventDefault).not.toHaveBeenCalled()
    expect(child.destroy).not.toHaveBeenCalled()
    expect(manager.size()).toBe(1)

    const confirmEvent = { preventDefault: vi.fn() }
    listener?.(confirmEvent)
    await vi.waitFor(() => expect(child.destroy).toHaveBeenCalledOnce())
    expect(confirmEvent.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2)
    expect(manager.size()).toBe(0)
  })

  it("账号切换后旧文档 owner 不能借用新用户 Target 开新窗口", async () => {
    const mainWindow = createMainWindow() as unknown as {
      webContents: { id: number }
    }
    const profile = { ...target }
    const manager = createManager(mainWindow, undefined, { require: vi.fn(() => profile) })
    await manager.open(mainWindow.webContents.id, { documentId, serverId: target.id })
    const child = mocks.windows[0]!
    profile.lastUserId = "user-2"

    await expect(
      manager.open(child.webContents.id, {
        documentId: indexedDocumentId(99),
        serverId: target.id,
      }),
    ).resolves.toMatchObject({ error: { code: "target_mismatch" }, ok: false })
  })

  it("注销或移除服务器时只关闭匹配认证目标的窗口", async () => {
    const manager = createManager(createMainWindow())
    await manager.open(1, { documentId, serverId: target.id })
    const other = {
      id: "server-2",
      lastUserId: "user-2",
      normalizedUrl: "https://other.example.com",
    }
    const profiles = { require: vi.fn(() => other) }
    const otherManager = createManager(createMainWindow(), undefined, profiles, other.id)
    await otherManager.open(1, { documentId, serverId: other.id })

    manager.closeTarget({ id: target.id, normalizedUrl: target.normalizedUrl, userId: "user-1" })
    expect(manager.size()).toBe(0)
    expect(otherManager.size()).toBe(1)
    otherManager.closeServer(other.id)
    expect(otherManager.size()).toBe(0)
  })

  it("主文档路由加载失败时移除索引并进入恢复页", async () => {
    const manager = createManager(createMainWindow())
    await manager.open(1, { documentId, serverId: target.id })
    const child = mocks.windows[0]!
    child.webContentsListeners.get("did-fail-load")?.({}, -2, "failed", "", true)

    expect(manager.size()).toBe(0)
    expect(child.loadURL).toHaveBeenLastCalledWith("magicchat-app://app/recovery.html")
  })

  it("首屏加载失败时返回稳定错误，并将窗口置于恢复页", async () => {
    const manager = createManager(createMainWindow())
    mocks.rejectNextLoad()

    await expect(manager.open(1, { documentId, serverId: target.id })).resolves.toMatchObject({
      error: { code: "load_failed" },
      ok: false,
    })
    expect(manager.size()).toBe(0)
    expect(mocks.windows[0]?.loadURL).toHaveBeenLastCalledWith("magicchat-app://app/recovery.html")
  })
})

function createManager(
  mainWindow: unknown,
  collaboration: unknown = { closeOwner: vi.fn(), closeServer: vi.fn(), closeTarget: vi.fn() },
  profiles: unknown = { require: vi.fn(() => ({ ...target })) },
  selectedServerId = target.id,
  developmentUrl?: string,
) {
  return new DocumentWindowManager({
    collaboration: collaboration as DocumentWindowManagerDependencies["collaboration"],
    diagnostics: { record: vi.fn() },
    developmentUrl,
    getMainWindow: () => mainWindow as never,
    iconPath: "/app/logo.png",
    preloadPath: "/app/preload.cjs",
    profiles: profiles as DocumentWindowManagerDependencies["profiles"],
    state: {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    store: {
      getSettings: vi.fn(() => ({ selectedServerId })),
    } as unknown as DocumentWindowManagerDependencies["store"],
  })
}

function createMainWindow() {
  return {
    getBounds: vi.fn(() => ({ height: 820, width: 1280, x: 0, y: 0 })),
    isDestroyed: vi.fn(() => false),
    webContents: { id: 1 },
  } as never
}

function indexedDocumentId(index: number): string {
  return `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`
}
