import type { IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerWindowControlIpc, type WindowControlIpcRegister } from "@main/window-controls-ipc"
import { IPC } from "@shared/bridge"

const electronMocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
}))

vi.mock("electron", () => ({
  BrowserWindow: {
    fromWebContents: electronMocks.fromWebContents,
  },
}))

describe("窗口控制 IPC", () => {
  const event = { sender: {} } as IpcMainInvokeEvent
  const handlers = new Map<string, Parameters<WindowControlIpcRegister>[1]>()

  beforeEach(() => {
    handlers.clear()
    electronMocks.fromWebContents.mockReset()
    registerWindowControlIpc((channel, handler) => handlers.set(channel, handler))
  })

  it("控制发送请求的窗口", () => {
    const window = createWindow()
    electronMocks.fromWebContents.mockReturnValue(window)

    handlers.get(IPC.windowClose)?.(event)
    handlers.get(IPC.windowMinimize)?.(event)

    expect(electronMocks.fromWebContents).toHaveBeenCalledWith(event.sender)
    expect(window.close).toHaveBeenCalledOnce()
    expect(window.minimize).toHaveBeenCalledOnce()
  })

  it("根据当前状态最大化或还原窗口", () => {
    const window = createWindow()
    window.isMaximized.mockReturnValueOnce(false).mockReturnValueOnce(true)
    electronMocks.fromWebContents.mockReturnValue(window)
    const toggle = handlers.get(IPC.windowToggleMaximize)

    toggle?.(event)
    toggle?.(event)

    expect(window.maximize).toHaveBeenCalledOnce()
    expect(window.unmaximize).toHaveBeenCalledOnce()
  })

  it("拒绝不存在或已经销毁的窗口", () => {
    const close = handlers.get(IPC.windowClose)
    electronMocks.fromWebContents.mockReturnValueOnce(null)
    expect(() => close?.(event)).toThrow("窗口不可用")

    electronMocks.fromWebContents.mockReturnValueOnce(createWindow(true))
    expect(() => close?.(event)).toThrow("窗口不可用")
  })
})

function createWindow(destroyed = false) {
  return {
    close: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    isMaximized: vi.fn(() => false),
    maximize: vi.fn(),
    minimize: vi.fn(),
    unmaximize: vi.fn(),
  }
}
