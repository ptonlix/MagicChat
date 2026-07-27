import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DesktopRoot } from "./desktop-root"
import { releaseChannelLabel } from "@/release-channel"
import type { DesktopBridge, ServerProfile, UpdaterState } from "@shared/bridge"

const profile: ServerProfile = {
  createdAt: "2026-07-23T00:00:00.000Z",
  displayName: "测试服务器",
  id: "server-1",
  normalizedUrl: "https://chat.example.com",
}

const mocks = vi.hoisted(() => ({
  openManual: vi.fn(),
  openRelease: vi.fn(),
  openSettings: undefined as (() => void) | undefined,
  messageNotificationSoundEnabled: undefined as (() => boolean) | undefined,
  remove: vi.fn(),
}))

vi.mock("@/app/App", () => ({
  default: () => <button onClick={() => mocks.openSettings?.()}>打开设置</button>,
}))

vi.mock("@/lib/desktop-host", () => ({
  configureDesktopHost: (options: {
    messageNotificationSoundEnabled?(): boolean
    openSettings(): void
  }) => {
    mocks.openSettings = options.openSettings
    mocks.messageNotificationSoundEnabled = options.messageNotificationSoundEnabled
    return () => {
      mocks.openSettings = undefined
      mocks.messageNotificationSoundEnabled = undefined
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
    mocks.messageNotificationSoundEnabled = undefined
    mocks.openManual.mockReset().mockResolvedValue(undefined)
    mocks.openRelease.mockReset().mockResolvedValue(undefined)
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

    expect(await screen.findByRole("heading", { name: "开始使用即应" })).toBeInTheDocument()
    expect(screen.getByText("A BETTER WAY TO WORK")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /从沟通到行动/ })).toBeInTheDocument()
    expect(mocks.remove).toHaveBeenCalledWith(profile.id)
    expect(screen.getByLabelText("服务器地址")).toHaveValue("")
  })

  it("配置页使用应用主题变量且不再绘制突兀圆形装饰", async () => {
    const source = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(source).not.toContain(".server-setup-hero::after")
    expect(source).toContain(".dark .server-setup")
    expect(source).toMatch(/\.server-setup\s*\{[^}]*align-items:\s*stretch/)
    expect(source).toContain("max-width: none")
    expect(source).toContain("border-radius: 0")
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

  it("展示并保存新消息提示音开关", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const soundToggle = screen.getByRole("checkbox", { name: "新消息提示音" })
    expect(soundToggle).toBeChecked()

    await user.click(soundToggle)

    expect(bridge.settings.set).toHaveBeenCalledWith({ messageSoundEnabled: false })
    await waitFor(() => expect(soundToggle).not.toBeChecked())
    await waitFor(() => expect(mocks.messageNotificationSoundEnabled?.()).toBe(false))
  })

  it("设置保存失败时保留原值并显示错误", async () => {
    const bridge = createDesktopBridge()
    vi.mocked(bridge.settings.set).mockRejectedValueOnce(
      new Error("EACCES: permission denied, rename '/Users/test/desktop-config.json'"),
    )
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const soundToggle = screen.getByRole("checkbox", { name: "新消息提示音" })
    await user.click(soundToggle)

    expect(await screen.findByRole("alert")).toHaveTextContent("设置保存失败，请重试")
    expect(screen.queryByText(/Users\/test/)).not.toBeInTheDocument()
    expect(soundToggle).toBeChecked()
    expect(mocks.messageNotificationSoundEnabled?.()).toBe(true)
  })

  it("展示实验性更新信息并支持键盘触发手动升级", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "manual",
      installationSource: "deb",
      manualAction: { label: "下载 deb" },
      retryable: false,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    expect(await screen.findByText("目标版本：1.1.0")).toBeInTheDocument()
    expect(bridge.updater.getState).toHaveBeenCalledOnce()
    expect(screen.getByText("安装来源：Linux deb")).toBeInTheDocument()
    expect(screen.queryByLabelText("更新说明")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "检查更新" }).querySelector(".lucide-refresh-cw"),
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "查看发布内容" }))
    expect(mocks.openRelease).toHaveBeenCalledOnce()
    const manual = screen.getByRole("button", { name: "下载 deb" })
    manual.focus()
    await user.keyboard("{Enter}")
    expect(mocks.openManual).toHaveBeenCalledOnce()
  })

  it("订阅事件先到时不使用较旧的状态快照", async () => {
    const snapshot: UpdaterState = {
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "mac_app",
      retryable: false,
      status: "idle",
    }
    const pushedState: UpdaterState = {
      ...snapshot,
      retryable: true,
      status: "available",
      targetVersion: "1.2.0",
    }
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(snapshot, pushedState),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))

    expect(await screen.findByText("目标版本：1.2.0")).toBeInTheDocument()
    expect(screen.getByText("发现 1.2.0")).toBeInTheDocument()
    expect(screen.getByText("手动更新 macOS")).toBeInTheDocument()
    expect(screen.getByText("将 MagicChat 拖入“应用程序”，选择替换")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "下载 macOS 安装包" }))
    expect(mocks.openManual).toHaveBeenCalledOnce()
  })

  it("macOS 自动安装受限时展示友好的手动更新路径", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge({
        currentVersion: "1.0.0",
        errorCode: "platform_signature_required",
        installMode: "ota",
        installationSource: "mac_app",
        retryable: true,
        status: "error",
        targetVersion: "1.1.0",
      }),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))

    expect(
      await screen.findByText("自动安装受 macOS 安全策略限制，请使用安装包手动更新"),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "下载 macOS 安装包" })).toBeInTheDocument()
  })

  it("安装器未能启动时展示准确的恢复提示", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.install).mockResolvedValue({
      reason: "install_failed",
      status: "failed",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "安装并重启" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "自动安装未能启动，请重试检查或使用手动更新",
    )
  })
})

