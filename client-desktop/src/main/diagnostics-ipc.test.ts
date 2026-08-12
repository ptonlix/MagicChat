import type { IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Diagnostics } from "@main/diagnostics"
import { registerDiagnosticsIpc } from "@main/diagnostics-ipc"
import { IPC } from "@shared/bridge"
import type { DiagnosticEvent, DiagnosticStorageStats } from "@shared/diagnostics-contract"

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  isPackaged: true,
  removeHandler: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronMocks.isPackaged
    },
  },
  ipcMain: { handle: electronMocks.handle, removeHandler: electronMocks.removeHandler },
}))

describe("registerDiagnosticsIpc", () => {
  beforeEach(() => {
    electronMocks.handle.mockReset()
    electronMocks.isPackaged = true
    electronMocks.removeHandler.mockReset()
  })

  it("只向可信 Renderer 暴露受控的诊断事件与存储数据", async () => {
    const recorded: DiagnosticEvent = {
      context: {
        connectionInstanceId: "connection-1",
        episodeId: "episode-1",
        targetScope: "server-1",
      },
      data: { ready: false, status: "connected" },
      eventSeq: 42,
      origin: "renderer",
      timestamp: "2025-01-01T00:00:00.000Z",
      type: "realtime.state-changed",
    }
    const recordEvent = vi.fn().mockResolvedValue(recorded)
    const storageStats: DiagnosticStorageStats = { bytes: 512, status: "available" }
    const getStorageStats = vi.fn().mockResolvedValue(storageStats)
    const clearStorage = vi.fn().mockResolvedValue({ bytes: 0, status: "available" })
    const unregister = registerDiagnosticsIpc({
      clearStorage,
      getStorageStats,
      recordEvent,
    } as unknown as Diagnostics)
    const recordHandler = electronMocks.handle.mock.calls[0][1] as (
      event: IpcMainInvokeEvent,
      value: unknown,
    ) => Promise<DiagnosticEvent | undefined>
    const storageStatsHandler = electronMocks.handle.mock.calls[1][1] as (
      event: IpcMainInvokeEvent,
    ) => Promise<DiagnosticStorageStats>
    const storageClearHandler = electronMocks.handle.mock.calls[2][1] as (
      event: IpcMainInvokeEvent,
    ) => Promise<DiagnosticStorageStats>

    await expect(
      recordHandler(ipcEvent("magicchat-app://app/index.html"), {
        context: {
          connectionInstanceId: "connection-1",
          episodeId: "episode-1",
          targetScope: "server-1",
        },
        data: { ready: false, status: "connected" },
        origin: "renderer",
        type: "realtime.state-changed",
      }),
    ).resolves.toEqual(recorded)
    expect(recordEvent).toHaveBeenCalledWith({
      context: {
        connectionInstanceId: "connection-1",
        episodeId: "episode-1",
        targetScope: "server-1",
      },
      data: { ready: false, status: "connected" },
      origin: "renderer",
      type: "realtime.state-changed",
    })
    await expect(storageStatsHandler(ipcEvent("magicchat-app://app/index.html"))).resolves.toEqual(
      storageStats,
    )
    await expect(storageClearHandler(ipcEvent("magicchat-app://app/index.html"))).resolves.toEqual({
      bytes: 0,
      status: "available",
    })
    expect(getStorageStats).toHaveBeenCalledOnce()
    expect(clearStorage).toHaveBeenCalledOnce()

    unregister()
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(IPC.diagnosticsEvent)
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(IPC.diagnosticsStorageGetStats)
    expect(electronMocks.removeHandler).toHaveBeenCalledWith(IPC.diagnosticsStorageClear)
  })

  it("拒绝不可信发送方、非 Renderer origin 和非法输入", async () => {
    const recordEvent = vi.fn()
    registerDiagnosticsIpc({ recordEvent } as unknown as Diagnostics)
    const handler = electronMocks.handle.mock.calls[0][1] as (
      event: IpcMainInvokeEvent,
      value: unknown,
    ) => Promise<DiagnosticEvent | undefined>
    const storageStatsHandler = electronMocks.handle.mock.calls[1][1] as (
      event: IpcMainInvokeEvent,
    ) => Promise<DiagnosticStorageStats>

    await expect(
      handler(ipcEvent("https://evil.example/"), {
        origin: "renderer",
        type: "realtime.state-changed",
      }),
    ).rejects.toThrow("IPC 调用来源不受信任")
    await expect(
      handler(ipcEvent("magicchat-app://app/index.html"), {
        origin: "main",
        type: "realtime.state-changed",
      }),
    ).rejects.toThrow("诊断事件字段无效")
    await expect(
      handler(ipcEvent("magicchat-app://app/index.html"), {
        origin: "renderer",
        type: "unbounded-user-input",
      }),
    ).rejects.toThrow("诊断事件字段无效")
    await expect(storageStatsHandler(ipcEvent("https://evil.example/"))).rejects.toThrow(
      "IPC 调用来源不受信任",
    )
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it("限制单个 Renderer 等待写入的诊断事件数，并在写入结束后释放容量", async () => {
    let resolveRecord: ((value: DiagnosticEvent | undefined) => void) | undefined
    const pendingRecord = new Promise<DiagnosticEvent | undefined>((resolve) => {
      resolveRecord = resolve
    })
    const recordEvent = vi.fn().mockReturnValue(pendingRecord)
    registerDiagnosticsIpc({ recordEvent } as unknown as Diagnostics)
    const handler = electronMocks.handle.mock.calls[0][1] as (
      event: IpcMainInvokeEvent,
      value: unknown,
    ) => Promise<DiagnosticEvent | undefined>
    const event = {
      sender: { id: 7 },
      senderFrame: { url: "magicchat-app://app/index.html" },
    } as IpcMainInvokeEvent
    const diagnosticEvent = {
      data: { navigatorOnline: true },
      origin: "renderer",
      type: "environment.network-changed",
    }

    const attempts = Array.from({ length: 33 }, () => handler(event, diagnosticEvent))
    expect(recordEvent).toHaveBeenCalledTimes(32)

    resolveRecord?.(undefined)
    await Promise.all(attempts)
    await handler(event, diagnosticEvent)

    expect(recordEvent).toHaveBeenCalledTimes(33)
  })
})

function ipcEvent(url: string): IpcMainInvokeEvent {
  return { sender: { id: 1 }, senderFrame: { url } } as IpcMainInvokeEvent
}
