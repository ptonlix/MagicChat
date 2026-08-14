import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConfigStore } from "@main/config-store"
import type { Diagnostics } from "@main/diagnostics"

const electronMocks = vi.hoisted(() => {
  const webContentsListeners = new Map<string, (...args: unknown[]) => void>()
  const window = {
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn(),
    on: vi.fn(),
    removeMenu: vi.fn(),
    webContents: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        webContentsListeners.set(event, listener)
      }),
      setWindowOpenHandler: vi.fn(),
    },
  }

  return {
    browserWindow: vi.fn(function BrowserWindowMock() {
      return window
    }),
    webContentsListeners,
    window,
  }
})

vi.mock("electron", () => ({
  app: { isPackaged: true },
  BrowserWindow: electronMocks.browserWindow,
  dialog: { showMessageBox: vi.fn() },
}))

import { WindowController } from "@main/window-controller"

describe("主窗口外部导航安全", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMocks.webContentsListeners.clear()
  })

  it("拒绝网页创建新窗口，避免绕过 Renderer 的外链确认", () => {
    createController().create()
    const handler = electronMocks.window.webContents.setWindowOpenHandler.mock.calls[0]?.[0]

    expect(handler?.({ url: "https://example.com/docs" })).toEqual({ action: "deny" })
    expect(handler?.({ url: "http://intranet.example.test/docs" })).toEqual({ action: "deny" })
  })

  it("阻止主窗口导航到外部 HTTP 或 HTTPS 页面", () => {
    createController().create()
    const listener = electronMocks.webContentsListeners.get("will-navigate")

    for (const url of ["https://example.com/docs", "http://intranet.example.test/docs"]) {
      const event = { preventDefault: vi.fn() }
      listener?.(event, url)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
  })

  it("阻止主窗口跟随外部重定向", () => {
    createController().create()
    const listener = electronMocks.webContentsListeners.get("will-redirect")
    const event = { preventDefault: vi.fn() }

    listener?.(event, "https://example.com/redirect")

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })
})

function createController() {
  return new WindowController(
    { getSettings: vi.fn() } as unknown as ConfigStore,
    { recordEvent: vi.fn() } as unknown as Diagnostics,
    "/app/preload.cjs",
    "/app/logo.png",
  )
}
