import { beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopSettings, NotificationInput } from "@shared/bridge"

const electronMocks = vi.hoisted(() => ({
  options: [] as Array<{ body?: string; silent?: boolean; title?: string }>,
}))

vi.mock("electron", () => ({
  Notification: class NotificationMock {
    static isSupported() {
      return true
    }

    constructor(options: { body?: string; silent?: boolean; title?: string }) {
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
})

function createSettings(messageSoundEnabled: boolean): DesktopSettings {
  return {
    autoLaunch: false,
    closeBehavior: "background",
    messageSoundEnabled,
    notificationPrivacy: "metadata",
  }
}
