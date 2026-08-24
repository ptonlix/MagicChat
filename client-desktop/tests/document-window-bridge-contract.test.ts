// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC, type DesktopBridge } from "@shared/bridge"
import type { DocumentWindowOpenResponse } from "@shared/document-window-contract"

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

describe("文档窗口 Bridge 安全边界", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  it("Preload 只暴露固定参数的文档窗口打开方法", async () => {
    const desktop = electronMocks.exposed.get("desktop") as DesktopBridge | undefined
    expect(desktop?.navigation.openDocumentWindow).toBeTypeOf("function")

    const response: DocumentWindowOpenResponse = {
      ok: true,
      result: { status: "created" },
    }
    electronMocks.invoke.mockResolvedValueOnce(response)

    await expect(
      desktop?.navigation.openDocumentWindow(
        "550e8400-e29b-41d4-a716-446655440000",
        "server-a",
        "markdown",
      ),
    ).resolves.toEqual(response)
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC.documentWindowOpen, {
      documentId: "550e8400-e29b-41d4-a716-446655440000",
      documentType: "markdown",
      serverId: "server-a",
    })
  })

  it("拒绝未注册窗口和不可信发送方，并返回稳定失败结构", async () => {
    const manager = {
      open: vi.fn().mockResolvedValue({ ok: true, result: { status: "created" } }),
    }
    const unsubscribeUpdater = vi.fn()
    const deps = {
      asr: { off: vi.fn(), on: vi.fn() },
      diagnostics: {},
      documentCollaboration: { off: vi.fn(), on: vi.fn() },
      documentWindows: manager,
      realtime: { off: vi.fn(), on: vi.fn() },
      updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    } as unknown as IpcDependencies
    const unregister = registerIpc(deps)
    const handler = electronMocks.handlers.get(IPC.documentWindowOpen)
    if (!handler) throw new Error("文档窗口 IPC handler 未注册")

    try {
      await expect(
        handler(
          { sender: { id: 12 }, senderFrame: { url: "https://attacker.example" } },
          {
            documentId: "550e8400-e29b-41d4-a716-446655440000",
            documentType: "document",
            serverId: "server-a",
          },
        ),
      ).rejects.toThrow("IPC 调用来源不受信任")

      const result = await handler(
        {
          sender: { id: 12 },
          senderFrame: { url: "magicchat-app://app/documents/document/test" },
        },
        {
          documentId: "550e8400-e29b-41d4-a716-446655440000",
          documentType: "document",
          serverId: "server-a",
        },
      )
      expect(result).toEqual({ ok: true, result: { status: "created" } })
      expect(manager.open).toHaveBeenCalledWith(12, {
        documentId: "550e8400-e29b-41d4-a716-446655440000",
        documentType: "document",
        serverId: "server-a",
      })
    } finally {
      unregister()
    }
  })

  it("Preload 拒绝未知状态或错误码，避免渲染进程消费未定义协议", async () => {
    const desktop = electronMocks.exposed.get("desktop") as DesktopBridge | undefined
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, result: { status: "unknown" } })
    await expect(
      desktop?.navigation.openDocumentWindow(
        "550e8400-e29b-41d4-a716-446655440000",
        "server-a",
        "document",
      ),
    ).rejects.toThrow("文档窗口结果无效")

    electronMocks.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: "unknown", message: "bad" },
    })
    await expect(
      desktop?.navigation.openDocumentWindow(
        "550e8400-e29b-41d4-a716-446655440000",
        "server-a",
        "document",
      ),
    ).rejects.toThrow("文档窗口错误无效")
  })

  it("清理用户消息缓存时同步关闭同一认证目标的文档窗口", async () => {
    const clearUser = vi.fn().mockResolvedValue(undefined)
    const closeTarget = vi.fn()
    const unsubscribeUpdater = vi.fn()
    const deps = {
      asr: { off: vi.fn(), on: vi.fn() },
      diagnostics: {},
      documentCollaboration: { off: vi.fn(), on: vi.fn() },
      documentWindows: { closeTarget },
      messageCache: { clearUser },
      realtime: { off: vi.fn(), on: vi.fn() },
      updater: { subscribe: vi.fn(() => unsubscribeUpdater) },
    } as unknown as IpcDependencies
    const unregister = registerIpc(deps)
    const handler = electronMocks.handlers.get(IPC.messageCacheClearUser)
    if (!handler) throw new Error("消息缓存 IPC handler 未注册")

    try {
      const target = { id: "server-a", normalizedUrl: "https://chat.example.com", userId: "user-1" }
      await handler({ senderFrame: { url: "magicchat-app://app/index.html" } }, target)
      expect(clearUser).toHaveBeenCalledWith(target)
      expect(closeTarget).toHaveBeenCalledWith(target)
    } finally {
      unregister()
    }
  })
})
