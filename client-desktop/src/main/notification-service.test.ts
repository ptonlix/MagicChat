import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopSettings, NotificationInput } from "@shared/bridge"

const electronMocks = vi.hoisted(() => ({
  options: [] as Array<{ body?: string; icon?: string; silent?: boolean; title?: string }>,
}))

vi.mock("electron", () => ({
  Notification: class NotificationMock {
    static isSupported() {
      return true
    }

    constructor(options: { body?: string; icon?: string; silent?: boolean; title?: string }) {
      electronMocks.options.push(options)
    }

    on() {}

    show() {}
  },
}))

import { NotificationService } from "@main/notification-service"

const input: NotificationInput = {
  conversationId: "conversation-1",
  messageId: "message-1",
  preview: "新消息内容",
  sender: "测试用户",
  target: {
    id: "server-1",
    normalizedUrl: "https://chat.example.com",
    userId: "user-1",
  },
  workspace: "测试空间",
}

describe("NotificationService", () => {
  beforeEach(() => {
    electronMocks.options.length = 0
  })

  it("关闭新消息提示音时创建静音系统通知", async () => {
    const service = new NotificationService(() => createSettings(false), vi.fn())

    await service.show(input)

    expect(electronMocks.options).toHaveLength(1)
    expect(electronMocks.options[0].silent).toBe(true)
  })

  it("开启新消息提示音时系统通知仍保持静音以避免重复发声", async () => {
    const service = new NotificationService(() => createSettings(true), vi.fn())

    await service.show(input)

    expect(electronMocks.options).toHaveLength(1)
    expect(electronMocks.options[0].silent).toBe(true)
  })

  it("Windows 通知使用即应品牌并且只提示发送者", async () => {
    const service = new NotificationService(() => createSettings(true), vi.fn(), {
      iconPath: "/path/logo.png",
      platform: "win32",
    })

    await service.show(input)

    expect(electronMocks.options).toEqual([
      {
        body: "【测试用户】发来新消息",
        icon: "/path/logo.png",
        silent: true,
        title: "即应",
      },
    ])
  })

  it("Windows 完全隐藏通知不会暴露发送者", async () => {
    const service = new NotificationService(() => createSettings(true, "hidden"), vi.fn(), {
      iconPath: "/path/logo.png",
      platform: "win32",
    })

    await service.show(input)

    expect(electronMocks.options[0]).toMatchObject({
      body: "你收到了一条新消息",
      title: "即应",
    })
  })

  it("macOS 通知继续按隐私设置展示工作区和消息预览", async () => {
    const service = new NotificationService(() => createSettings(true, "preview"), vi.fn(), {
      iconPath: "/path/logo.png",
      platform: "darwin",
    })

    await service.show(input)

    expect(electronMocks.options[0]).toEqual({
      body: "新消息内容",
      silent: true,
      title: "测试空间",
    })
  })
})

function createSettings(
  messageSoundEnabled: boolean,
  notificationPrivacy: DesktopSettings["notificationPrivacy"] = "metadata",
): DesktopSettings {
  return {
    autoLaunch: false,
    closeBehavior: "background",
    fontScale: "normal",
    language: "zh-CN",
    messageSoundEnabled,
    notificationPrivacy,
    screenshotShortcut: "CommandOrControl+Shift+A",
    searchShortcut: "CommandOrControl+Shift+F",
    sendMessageShortcut: "CommandOrControl+Enter",
  }
}
