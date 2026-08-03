// @vitest-environment node
import { readFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { IPC } from "@shared/bridge"

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    appOn: vi.fn(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    handlers,
    ipcOn: vi.fn(),
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

const root = path.resolve(import.meta.dirname, "..")

describe("权限设置 Bridge 安全边界", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.handlers.clear()
  })

  it("Shared、Preload 和 Main 只暴露固定权限设置操作", async () => {
    const [bridge, preload, mainIpc] = await Promise.all([
      readFile(path.join(root, "src/shared/bridge.ts"), "utf8"),
      readFile(path.join(root, "src/preload/index.ts"), "utf8"),
      readFile(path.join(root, "src/main/ipc.ts"), "utf8"),
    ])

    expect(bridge).toContain("permissionsOpenSettings")
    expect(preload).toContain("IPC.permissionsOpenSettings")
    expect(mainIpc).toContain("IPC.permissionsOpenSettings")
    expect(bridge).toContain('openSettings(kind: "screen")')
    expect(mainIpc).toContain('if (kind !== "screen")')
    expect(preload).not.toContain("x-apple.systempreferences")
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