describe("发布通道显示", () => {
  it.each([
    ["test", "开发版"],
    ["preview", "预览版"],
    ["stable", "正式版"],
  ] as const)("将 %s 显示为 %s", (channel, label) => {
    expect(releaseChannelLabel(channel)).toBe(label)
  })
})

function createDesktopBridge(
  updaterState?: UpdaterState,
  subscriptionState?: UpdaterState,
): DesktopBridge {
  const unsubscribe = () => undefined
  const initialUpdaterState: UpdaterState = updaterState ?? {
    currentVersion: "0.1.0",
    installMode: "manual",
    installationSource: "development",
    retryable: false,
    status: "manual",
  }
  let settings = {
    autoLaunch: false,
    closeBehavior: "background" as const,
    messageSoundEnabled: true,
    notificationPrivacy: "metadata" as const,
    selectedServerId: profile.id,
  }
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
    appearance: { setThemeSource: vi.fn().mockResolvedValue(undefined) },
    auth: {
      cancel: vi.fn(),
      start: vi.fn(),
      subscribeFinished: vi.fn().mockReturnValue(unsubscribe),
    },
    badge: { set: vi.fn() },
    tray: { setMessages: vi.fn() },
    clipboard: { writePng: vi.fn(), writeText: vi.fn() },
    diagnostics: { export: vi.fn(), reportRuntime: vi.fn() },
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
      get: vi.fn().mockImplementation(async () => ({ ...settings })),
      set: vi.fn().mockImplementation(async (patch) => {
        settings = { ...settings, ...patch }
        return { ...settings }
      }),
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
      getState: vi.fn().mockResolvedValue(initialUpdaterState),
      install: vi.fn(),
      openManualDownload: mocks.openManual,
      openReleasePage: mocks.openRelease,
      subscribe: vi.fn((listener) => {
        if (subscriptionState) listener(subscriptionState)
        return unsubscribe
      }),
    },
    version: 1,
  }
}
