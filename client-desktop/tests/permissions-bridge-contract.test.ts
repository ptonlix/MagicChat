// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC, type DesktopBridge } from "@shared/bridge"

const electronMocks = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    appOn: vi.fn(),
    exposeInMainWorld: vi.fn((name: string, value: unknown) => exposed.set(name, value)),
    exposed,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    handlers,
    invoke: vi.fn(),
    ipcOn: vi.fn(),
    rendererOn: vi.fn(),
    rendererRemoveListener: vi.fn(),
    rendererSend: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
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
  ipcMain: {
    handle: electronMocks.handle,
    on: electronMocks.ipcOn,
    removeHandler: electronMocks.removeHandler,
    removeListener: electronMocks.removeListener,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.rendererOn,
    removeListener: electronMocks.rendererRemoveListener,
    send: electronMocks.rendererSend,
  },
  nativeImage: {},
  shell: {},
  webContents: { fromId: vi.fn() },
}))

import { registerIpc, type IpcDependencies } from "@main/ipc"
import "@preload/index"

describe("权限设置 Bridge 安全边界", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  it("Preload 只通过固定 IPC channel 暴露权限设置操作", async () => {
    const desktop = electronMocks.exposed.get("desktop") as DesktopBridge | undefined
    expect(desktop).toBeDefined()
    expect(Object.keys(desktop?.permissions ?? {})).toEqual(["openSettings", "request"])
    electronMocks.invoke.mockResolvedValueOnce(true)

    await expect(desktop?.permissions.openSettings("screen")).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.permissionsOpenSettings, "screen")
  })

  it("拒绝不可信发送方和非法权限类型，只转发固定的屏幕权限操作", async () => {
    const openPermissionSettings = vi.fn().mockResolvedValue(true)
    const unsubscribeUpdater = vi.fn()
    const deps = {
      asr: { off: vi.fn(), on: vi.fn() },
      diagnostics: {},
      realtime: { off: vi.fn(), on: vi.fn() },
      system: { openPermissionSettings },
      updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    } as unknown as IpcDependencies
    const unregister = registerIpc(deps)
    const handler = electronMocks.handlers.get(IPC.permissionsOpenSettings)
    if (!handler) throw new Error("权限设置 IPC handler 未注册")

    try {
      await expect(
        handler({ senderFrame: { url: "https://attacker.example" } }, "screen"),
      ).rejects.toThrow("IPC 调用来源不受信任")
      await expect(
        handler({ senderFrame: { url: "magicchat-app://app/index.html" } }, "microphone"),
      ).rejects.toThrow("权限设置类型无效")
      await expect(
        handler({ senderFrame: { url: "magicchat-app://app/index.html" } }, "screen"),
      ).resolves.toBe(true)

      expect(openPermissionSettings).toHaveBeenCalledOnce()
      expect(openPermissionSettings).toHaveBeenCalledWith("screen")
    } finally {
      unregister()
    }
    expect(unsubscribeUpdater).toHaveBeenCalledOnce()
  })
})
