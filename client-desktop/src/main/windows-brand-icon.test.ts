import { readFile } from "node:fs/promises"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConfigStore } from "@main/config-store"
import type { Diagnostics } from "@main/diagnostics"

const electronMocks = vi.hoisted(() => {
  const window = {
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(),
    on: vi.fn(),
    removeMenu: vi.fn(),
    webContents: {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    },
  }

  return {
    browserWindow: vi.fn(function BrowserWindowMock() {
      return window
    }),
    window,
  }
})

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
  },
  BrowserWindow: electronMocks.browserWindow,
  shell: {
    openExternal: vi.fn(),
  },
}))

import { WindowController } from "@main/window-controller"

describe("Windows 品牌图标", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("创建主窗口时使用统一的运行时图标", () => {
    const iconPath = "C:\\MagicChat\\resources\\logo.png"
    const controller = new WindowController(
      { getSettings: vi.fn() } as unknown as ConfigStore,
      { record: vi.fn() } as unknown as Diagnostics,
      "C:\\MagicChat\\preload.cjs",
      iconPath,
    )

    controller.create()

    expect(electronMocks.browserWindow).toHaveBeenCalledWith(
      expect.objectContaining({ icon: iconPath }),
    )
    expect(electronMocks.window.removeMenu).toHaveBeenCalledOnce()
  })

  it("允许 electron-builder 将品牌图标写入 Windows 可执行文件", async () => {
    const builderConfig = normalizeNewlines(
      await readFile(path.resolve(import.meta.dirname, "../../electron-builder.yml"), "utf8"),
    )

    expect(builderConfig).toContain("win:\n  icon: public/logo.png")
    expect(builderConfig).toContain("signAndEditExecutable: true")
  })

  it("所有独立窗口都显式使用同一个品牌图标", async () => {
    const windowSources = await Promise.all(
      ["window-controller.ts", "auth-controller.ts", "proxy-auth.ts"].map((fileName) =>
        readFile(path.resolve(import.meta.dirname, fileName), "utf8"),
      ),
    )

    for (const source of windowSources) {
      expect(source).toContain("icon: this.iconPath")
    }
  })
})

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n")
}
