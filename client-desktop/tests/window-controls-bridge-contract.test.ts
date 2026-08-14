// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC, type DesktopBridge } from "@shared/bridge"

const electronMocks = vi.hoisted(() => {
  const exposed = new Map<string, unknown>()
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    appOn: vi.fn(),
    exposed,
    exposeInMainWorld: vi.fn((name: string, value: unknown) => exposed.set(name, value)),
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(() => []),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    handlers,
    invoke: vi.fn(),
    ipcOn: vi.fn(),
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
    rendererOn: vi.fn(),
    rendererRemoveListener: vi.fn(),
    rendererSend: vi.fn(),
  }
})

vi.mock("electron", () => ({
  app: {
    getVersion: vi.fn(() => "0.1.0"),
    isPackaged: true,
    on: electronMocks.appOn,
  },
  BrowserWindow: {
    fromWebContents: electronMocks.fromWebContents,
    getAllWindows: electronMocks.getAllWindows,
  },
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

describe("窗口控制 Bridge 安全边界", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  it("Preload 只暴露固定的当前窗口控制操作", async () => {
    const desktop = electronMocks.exposed.get("desktop") as DesktopBridge | undefined

    expect(Object.keys(desktop?.windowControls ?? {})).toEqual([
      "close",
      "minimize",
      "toggleMaximize",
    ])
    electronMocks.invoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
    electronMocks.invoke.mockResolvedValueOnce(true)

    await desktop?.windowControls.close()
    await desktop?.windowControls.minimize()
    await expect(desktop?.windowControls.toggleMaximize()).resolves.toBe(true)

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, IPC.windowClose)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, IPC.windowMinimize)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, IPC.windowToggleMaximize)
  })

  it("只控制可信发送方所属的窗口", async () => {
    let maximized = false
    const sender = { id: 12 }
    const window = {
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMaximized: vi.fn(() => maximized),
      maximize: vi.fn(() => {
        maximized = true
      }),
      minimize: vi.fn(),
      unmaximize: vi.fn(() => {
        maximized = false
      }),
    }
    const unsubscribeUpdater = vi.fn()
    const deps = {
      asr: { off: vi.fn(), on: vi.fn() },
      diagnostics: {},
      documentCollaboration: { off: vi.fn(), on: vi.fn() },
      realtime: { off: vi.fn(), on: vi.fn() },
      updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    } as unknown as IpcDependencies
    electronMocks.fromWebContents.mockImplementation((contents) =>
      contents === sender ? window : null,
    )
    const unregister = registerIpc(deps)
    const event = {
      sender,
      senderFrame: { url: "magicchat-app://app/index.html" },
    }
    const close = electronMocks.handlers.get(IPC.windowClose)
    const minimize = electronMocks.handlers.get(IPC.windowMinimize)
    const toggleMaximize = electronMocks.handlers.get(IPC.windowToggleMaximize)

    if (!close || !minimize || !toggleMaximize) throw new Error("窗口控制 IPC handler 未注册")

    try {
      await close(event)
      await minimize(event)
      await expect(toggleMaximize(event)).resolves.toBe(true)
      await expect(toggleMaximize(event)).resolves.toBe(false)

      expect(electronMocks.fromWebContents).toHaveBeenCalledWith(sender)
      expect(window.close).toHaveBeenCalledOnce()
      expect(window.minimize).toHaveBeenCalledOnce()
      expect(window.maximize).toHaveBeenCalledOnce()
      expect(window.unmaximize).toHaveBeenCalledOnce()
    } finally {
      unregister()
    }
  })

  it("拒绝不可信发送方和未绑定窗口的请求", async () => {
    const unsubscribeUpdater = vi.fn()
    const deps = {
      asr: { off: vi.fn(), on: vi.fn() },
      diagnostics: {},
      documentCollaboration: { off: vi.fn(), on: vi.fn() },
      realtime: { off: vi.fn(), on: vi.fn() },
      updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    } as unknown as IpcDependencies
    const unregister = registerIpc(deps)
    const close = electronMocks.handlers.get(IPC.windowClose)

    if (!close) throw new Error("关闭窗口 IPC handler 未注册")

    try {
      await expect(
        close({ sender: { id: 12 }, senderFrame: { url: "https://attacker.example" } }),
      ).rejects.toThrow("IPC 调用来源不受信任")

      electronMocks.fromWebContents.mockReturnValueOnce(null)
      await expect(
        close({ sender: { id: 12 }, senderFrame: { url: "magicchat-app://app/index.html" } }),
      ).rejects.toThrow("当前窗口不可用")
    } finally {
      unregister()
    }
  })
})
