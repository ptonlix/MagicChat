// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC, type DesktopBridge } from "@shared/bridge"

const electronMocks = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const rendererListeners = new Map<string, (...args: unknown[]) => void>()
  const shortcutCallbacks = new Map<string, () => void>()
  return {
    appOn: vi.fn(),
    exposeInMainWorld: vi.fn((name: string, value: unknown) => exposed.set(name, value)),
    exposed,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    handlers,
    invoke: vi.fn(),
    registerShortcut: vi.fn((shortcut: string, callback: () => void) => {
      shortcutCallbacks.set(shortcut, callback)
      return true
    }),
    rendererListeners,
    rendererOn: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
      rendererListeners.set(channel, listener)
    }),
    rendererRemoveListener: vi.fn(),
    rendererSend: vi.fn(),
    ipcOn: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
    shortcutCallbacks,
    unregisterShortcut: vi.fn((shortcut: string) => shortcutCallbacks.delete(shortcut)),
  }
})

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.1.0"),
    isPackaged: true,
    on: electronMocks.appOn,
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  clipboard: {},
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  globalShortcut: {
    register: electronMocks.registerShortcut,
    unregister: electronMocks.unregisterShortcut,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.rendererOn,
    removeListener: electronMocks.rendererRemoveListener,
    send: electronMocks.rendererSend,
  },
  ipcMain: {
    handle: electronMocks.handle,
    on: electronMocks.ipcOn,
    removeHandler: electronMocks.removeHandler,
    removeListener: electronMocks.removeListener,
  },
  nativeImage: {},
  shell: {},
  webContents: { fromId: vi.fn() },
}))

import { registerIpc, type IpcDependencies } from "@main/ipc"
import {
  SCREENSHOT_SHORTCUT,
  SEARCH_SHORTCUT,
  SEND_MESSAGE_SHORTCUT,
  ShortcutManager,
} from "@main/shortcut-manager"
import "@preload/index"

