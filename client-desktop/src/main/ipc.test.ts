import type { IpcMainInvokeEvent } from "electron"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { registerIpc, type IpcDependencies } from "@main/ipc"
import { removeServerResources } from "@main/server-removal"
import { IPC, type ServerProfile } from "@shared/bridge"

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()

  return {
    appOn: vi.fn(),
    getAllWindows: vi.fn(() => []),
    handlers,
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  }
})

const mocks = vi.hoisted(() => ({
  removeServerResources: vi.fn(),
  registerDiagnosticsIpc: vi.fn(() => vi.fn()),
  registerRuntimeDiagnosticsIpc: vi.fn(() => vi.fn()),
}))

vi.mock("electron", () => ({
  app: { isPackaged: true, on: electronMocks.appOn },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  clipboard: { writeImage: vi.fn(), writeText: vi.fn() },
  ipcMain: {
    handle: (
      channel: string,
      handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => electronMocks.handlers.set(channel, handler),
    removeHandler: electronMocks.removeHandler,
  },
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { openExternal: vi.fn() },
  webContents: { fromId: vi.fn() },
}))

vi.mock("@main/diagnostics-ipc", () => ({
  registerDiagnosticsIpc: mocks.registerDiagnosticsIpc,
}))

vi.mock("@main/runtime-diagnostics-ipc", () => ({
  registerRuntimeDiagnosticsIpc: mocks.registerRuntimeDiagnosticsIpc,
}))

vi.mock("@main/server-removal", () => ({
  removeServerResources: mocks.removeServerResources,
}))

const profile: ServerProfile = {
  createdAt: "2026-08-14T00:00:00.000Z",
  displayName: "测试服务器",
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
}

describe("服务器移除 IPC", () => {
  beforeEach(() => {
    electronMocks.appOn.mockReset()
    electronMocks.getAllWindows.mockReset().mockReturnValue([])
    electronMocks.handlers.clear()
    electronMocks.removeHandler.mockClear()
    mocks.removeServerResources.mockReset()
    mocks.registerDiagnosticsIpc.mockClear()
    mocks.registerRuntimeDiagnosticsIpc.mockClear()
  })

  it.each([true, false])("将移除结果 %s 返回给 Renderer", async (removed) => {
    mocks.removeServerResources.mockResolvedValueOnce(removed)
    const deps = createDependencies()
    const unregister = registerIpc(deps)
    const handler = electronMocks.handlers.get(IPC.serversRemove)

    if (!handler) throw new Error("服务器移除 IPC 未注册")
    await expect(handler(trustedEvent(), profile.id)).resolves.toBe(removed)
    expect(deps.profiles.require).toHaveBeenCalledWith(profile.id)
    expect(removeServerResources).toHaveBeenCalledWith(deps, profile.id, profile)

    unregister()
  })
})

function createDependencies() {
  return {
    asr: { off: vi.fn(), on: vi.fn() },
    diagnostics: { recordEvent: vi.fn() },
    documentCollaboration: { off: vi.fn(), on: vi.fn() },
    profiles: { require: vi.fn().mockReturnValue(profile) },
    realtime: { off: vi.fn(), on: vi.fn() },
    updater: { subscribe: vi.fn(() => vi.fn()) },
  } as unknown as IpcDependencies
}

function trustedEvent(): IpcMainInvokeEvent {
  return { senderFrame: { url: "magicchat-app://app/index.html" } } as IpcMainInvokeEvent
}
