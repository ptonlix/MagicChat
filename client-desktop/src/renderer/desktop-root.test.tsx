import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DesktopRoot } from "./desktop-root"
import type { DesktopBridge, ServerProfile } from "../shared/bridge"

const profile: ServerProfile = {
  createdAt: "2026-07-23T00:00:00.000Z",
  displayName: "测试服务器",
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
}

const mocks = vi.hoisted(() => ({
  openSettings: undefined as (() => void) | undefined,
  remove: vi.fn(),
}))

vi.mock("@/app/App", () => ({
  default: () => <button onClick={() => mocks.openSettings?.()}>打开设置</button>,
}))

vi.mock("@/lib/desktop-host", () => ({
  configureDesktopHost: (options: { openSettings(): void }) => {
    mocks.openSettings = options.openSettings
    return () => {
      mocks.openSettings = undefined
    }
  },
  createDesktopRealtimeClient: vi.fn(),
}))

vi.mock("@/lib/desktop-link-navigation", () => ({
  installDesktopLinkNavigation: () => () => undefined,
}))

vi.mock("@/lib/desktop-resource-url", () => ({
  resolveDesktopResourceUrl: (_profile: ServerProfile, url: string) => url,
}))

vi.mock("./desktop-transport", () => ({
  DesktopWebSocket: class DesktopWebSocket {},
  installDesktopFetch: () => () => undefined,
}))

describe("桌面设置服务器管理", () => {
  beforeEach(() => {
    mocks.openSettings = undefined
    mocks.remove.mockResolvedValue(undefined)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("移除成功后回到服务器输入页面", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(await screen.findByRole("button", { name: "移除服务器" }))

    expect(await screen.findByRole("heading", { name: "连接 MagicChat Server" })).toBeInTheDocument()
    expect(mocks.remove).toHaveBeenCalledWith(profile.id)
    expect(screen.getByLabelText("服务器地址")).toHaveValue("")
  })

  it("移除失败时保留设置并显示错误", async () => {
    mocks.remove.mockRejectedValueOnce(new Error("本地配置写入失败"))
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(await screen.findByRole("button", { name: "移除服务器" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("本地配置写入失败")
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument()
  })
})

function createDesktopBridge(): DesktopBridge {
  const unsubscribe = () => undefined
  return {
    app: {
      info: vi.fn().mockResolvedValue({
        arch: "arm64",
        build: "test",
        channel: "test",
        packaged: false,
        platform: "darwin",
        version: "0.1.0",
      }),
    },
    auth: {
      cancel: vi.fn(),
      start: vi.fn(),
      subscribeFinished: vi.fn().mockReturnValue(unsubscribe),
    },
    badge: { set: vi.fn() },
    clipboard: { writePng: vi.fn(), writeText: vi.fn() },
    diagnostics: { export: vi.fn() },
    files: {
      download: vi.fn(),
      openLocation: vi.fn(),
      pick: vi.fn(),
      upload: vi.fn(),
    },
    navigation: {
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      subscribeUnknownServer: vi.fn().mockReturnValue(unsubscribe),
    },
    notifications: { show: vi.fn() },
    permissions: { request: vi.fn() },
    realtime: {
      close: vi.fn(),
      connect: vi.fn(),
      send: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      subscribeUnauthorized: vi.fn().mockReturnValue(unsubscribe),
    },
    servers: {
      add: vi.fn(),
      list: vi.fn().mockResolvedValue([profile]),
      remove: mocks.remove,
      rename: vi.fn(),
      select: vi.fn(),
    },
    settings: {
      get: vi.fn().mockResolvedValue({
        autoLaunch: false,
        closeBehavior: "background",
        notificationPrivacy: "metadata",
        selectedServerId: profile.id,
      }),
      set: vi.fn(),
    },
    shell: { openExternal: vi.fn() },
    transport: {
      cancel: vi.fn(),
      request: vi.fn(),
      streamAbort: vi.fn(),
      streamChunk: vi.fn(),
      streamFinish: vi.fn(),
      streamStart: vi.fn(),
    },
    updater: {
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
    },
    version: 1,
  }
}
