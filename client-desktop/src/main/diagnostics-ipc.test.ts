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
      recordHandler(
        { senderFrame: { url: "magicchat-app://app/index.html" } } as IpcMainInvokeEvent,
        {
          context: {
            connectionInstanceId: "connection-1",
            episodeId: "episode-1",
            targetScope: "server-1",
          },
          data: { ready: false, status: "connected" },
          origin: "renderer",
          type: "realtime.state-changed",
        },
      ),
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
    await expect(
      storageStatsHandler({
        senderFrame: { url: "magicchat-app://app/index.html" },
      } as IpcMainInvokeEvent),
    ).resolves.toEqual(storageStats)
    await expect(
      storageClearHandler({
        senderFrame: { url: "magicchat-app://app/index.html" },
      } as IpcMainInvokeEvent),
    ).resolves.toEqual({ bytes: 0, status: "available" })
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
      handler({ senderFrame: { url: "https://evil.example/" } } as IpcMainInvokeEvent, {
        origin: "renderer",
        type: "realtime.state-changed",
      }),
    ).rejects.toThrow("IPC 调用来源不受信任")
    await expect(
      handler({ senderFrame: { url: "magicchat-app://app/index.html" } } as IpcMainInvokeEvent, {
        origin: "main",
        type: "realtime.state-changed",
      }),
    ).rejects.toThrow("诊断事件字段无效")
    await expect(
      handler({ senderFrame: { url: "magicchat-app://app/index.html" } } as IpcMainInvokeEvent, {
        origin: "renderer",
        type: "unbounded-user-input",
      }),
    ).rejects.toThrow("诊断事件字段无效")
    await expect(
      storageStatsHandler({ senderFrame: { url: "https://evil.example/" } } as IpcMainInvokeEvent),
    ).rejects.toThrow("IPC 调用来源不受信任")
    expect(recordEvent).not.toHaveBeenCalled()
  })
})
