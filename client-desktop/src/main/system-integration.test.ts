import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConfigStore } from "@main/config-store"
import type { WindowController } from "@main/window-controller"
import type { TrayMessage } from "@shared/bridge"

const electronMocks = vi.hoisted(() => ({
  menuTemplates: [] as Array<ReadonlyArray<{ enabled?: boolean; label?: string; type?: string }>>,
  openExternal: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {},
  Menu: {
    buildFromTemplate: vi.fn(
      (template: ReadonlyArray<{ enabled?: boolean; label?: string; type?: string }>) => {
        electronMocks.menuTemplates.push(template)
        return template
      },
    ),
  },
  nativeImage: {},
  session: {},
  shell: { openExternal: electronMocks.openExternal },
  systemPreferences: {},
  Tray: vi.fn(),
}))

import { SystemIntegration, prepareTrayImage, runtimeTrayIconPath } from "@main/system-integration"

describe("prepareTrayImage", () => {
  it("macOS 使用透明背景的菜单栏专用图标", () => {
    expect(runtimeTrayIconPath("darwin")).toContain("trayTemplate.png")
    expect(runtimeTrayIconPath("win32")).toContain("logo.png")
  })

  it("在 macOS 上使用跟随菜单栏颜色的模板图标", () => {
    const resizedImage = { setTemplateImage: vi.fn() }
    const image = { resize: vi.fn(() => resizedImage) }

    expect(
      prepareTrayImage(image as unknown as Parameters<typeof prepareTrayImage>[0], "darwin"),
    ).toBe(resizedImage)
    expect(image.resize).toHaveBeenCalledWith({ height: 20, width: 20 })
    expect(resizedImage.setTemplateImage).toHaveBeenCalledWith(true)
  })

  it("在 Windows 和 Linux 上保留彩色图标", () => {
    const resizedImage = { setTemplateImage: vi.fn() }
    const image = { resize: vi.fn(() => resizedImage) }

    prepareTrayImage(image as unknown as Parameters<typeof prepareTrayImage>[0], "win32")

    expect(resizedImage.setTemplateImage).not.toHaveBeenCalled()
  })
})

describe("SystemIntegration", () => {
  beforeEach(() => {
    electronMocks.menuTemplates.length = 0
    electronMocks.openExternal.mockReset().mockResolvedValue(undefined)
  })

  it("macOS 菜单栏菜单不展示未读消息区", () => {
    const store = {
      getSettings: vi.fn(() => ({ notificationPrivacy: "metadata" })),
    }
    const windows = { show: vi.fn() }
    const setContextMenu = vi.fn()
    const system = new SystemIntegration(
      store as unknown as ConfigStore,
      windows as unknown as WindowController,
      "darwin",
    )
    ;(
      system as unknown as {
        tray: { setContextMenu: (menu: unknown) => void }
      }
    ).tray = { setContextMenu }

    system.setTrayMessages([
      {
        conversationId: "conversation-1",
        name: "会话",
        serverId: "server-1",
        summary: "消息正文",
        unreadCount: 1,
      },
    ])

    expect(electronMocks.menuTemplates.at(-1)?.map((item) => item.label)).toEqual([
      "打开即应",
      "关闭即应",
    ])
    expect(store.getSettings).not.toHaveBeenCalled()
    expect(setContextMenu).toHaveBeenCalledOnce()
  })

  it("macOS 屏幕录制权限提示只打开固定的系统设置页面", async () => {
    const system = new SystemIntegration({} as ConfigStore, {} as WindowController)

    await expect(system.openPermissionSettings("screen", "darwin")).resolves.toBe(true)
    expect(electronMocks.openExternal).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    )
  })

  it("非 macOS 平台不尝试打开屏幕录制设置页面", async () => {
    const system = new SystemIntegration({} as ConfigStore, {} as WindowController)

    await expect(system.openPermissionSettings("screen", "win32")).resolves.toBe(false)
    expect(electronMocks.openExternal).not.toHaveBeenCalled()
  })

  it("不会从托盘消息切换到未配置的服务器", async () => {
    const store = {
      getSettings: vi.fn(() => ({ notificationPrivacy: "metadata" })),
      server: vi.fn(() => undefined),
      setSettings: vi.fn(),
    }
    const windows = {
      show: vi.fn(),
      verifyAndNavigate: vi.fn(),
    }
    const system = new SystemIntegration(
      store as unknown as ConfigStore,
      windows as unknown as WindowController,
    )

    await expect(
      (
        system as unknown as { openTrayMessage: (message: TrayMessage) => Promise<void> }
      ).openTrayMessage({
        conversationId: "conversation-1",
        name: "会话",
        serverId: "missing-server",
        summary: "消息",
        unreadCount: 1,
      }),
    ).rejects.toThrow("目标服务器不存在")
    expect(store.setSettings).not.toHaveBeenCalled()
  })
})
