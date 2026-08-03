import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DesktopRoot } from "./desktop-root"
import { releaseChannelLabel } from "@/release-channel"
import {
  DESKTOP_TITLEBAR_HEIGHT,
  type DesktopBridge,
  type ServerProfile,
  type UpdaterState,
} from "@shared/bridge"

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
  default: ({ updatePrompt }: { updatePrompt?: ReactNode }) => (
    <div>
      <aside aria-label="应用侧边栏">{updatePrompt}</aside>
      <button onClick={() => mocks.openSettings?.()}>打开设置</button>
    </div>
  ),
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

  it("Windows 顶栏展示即应 Logo", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(undefined, undefined, "win32"),
    })

    render(<DesktopRoot />)

    expect(await screen.findByRole("img", { name: "即应" })).toBeInTheDocument()
  })

  it("macOS 顶栏为原生交通灯保留左侧空间", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })

    render(<DesktopRoot />)

    await waitFor(() => expect(bridge.app.info).toHaveBeenCalled())
    expect(screen.queryByRole("img", { name: "即应" })).not.toBeInTheDocument()
  })

  it.each(["win32", "linux"])("%s 设置抽屉和遮罩位于应用顶栏下方", async (platform) => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge(undefined, undefined, platform),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await screen.findByRole("img", { name: "即应" })
    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const settings = screen.getByRole("dialog", { name: "设置" })
    const settingsOverlay = document.querySelector('[data-slot="sheet-overlay"]')
    const styles = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")

    expect(settings).toHaveClass("desktop-settings", "desktop-settings-below-titlebar")
    expect(settingsOverlay).toHaveClass("desktop-settings-overlay-below-titlebar")
    expect(styles).toContain(`--desktop-titlebar-height: ${DESKTOP_TITLEBAR_HEIGHT}px`)
    expect(styles).toMatch(
      /\.desktop-settings-below-titlebar\s*\{[^}]*height:\s*calc\(100% - var\(--desktop-titlebar-height\)\)/,
    )
  })

  it("macOS 设置抽屉保持全高且遮罩覆盖标题栏", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await waitFor(() => expect(window.desktop.app.info).toHaveBeenCalled())
    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const settings = screen.getByRole("dialog", { name: "设置" })
    const settingsOverlay = document.querySelector('[data-slot="sheet-overlay"]')

    expect(settings).toHaveClass("desktop-settings")
    await waitFor(() => expect(settings).not.toHaveClass("desktop-settings-below-titlebar"))
    expect(settingsOverlay).not.toHaveClass("desktop-settings-overlay-below-titlebar")
  })

  it("设置面板使用左侧收起按钮", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const closeButton = screen.getByRole("button", { name: "收起设置面板" })
    const settingsHeader = closeButton.closest('[data-slot="sheet-header"]')

    expect(settingsHeader?.firstElementChild).toBe(closeButton)
    await user.click(closeButton)
    expect(screen.queryByRole("dialog", { name: "设置" })).not.toBeInTheDocument()
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

  it("将本地消息缓存展示在通知与隐私下方并右对齐清理按钮", async () => {
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))

    const notificationHeading = screen.getByRole("heading", { name: "通知与隐私" })
    const cacheHeading = screen.getByRole("heading", { name: "本地消息缓存" })
    expect(
      notificationHeading.compareDocumentPosition(cacheHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    const cacheButton = screen.getByRole("button", { name: "清理本地消息缓存" })
    expect(cacheButton).toHaveClass("desktop-icon-action")

    const source = await readFile(path.resolve(process.cwd(), "src/renderer/styles.css"), "utf8")
    expect(source).toMatch(/\.desktop-icon-action\s*\{[^}]*justify-self:\s*end/)
  })

  it("确认后清理当前账户缓存并刷新统计", async () => {
    const bridge = createDesktopBridge()
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    await user.click(screen.getByRole("button", { name: "清理本地消息缓存" }))

    await waitFor(() => expect(bridge.messageCache.clearUser).toHaveBeenCalledOnce())
    expect(bridge.messageCache.clearUser).toHaveBeenCalledWith({
      id: profile.id,
      normalizedUrl: profile.normalizedUrl,
      userId: profile.lastUserId ?? "anonymous",
    })
    expect(bridge.messageCache.getStats).toHaveBeenCalledTimes(2)
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

  it("发现 OTA 新版本后在左侧栏底部提供图标下载入口", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    const updateButton = await screen.findByRole("button", { name: "新版本" })
    expect(updateButton).toHaveAttribute("title", "新版本 · 即应 1.1.0")
    expect(updateButton).toHaveTextContent("新版本")
    expect(screen.getByRole("status")).toHaveTextContent("新版本")
    expect(updateButton.closest("aside")).toHaveAccessibleName("应用侧边栏")
    await user.click(updateButton)

    expect(bridge.updater.download).toHaveBeenCalledOnce()
  })

  it("未配置服务器时仍订阅更新但不展示入口", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.servers.list).mockResolvedValue([])
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })

    render(<DesktopRoot />)

    expect(await screen.findByRole("heading", { name: "开始使用即应" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "新版本" })).not.toBeInTheDocument()
    expect(bridge.updater.subscribe).toHaveBeenCalledOnce()
    expect(bridge.updater.getState).toHaveBeenCalledOnce()
  })

  it("下载更新时展示进度、禁用重复操作并遵循 reduced-motion", async () => {
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: createDesktopBridge({
        currentVersion: "1.0.0",
        installMode: "ota",
        installationSource: "nsis",
        progress: 42.4,
        retryable: false,
        status: "downloading",
        targetVersion: "1.1.0",
      }),
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    const updateButton = await screen.findByRole("button", { name: "下载中 42%" })
    expect(updateButton).toBeEnabled()
    expect(updateButton).toHaveAttribute("aria-disabled", "true")
    expect(updateButton).toHaveTextContent("下载中 42%")
    expect(screen.getByRole("status")).toHaveTextContent("下载中 42%")
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite")
    expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true")
    expect(updateButton.querySelector("svg")).toHaveClass("motion-safe:animate-spin")
    expect(updateButton.querySelector("svg")).not.toHaveClass("animate-spin")
    updateButton.focus()
    expect(updateButton).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent("下载中 42% · 1.1.0")
    await user.click(updateButton)
    expect(window.desktop.updater.download).not.toHaveBeenCalled()
  })

  it("更新状态变化时同步刷新无障碍实时文本", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    let publish: ((state: UpdaterState) => void) | undefined
    vi.mocked(bridge.updater.subscribe).mockImplementation((listener) => {
      publish = listener
      return () => undefined
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    render(<DesktopRoot />)

    expect(await screen.findByRole("status")).toHaveTextContent("新版本")

    act(() => {
      publish?.({
        currentVersion: "1.0.0",
        installMode: "ota",
        installationSource: "nsis",
        progress: 42.4,
        retryable: false,
        status: "downloading",
        targetVersion: "1.1.0",
      })
    })

    expect(screen.getByRole("status")).toHaveTextContent("下载中 42%")
    expect(screen.getByRole("button", { name: "下载中 42%" })).toHaveAttribute(
      "aria-disabled",
      "true",
    )
  })

  it("下载调用失败时展示可恢复提示", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.download).mockRejectedValue(new Error("IPC unavailable"))
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "新版本" }))

    expect(await screen.findByText("更新操作失败，请稍后重试")).toBeInTheDocument()
  })

  it("手动升级来源从左下角入口打开匹配的安装包", async () => {
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

    await user.click(await screen.findByRole("button", { name: "新版本" }))

    expect(mocks.openManual).toHaveBeenCalledOnce()
    expect(bridge.updater.download).not.toHaveBeenCalled()
  })

  it("更新下载完成后从左下角执行重启安装", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      progress: 100,
      retryable: true,
      status: "downloaded",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.install).mockResolvedValue({ status: "started" })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "重启更新" }))

    expect(bridge.updater.install).toHaveBeenCalledOnce()
  })

  it("安装被活跃传输阻止时展示准确提示", async () => {
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
      reason: "active_transfers",
      status: "blocked",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "重启更新" }))

    expect(await screen.findByText("仍有文件正在传输，请完成或取消传输后重试")).toBeInTheDocument()
  })

  it("可重试错误从左下角入口重新检查更新", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      errorCode: "network",
      installMode: "ota",
      installationSource: "nsis",
      retryable: true,
      status: "error",
      targetVersion: "1.1.0",
    })
    vi.mocked(bridge.updater.check).mockResolvedValue({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "nsis",
      retryable: false,
      status: "idle",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "更新失败" }))

    expect(bridge.updater.check).toHaveBeenCalledOnce()
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "更新失败" })).not.toBeInTheDocument(),
    )
  })

  it("macOS 更新入口同样位于左侧栏底部", async () => {
    const bridge = createDesktopBridge({
      currentVersion: "1.0.0",
      installMode: "ota",
      installationSource: "mac_app",
      retryable: true,
      status: "available",
      targetVersion: "1.1.0",
    })
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    render(<DesktopRoot />)

    expect(
      (await screen.findByRole("button", { name: "新版本" })).closest("aside"),
    ).toHaveAccessibleName("应用侧边栏")
    expect(bridge.app.info).toHaveBeenCalledOnce()
  })

  it("没有新版本时不显示左下角更新入口", async () => {
    render(<DesktopRoot />)

    await screen.findByRole("button", { name: "打开设置" })
    expect(screen.queryByRole("button", { name: "新版本" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重启更新" })).not.toBeInTheDocument()
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
    expect(
      screen
        .getByRole("heading", { name: "关于即应" })
        .compareDocumentPosition(screen.getByRole("heading", { name: "应用行为" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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

  it("设置页捕获更新 Bridge 异常并在操作完成前阻止重复调用", async () => {
    const bridge = createDesktopBridge()
    let rejectCheck: (reason?: unknown) => void = () => undefined
    const checkPromise = new Promise<UpdaterState>((_, reject) => {
      rejectCheck = reject
    })
    vi.mocked(bridge.updater.check).mockReturnValue(checkPromise)
    Object.defineProperty(window, "desktop", {
      configurable: true,
      value: bridge,
    })
    const user = userEvent.setup()
    render(<DesktopRoot />)

    await user.click(await screen.findByRole("button", { name: "打开设置" }))
    const checkButton = await screen.findByRole("button", { name: "检查更新" })
    await user.click(checkButton)

    expect(checkButton).toBeDisabled()
    await user.click(checkButton)
    expect(bridge.updater.check).toHaveBeenCalledOnce()

    await act(async () => rejectCheck(new Error("IPC unavailable")))

    expect(await screen.findByRole("alert")).toHaveTextContent("更新操作失败，请稍后重试")
    await waitFor(() => expect(checkButton).toBeEnabled())
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
  platform = "darwin",
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
    asr: {
      close: vi.fn(),
      commit: vi.fn(),
      connect: vi.fn(),
      sendFrame: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
    },
    app: {
      info: vi.fn().mockResolvedValue({
        arch: "arm64",
        build: "test",
        channel: "test",
        packaged: false,
        platform,
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
    messageCache: {
      clearConversation: vi.fn(),
      clearUser: vi.fn(),
      commitAfter: vi.fn(),
      commitBefore: vi.fn(),
      commitLatest: vi.fn(),
      getById: vi.fn(),
      getStats: vi.fn().mockResolvedValue({
        conversationCount: 0,
        messageCount: 0,
        payloadBytes: 0,
        status: "available",
      }),
      getSyncState: vi.fn(),
      listSyncStates: vi.fn(),
      readAround: vi.fn(),
      readBefore: vi.fn(),
      readRecent: vi.fn(),
      removeMessage: vi.fn(),
      upsert: vi.fn(),
    },
    navigation: {
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      subscribeUnknownServer: vi.fn().mockReturnValue(unsubscribe),
    },
    notifications: { show: vi.fn() },
    permissions: { openSettings: vi.fn(), request: vi.fn() },
    realtime: {
      close: vi.fn(),
      connect: vi.fn(),
      send: vi.fn(),
      subscribe: vi.fn().mockReturnValue(unsubscribe),
      subscribeUnauthorized: vi.fn().mockReturnValue(unsubscribe),
    },
    screenshot: {
      start: vi.fn(),
      subscribeCompleted: vi.fn().mockReturnValue(unsubscribe),
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