describe("全局快捷键桥接契约", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.rendererListeners.clear()
    electronMocks.handlers.clear()
    electronMocks.shortcutCallbacks.clear()
    electronMocks.registerShortcut.mockImplementation((shortcut, callback) => {
      electronMocks.shortcutCallbacks.set(shortcut, callback)
      return true
    })
  })

  it("Preload 订阅搜索事件并暴露快捷键配置方法", () => {
    const desktop = electronMocks.exposed.get("desktop") as DesktopBridge | undefined
    const listener = vi.fn()

    const unsubscribe = desktop?.shortcuts.subscribeSearchOpen(listener)
    const ipcListener = electronMocks.rendererListeners.get(IPC.searchOpen)
    if (!ipcListener) throw new Error("搜索打开事件未订阅")
    ipcListener({})

    expect(listener).toHaveBeenCalledOnce()
    unsubscribe?.()
    expect(electronMocks.rendererRemoveListener).toHaveBeenCalledWith(IPC.searchOpen, ipcListener)

    void desktop?.shortcuts.getState("screenshot")
    void desktop?.shortcuts.beginRecording("search")
    void desktop?.shortcuts.cancelRecording()
    void desktop?.shortcuts.set("screenshot", "Control+Alt+S")
    void desktop?.shortcuts.set("search", "Control+Shift+F")
    void desktop?.shortcuts.set("sendMessage", "Control+Enter")
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutsGetState, "screenshot")
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutRecordingBegin, "search")
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutRecordingCancel)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutScreenshotSet, "Control+Alt+S")
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutSearchSet, "Control+Shift+F")
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutSendMessageSet, "Control+Enter")
  })

  it("Main 注册截图快捷键并把启动错误发送给 Renderer", async () => {
    const { manager, screenshots, windows } = createManager()
    screenshots.start.mockResolvedValue({ code: "permission_denied", status: "error" })
    manager.start()
    electronMocks.shortcutCallbacks.get(SCREENSHOT_SHORTCUT)?.()

    await vi.waitFor(() =>
      expect(windows.send).toHaveBeenCalledWith(IPC.screenshotStartFailed, {
        code: "permission_denied",
      }),
    )
    expect(windows.show).toHaveBeenCalledOnce()

    manager.dispose()
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SCREENSHOT_SHORTCUT)
  })

  it("全局搜索快捷键唤起窗口并打开搜索", () => {
    const { manager, windows } = createManager()
    manager.start()

    electronMocks.shortcutCallbacks.get(SEARCH_SHORTCUT)?.()

    expect(windows.show).toHaveBeenCalledOnce()
    expect(windows.send).toHaveBeenCalledWith(IPC.searchOpen)

    manager.dispose()
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SEARCH_SHORTCUT)
  })

  it("录制时暂停快捷键并在取消后恢复", () => {
    const { manager } = createManager()
    manager.start()

    expect(manager.beginRecording(7, "screenshot")).toMatchObject({
      recording: true,
      registered: false,
    })
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SCREENSHOT_SHORTCUT)
    expect(manager.cancelRecording(7)).toMatchObject({ recording: false, registered: true })
  })

  it("成功修改后持久化新组合并注销旧组合", async () => {
    const { manager, store } = createManager()
    manager.start()

    const result = await manager.set("screenshot", 7, "Alt+Control+s")

    expect(result).toEqual({
      state: { accelerator: "Control+Alt+S", recording: false, registered: true },
      status: "updated",
    })
    expect(store.setSettings).toHaveBeenCalledWith({ screenshotShortcut: "Control+Alt+S" })
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SCREENSHOT_SHORTCUT)
  })

  it("候选组合冲突时恢复录制前快捷键", async () => {
    const { manager, store } = createManager()
    manager.start()
    manager.beginRecording(7, "screenshot")
    electronMocks.registerShortcut.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const result = await manager.set("screenshot", 7, "Control+Alt+S")

    expect(result.status).toBe("conflict")
    expect(result.state).toEqual({
      accelerator: SCREENSHOT_SHORTCUT,
      recording: false,
      registered: true,
    })
    expect(store.setSettings).not.toHaveBeenCalled()
  })

  it("候选和原组合都无法注册时返回恢复失败", async () => {
    const { manager } = createManager()
    manager.start()
    manager.beginRecording(7, "screenshot")
    electronMocks.registerShortcut.mockReturnValueOnce(false).mockReturnValueOnce(false)

    const result = await manager.set("screenshot", 7, "Control+Alt+S")

    expect(result).toEqual({
      state: {
        accelerator: SCREENSHOT_SHORTCUT,
        recording: false,
        registered: false,
      },
      status: "restore_failed",
    })
  })

  it("支持禁用并在保存失败时恢复原快捷键", async () => {
    const { manager } = createManager()
    manager.start()
    await manager.set("screenshot", 7, null)
    expect(manager.getState("screenshot")).toEqual({
      accelerator: null,
      recording: false,
      registered: false,
    })

    const second = createManager()
    second.manager.start()
    second.manager.beginRecording(8, "screenshot")
    second.store.setSettings.mockRejectedValueOnce(new Error("persist failed"))
    await expect(second.manager.set("screenshot", 8, "Control+Alt+S")).resolves.toMatchObject({
      status: "save_failed",
    })
    expect(second.manager.getState("screenshot")).toMatchObject({
      accelerator: SCREENSHOT_SHORTCUT,
      recording: false,
      registered: true,
    })
  })

  it("持久化失败且原组合无法恢复时返回恢复失败", async () => {
    const { manager, store } = createManager()
    manager.start()
    manager.beginRecording(9, "screenshot")
    store.setSettings.mockRejectedValueOnce(new Error("persist failed"))
    electronMocks.registerShortcut.mockReturnValueOnce(true).mockReturnValueOnce(false)

    await expect(manager.set("screenshot", 9, "Control+Alt+S")).resolves.toEqual({
      state: {
        accelerator: SCREENSHOT_SHORTCUT,
        recording: false,
        registered: false,
      },
      status: "restore_failed",
    })
  })

  it("发送消息快捷键只持久化且不注册全局", async () => {
    const { manager, store } = createManager()
    manager.start()
    await expect(manager.set("sendMessage", 7, "Control+K")).rejects.toThrow(
      "发送消息快捷键不受支持",
    )
    await manager.set("sendMessage", 7, "Control+Enter")
    store.setSettings.mockClear()

    const result = await manager.set("sendMessage", 7, "Enter")

    expect(result).toEqual({
      state: { accelerator: "Enter", recording: false, registered: false },
      status: "updated",
    })
    expect(store.setSettings).toHaveBeenCalledWith({ sendMessageShortcut: "Enter" })
    expect(electronMocks.registerShortcut).not.toHaveBeenCalledWith("Enter")

    await manager.set("sendMessage", 7, null)
    expect(store.setSettings).toHaveBeenCalledWith({ sendMessageShortcut: null })
    expect(manager.getState("sendMessage").accelerator).toBeNull()
  })

  it("发送消息快捷键设置相同组合时不误报冲突", async () => {
    const { manager } = createManager()
    manager.start()
    await manager.set("sendMessage", 7, "Control+Enter")
    manager.beginRecording(7, "sendMessage")

    const result = await manager.set("sendMessage", 7, "Control+Enter")

    expect(result.status).toBe("updated")
    expect(manager.getState("sendMessage").recording).toBe(false)
  })

  it("录制一种快捷键时切换另一种会恢复前者的全局注册", () => {
    const { manager } = createManager()
    manager.start()
    manager.beginRecording(7, "search")
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SEARCH_SHORTCUT)

    manager.beginRecording(7, "sendMessage")

    expect(electronMocks.registerShortcut).toHaveBeenCalledWith(
      SEARCH_SHORTCUT,
      expect.any(Function),
    )
    expect(manager.getState("search").recording).toBe(false)
    expect(manager.getState("search").registered).toBe(true)
    expect(manager.getState("sendMessage").recording).toBe(true)

    manager.cancelRecording(7)
    expect(manager.getState("sendMessage").recording).toBe(false)
  })

  it("录制时设置另一种快捷键会恢复前者的全局注册", async () => {
    const { manager, store } = createManager()
    manager.start()
    manager.beginRecording(7, "search")

    const result = await manager.set("sendMessage", 7, "Control+Enter")

    expect(result.status).toBe("updated")
    expect(electronMocks.registerShortcut).toHaveBeenCalledWith(
      SEARCH_SHORTCUT,
      expect.any(Function),
    )
    expect(manager.getState("search").registered).toBe(true)
    expect(store.setSettings).toHaveBeenCalledWith({ sendMessageShortcut: "Control+Enter" })
  })

  it("快捷键 IPC 拒绝不可信发送方", async () => {
    const releaseOwner = vi.fn()
    const deps = createIpcDependencies({ releaseOwner })
    const unregister = registerIpc(deps)
    const handler = electronMocks.handlers.get(IPC.shortcutRecordingBegin)
    if (!handler) throw new Error("快捷键录制 IPC handler 未注册")

    try {
      await expect(
        handler({ sender: { id: 7 }, senderFrame: { url: "https://attacker.example" } }),
      ).rejects.toThrow("IPC 调用来源不受信任")
      expect(deps.shortcuts.beginRecording).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  it("Renderer 销毁时释放快捷键录制所有权", () => {
    const releaseOwner = vi.fn()
    const deps = createIpcDependencies({ releaseOwner })
    const unregister = registerIpc(deps)
    const webContentsCreated = electronMocks.appOn.mock.calls.find(
      ([event]) => event === "web-contents-created",
    )?.[1]
    if (typeof webContentsCreated !== "function") throw new Error("未注册 WebContents 生命周期")
    let destroyed: (() => void) | undefined
    const contents = {
      id: 19,
      once: vi.fn((_event: string, listener: () => void) => {
        destroyed = listener
      }),
    }

    try {
      webContentsCreated({}, contents)
      destroyed?.()
      expect(releaseOwner).toHaveBeenCalledWith(19)
    } finally {
      unregister()
    }
  })
})

function createIpcDependencies(shortcuts: { releaseOwner: ReturnType<typeof vi.fn> }) {
  const unsubscribeUpdater = vi.fn()
  return {
    asr: { closeOwner: vi.fn(), off: vi.fn(), on: vi.fn() },
    documentCollaboration: { closeOwner: vi.fn(), off: vi.fn(), on: vi.fn() },
    files: { releaseOwner: vi.fn() },
    http: { cancelOwner: vi.fn() },
    realtime: { off: vi.fn(), on: vi.fn() },
    shortcuts: {
      beginRecording: vi.fn(),
      cancelRecording: vi.fn(),
      getState: vi.fn(),
      releaseOwner: shortcuts.releaseOwner,
      set: vi.fn(),
    },
    updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    uploads: { releaseOwner: vi.fn() },
  } as unknown as IpcDependencies
}

function createManager() {
  const diagnostics = { recordEvent: vi.fn().mockResolvedValue(undefined) }
  const screenshots = { start: vi.fn().mockResolvedValue({ status: "started" }) }
  const settings = {
    autoLaunch: false,
    closeBehavior: "background" as const,
    fontScale: "normal" as const,
    language: "zh-CN" as const,
    messageNotificationsEnabled: true,
    messageSoundEnabled: true,
    notificationPrivacy: "metadata" as const,
    screenshotShortcut: SCREENSHOT_SHORTCUT,
    searchShortcut: SEARCH_SHORTCUT,
    sendMessageShortcut: SEND_MESSAGE_SHORTCUT,
  }
  const store = {
    getSettings: vi.fn(() => settings),
    setSettings: vi.fn().mockResolvedValue(settings),
  }
  const windows = { send: vi.fn(), show: vi.fn() }
  return {
    manager: new ShortcutManager({ diagnostics, screenshots, store, windows }),
    screenshots,
    store,
    windows,
  }
}
