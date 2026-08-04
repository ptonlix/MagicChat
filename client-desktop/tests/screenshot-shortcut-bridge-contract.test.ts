// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC, type DesktopBridge } from "@shared/bridge"
import type { ScreenshotStartFailure } from "@shared/screenshot-contract"

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
import { ScreenshotShortcutManager, SCREENSHOT_SHORTCUT } from "@main/screenshot-shortcut"
import "@preload/index"

describe("全局截图快捷键错误提示契约", () => {
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

  it("Preload 订阅固定事件并暴露快捷键配置方法", () => {
    const desktop = electronMocks.exposed.get("desktop") as DesktopBridge | undefined
    const listener = vi.fn()

    const unsubscribe = desktop?.screenshot.subscribeStartFailed(listener)
    const ipcListener = electronMocks.rendererListeners.get(IPC.screenshotStartFailed)
    if (!ipcListener) throw new Error("截图启动失败事件未订阅")
    const failure: ScreenshotStartFailure = { code: "permission_denied" }
    ipcListener({}, failure)

    expect(listener).toHaveBeenCalledWith(failure)
    unsubscribe?.()
    expect(electronMocks.rendererRemoveListener).toHaveBeenCalledWith(
      IPC.screenshotStartFailed,
      ipcListener,
    )

    void desktop?.shortcuts.getState()
    void desktop?.shortcuts.beginRecording()
    void desktop?.shortcuts.cancelRecording()
    void desktop?.shortcuts.setScreenshot("Control+Alt+S")
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutsGetState)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutRecordingBegin)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutRecordingCancel)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.shortcutScreenshotSet, "Control+Alt+S")
  })

  it("Main 注册快捷键并把启动错误发送给 Renderer", async () => {
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

  it("录制时暂停快捷键并在取消后恢复", () => {
    const { manager } = createManager()
    manager.start()

    expect(manager.beginRecording(7)).toMatchObject({ recording: true, registered: false })
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SCREENSHOT_SHORTCUT)
    expect(manager.cancelRecording(7)).toMatchObject({ recording: false, registered: true })
  })

  it("成功修改后持久化新组合并注销旧组合", async () => {
    const { manager, store } = createManager()
    manager.start()

    const result = await manager.setScreenshot(7, "Alt+Control+s")

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
    manager.beginRecording(7)
    electronMocks.registerShortcut.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const result = await manager.setScreenshot(7, "Control+Alt+S")

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
    manager.beginRecording(7)
    electronMocks.registerShortcut.mockReturnValueOnce(false).mockReturnValueOnce(false)

    const result = await manager.setScreenshot(7, "Control+Alt+S")

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
    await manager.setScreenshot(7, null)
    expect(manager.getState()).toEqual({ accelerator: null, recording: false, registered: false })

    const second = createManager()
    second.manager.start()
    second.manager.beginRecording(8)
    second.store.setSettings.mockRejectedValueOnce(new Error("persist failed"))
    await expect(second.manager.setScreenshot(8, "Control+Alt+S")).resolves.toMatchObject({
      status: "save_failed",
    })
    expect(second.manager.getState()).toMatchObject({
      accelerator: SCREENSHOT_SHORTCUT,
      recording: false,
      registered: true,
    })
  })

  it("持久化失败且原组合无法恢复时返回恢复失败", async () => {
    const { manager, store } = createManager()
    manager.start()
    manager.beginRecording(9)
    store.setSettings.mockRejectedValueOnce(new Error("persist failed"))
    electronMocks.registerShortcut.mockReturnValueOnce(true).mockReturnValueOnce(false)

    await expect(manager.setScreenshot(9, "Control+Alt+S")).resolves.toEqual({
      state: {
        accelerator: SCREENSHOT_SHORTCUT,
        recording: false,
        registered: false,
      },
      status: "restore_failed",
    })
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
      setScreenshot: vi.fn(),
    },
    updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    uploads: { releaseOwner: vi.fn() },
  } as unknown as IpcDependencies
}

function createManager() {
  const diagnostics = { record: vi.fn().mockResolvedValue(undefined) }
  const screenshots = { start: vi.fn().mockResolvedValue({ status: "started" }) }
  const settings = {
    autoLaunch: false,
    closeBehavior: "background" as const,
    messageSoundEnabled: true,
    notificationPrivacy: "metadata" as const,
    screenshotShortcut: SCREENSHOT_SHORTCUT,
  }
  const store = {
    getSettings: vi.fn(() => settings),
    setSettings: vi.fn().mockResolvedValue(settings),
  }
  const windows = { send: vi.fn(), show: vi.fn() }
  return {
    manager: new ScreenshotShortcutManager({ diagnostics, screenshots, store, windows }),
    screenshots,
    store,
    windows,
  }
}
