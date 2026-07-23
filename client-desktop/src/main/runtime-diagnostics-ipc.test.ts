import type { IpcMainEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { IPC } from "@shared/bridge"
import type { Diagnostics } from "@main/diagnostics"
import { registerRuntimeDiagnosticsIpc } from "@main/runtime-diagnostics-ipc"

const electronMocks = vi.hoisted(() => ({
  isPackaged: true,
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock("electron", () => ({
  app: { get isPackaged() { return electronMocks.isPackaged } },
  ipcMain: { on: electronMocks.on, removeListener: electronMocks.removeListener },
}))

const snapshot = {
  activeRefreshes: 0,
  activeRequests: 0,
  data: { contacts: 0, conversations: 0, loadedConversations: 0, messages: 0, projects: 0 },
  eventLoopLagMs: 0,
  longTasks: { count: 0, maxDurationMs: 0 },
  page: "chat",
}

describe("registerRuntimeDiagnosticsIpc", () => {
  beforeEach(() => {
    electronMocks.isPackaged = true
    electronMocks.on.mockReset()
    electronMocks.removeListener.mockReset()
  })

  it("拒绝非受信来源并在注销时移除同一个监听器", () => {
    const updateRuntimeSnapshot = vi.fn()
    const unregister = registerRuntimeDiagnosticsIpc({ updateRuntimeSnapshot } as unknown as Diagnostics)
    const listener = electronMocks.on.mock.calls[0][1] as (event: IpcMainEvent, value: unknown) => void

    listener({ senderFrame: { url: "https://evil.example/" } } as unknown as IpcMainEvent, snapshot)
    expect(updateRuntimeSnapshot).not.toHaveBeenCalled()

    listener({ senderFrame: { url: "magicchat-app://app/index.html" } } as unknown as IpcMainEvent, snapshot)
    expect(updateRuntimeSnapshot).toHaveBeenCalledOnce()

    unregister()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(IPC.diagnosticsRuntime, listener)
  })

  it("开发模式只接受本机 Renderer", () => {
    electronMocks.isPackaged = false
    const updateRuntimeSnapshot = vi.fn()
    registerRuntimeDiagnosticsIpc({ updateRuntimeSnapshot } as unknown as Diagnostics)
    const listener = electronMocks.on.mock.calls[0][1] as (event: IpcMainEvent, value: unknown) => void

    listener({ senderFrame: { url: "http://localhost:20050/" } } as unknown as IpcMainEvent, snapshot)
    listener({ senderFrame: { url: "http://192.168.1.2:20050/" } } as unknown as IpcMainEvent, snapshot)

    expect(updateRuntimeSnapshot).toHaveBeenCalledOnce()
  })
})
