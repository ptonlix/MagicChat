// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC, type DesktopBridge } from "@shared/bridge"
import type { ScreenshotStartFailure } from "@shared/screenshot-contract"

const electronMocks = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  const rendererListeners = new Map<string, (...args: unknown[]) => void>()
  const shortcutCallbacks = new Map<string, () => void>()
  return {
    exposeInMainWorld: vi.fn((name: string, value: unknown) => exposed.set(name, value)),
    exposed,
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
    shortcutCallbacks,
    unregisterShortcut: vi.fn(),
  }
})

vi.mock("electron", () => ({
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
}))

import { registerScreenshotShortcut, SCREENSHOT_SHORTCUT } from "@main/screenshot-shortcut"
import "@preload/index"

describe("全局截图快捷键错误提示契约", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.rendererListeners.clear()
    electronMocks.shortcutCallbacks.clear()
  })

  it("Preload 订阅固定事件并支持取消订阅", () => {
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
  })

  it("Main 注册快捷键并把启动错误发送给 Renderer", async () => {
    const diagnostics = { record: vi.fn().mockResolvedValue(undefined) }
    const screenshots = {
      start: vi.fn().mockResolvedValue({ code: "permission_denied", status: "error" }),
    }
    const windows = { send: vi.fn(), show: vi.fn() }

    const unregister = registerScreenshotShortcut({ diagnostics, screenshots, windows })
    electronMocks.shortcutCallbacks.get(SCREENSHOT_SHORTCUT)?.()

    await vi.waitFor(() =>
      expect(windows.send).toHaveBeenCalledWith(IPC.screenshotStartFailed, {
        code: "permission_denied",
      }),
    )
    expect(windows.show).toHaveBeenCalledOnce()

    unregister()
    expect(electronMocks.unregisterShortcut).toHaveBeenCalledWith(SCREENSHOT_SHORTCUT)
  })

  it("截图启动异常时发送稳定错误码", async () => {
    const screenshots = { start: vi.fn().mockRejectedValue(new Error("capture failed")) }
    const windows = { send: vi.fn(), show: vi.fn() }

    registerScreenshotShortcut({
      diagnostics: { record: vi.fn().mockResolvedValue(undefined) },
      screenshots,
      windows,
    })
    electronMocks.shortcutCallbacks.get(SCREENSHOT_SHORTCUT)?.()

    await vi.waitFor(() =>
      expect(windows.send).toHaveBeenCalledWith(IPC.screenshotStartFailed, {
        code: "capture_failed",
      }),
    )
    expect(windows.show).toHaveBeenCalledOnce()
  })
})
